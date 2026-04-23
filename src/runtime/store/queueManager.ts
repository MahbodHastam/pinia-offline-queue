import type { $Fetch } from 'nitropack'
import { ref, type Ref } from 'vue'
import {
  clearQueuedStore,
  clonePayload,
  deleteQueuedAction,
  getAllQueuedActions,
  moveToFailed,
  putQueuedAction,
  type OfflineQueueConfig,
  type QueuedAction,
  type ValidationErrors,
  type HttpMethod,
} from './queueDB'
import { createQueueId } from './offlineAction'

type ReplayHandler = (...args: unknown[]) => Promise<unknown> | unknown

interface ReplayEntry {
  handler: ReplayHandler
  endpoint?: string
  method?: HttpMethod
  headers?: Record<string, string>
}

interface QueueNuxtApp {
  hook?: (name: 'app:mounted', callback: () => void) => unknown
  $laravel?: $Fetch
}

interface SyncErrorShape {
  status?: number
  statusCode?: number
  response?: {
    status?: number
    json?: () => Promise<unknown>
  }
  data?: {
    errors?: ValidationErrors
  }
}

interface ValidationPayload {
  errors?: ValidationErrors
}

const replayRegistry = new Map<string, ReplayEntry>()
const pendingItems = ref<QueuedAction[]>([])
const failedItems = ref<QueuedAction[]>([])
const pendingCount = ref(0)
const failedCount = ref(0)
const isSyncing = ref(false)

const onSyncSuccessHandlers = new Set<(item: QueuedAction) => void>()
const onSyncErrorHandlers = new Set<(item: QueuedAction, error: unknown) => void>()

let currentConfig: OfflineQueueConfig | null = null
let initialized = false
let laravelRequest: QueueNuxtApp['$laravel']

function keyFor(storeId: string, actionName: string) {
  return `${storeId}:${actionName}`
}

function getConfig(): OfflineQueueConfig {
  if (!currentConfig) {
    throw new Error('[pinia-offline-queue] Offline queue has not been initialized')
  }
  return currentConfig
}

function getErrorStatus(error: unknown): number | undefined {
  const e = error as SyncErrorShape
  return e?.status ?? e?.statusCode ?? e?.response?.status
}

async function getValidationErrors(error: unknown): Promise<ValidationErrors | undefined> {
  const e = error as SyncErrorShape
  if (e?.data?.errors) {
    return e.data.errors as ValidationErrors
  }
  const response = e?.response
  if (response && typeof response.json === 'function') {
    try {
      const payload = await response.json() as ValidationPayload
      if (payload?.errors && typeof payload.errors === 'object') {
        return payload.errors as ValidationErrors
      }
    }
    catch {
      return undefined
    }
  }
  return undefined
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  try {
    return JSON.stringify(error)
  }
  catch {
    return String(error)
  }
}

function isRetryableError(error: unknown): boolean {
  const status = getErrorStatus(error)
  if (status == null || status === 0) {
    return true
  }
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function canUseNavigator(): boolean {
  return typeof navigator !== 'undefined'
}

function canUseWindow(): boolean {
  return typeof window !== 'undefined'
}

function isOnline(): boolean {
  if (!canUseNavigator()) {
    return true
  }
  return navigator.onLine
}

type ReplayRequestBody = BodyInit | Record<string, unknown> | null | undefined

function getReplayRequestBody(item: QueuedAction): ReplayRequestBody {
  if (item.payload.length === 0) {
    return undefined
  }

  if (item.payload.length === 1) {
    return item.payload[0] as ReplayRequestBody
  }

  return JSON.stringify(item.payload)
}

function getReplayRequestHeaders(item: QueuedAction): Record<string, string> | undefined {
  if (item.payload.length <= 1) {
    return item.headers
  }

  return {
    'Content-Type': 'application/json',
    ...(item.headers || {}),
  }
}

async function replayWithEndpoint(item: QueuedAction): Promise<unknown> {
  const endpoint = item.endpoint
  if (!endpoint) {
    throw new Error('[pinia-offline-queue] No endpoint available for queued action')
  }

  const method: HttpMethod = item.method || 'POST'
  const body = getReplayRequestBody(item)
  const headers = getReplayRequestHeaders(item)
  if (laravelRequest) {
    return await laravelRequest(endpoint, {
      method,
      body,
      headers,
    })
  }

  return await $fetch(endpoint, {
    baseURL: getConfig().apiBaseURL,
    method,
    body,
    headers: {
      ...getConfig().headers,
      ...(headers || {}),
    },
  })
}

async function replayItem(item: QueuedAction): Promise<unknown> {
  const replay = replayRegistry.get(keyFor(item.storeId, item.actionName))
  if (replay) {
    return await replay.handler(...item.payload)
  }
  if (item.endpoint) {
    return await replayWithEndpoint(item)
  }
  throw new Error(
    `[pinia-offline-queue] Missing replay handler for ${item.storeId}.${item.actionName}. Provide endpoint metadata in offlineAction.`,
  )
}

async function refreshState(config = getConfig()): Promise<void> {
  pendingItems.value = await getAllQueuedActions(config)
  failedItems.value = await getAllQueuedActions(config, true)
  pendingCount.value = pendingItems.value.length
  failedCount.value = failedItems.value.length
}

export function registerReplayHandler(
  storeId: string,
  actionName: string,
  handler: ReplayHandler,
  meta?: { endpoint?: string, method?: HttpMethod, headers?: Record<string, string> },
): void {
  replayRegistry.set(keyFor(storeId, actionName), {
    handler,
    endpoint: meta?.endpoint,
    method: meta?.method,
    headers: meta?.headers,
  })
}

export async function enqueueAction(
  action: Omit<QueuedAction, 'id' | 'timestamp' | 'retryCount' | 'payload'> & { payload: unknown[] },
): Promise<{ queued: true, id: string }> {
  const config = getConfig()
  const id = createQueueId()
  const item: QueuedAction = {
    id,
    payload: clonePayload(action.payload),
    timestamp: Date.now(),
    retryCount: 0,
    storeId: action.storeId,
    actionName: action.actionName,
    endpoint: action.endpoint,
    method: action.method,
    headers: action.headers,
    source: action.source || 'pinia',
  }
  await putQueuedAction(config, item)
  await refreshState(config)
  return { queued: true, id }
}

export async function retryFailed(id: string): Promise<void> {
  const config = getConfig()
  const target = failedItems.value.find(item => item.id === id)
  if (!target) {
    return
  }
  await deleteQueuedAction(config, id, true)
  await putQueuedAction(config, { ...target, retryCount: 0, validationErrors: undefined }, false)
  await refreshState(config)
}

export async function clearFailed(): Promise<void> {
  const config = getConfig()
  await clearQueuedStore(config, true)
  await refreshState(config)
}

export async function removeItem(id: string, queue: 'pending' | 'failed' = 'pending'): Promise<void> {
  const config = getConfig()
  await deleteQueuedAction(config, id, queue === 'failed')
  await refreshState(config)
}

export async function syncQueue(): Promise<void> {
  const config = getConfig()
  if (isSyncing.value) {
    return
  }
  if (!isOnline()) {
    return
  }

  isSyncing.value = true
  try {
    const items = await getAllQueuedActions(config)
    for (const item of items) {
      try {
        await replayItem(item)
        await deleteQueuedAction(config, item.id, false)
        onSyncSuccessHandlers.forEach(handler => handler(item))
      }
      catch (error) {
        const status = getErrorStatus(error)
        if (status === 422) {
          const validationErrors = await getValidationErrors(error)
          await moveToFailed(config, item, validationErrors)
          onSyncErrorHandlers.forEach(handler => handler(item, error))
          continue
        }

        if (!isRetryableError(error)) {
          await moveToFailed(config, {
            ...item,
            lastError: stringifyError(error),
          })
          onSyncErrorHandlers.forEach(handler => handler(item, error))
          continue
        }

        const nextRetryCount = item.retryCount + 1
        if (nextRetryCount >= config.maxRetries) {
          await moveToFailed(config, {
            ...item,
            retryCount: nextRetryCount,
            lastError: stringifyError(error),
          })
        }
        else {
          await putQueuedAction(config, {
            ...item,
            retryCount: nextRetryCount,
            lastError: stringifyError(error),
          })
        }
        onSyncErrorHandlers.forEach(handler => handler(item, error))
      }
    }
  }
  finally {
    isSyncing.value = false
    await refreshState(config)
  }
}

export async function initializeOfflineQueue(config: OfflineQueueConfig, nuxtApp: QueueNuxtApp): Promise<void> {
  currentConfig = config
  laravelRequest = nuxtApp.$laravel
  await refreshState(config)

  if (initialized || !canUseWindow()) {
    return
  }

  initialized = true
  window.addEventListener('online', () => {
    syncQueue().catch((error) => {
      console.error('[pinia-offline-queue] Sync on reconnect failed', error)
    })
  })

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data as { type?: string } | undefined
      if (data?.type === 'offline-queue-sync') {
        syncQueue().catch((error) => {
          console.error('[pinia-offline-queue] Sync from service worker failed', error)
        })
      }
    })
  }

  nuxtApp.hook?.('app:mounted', () => {
    if (isOnline()) {
      syncQueue().catch((error) => {
        console.error('[pinia-offline-queue] Initial sync failed', error)
      })
    }
  })
}

export function useOfflineQueueState(): {
  pendingCount: Ref<number>
  failedCount: Ref<number>
  isSyncing: Ref<boolean>
  pendingItems: Ref<QueuedAction[]>
  failedItems: Ref<QueuedAction[]>
} {
  return {
    pendingCount,
    failedCount,
    isSyncing,
    pendingItems,
    failedItems,
  }
}

export function onSyncSuccess(handler: (item: QueuedAction) => void): () => void {
  onSyncSuccessHandlers.add(handler)
  return () => onSyncSuccessHandlers.delete(handler)
}

export function onSyncError(handler: (item: QueuedAction, error: unknown) => void): () => void {
  onSyncErrorHandlers.add(handler)
  return () => onSyncErrorHandlers.delete(handler)
}
