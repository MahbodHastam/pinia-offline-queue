import type { HttpMethod, QueuedAction } from './queueDB'

export interface OfflineActionMeta {
  endpoint?: string
  method?: HttpMethod
  headers?: Record<string, string>
}

export interface QueuedActionResult {
  queued: true
  id: string
}

export type OfflineActionFunction<TArgs extends unknown[], TResult> = (
  ...args: TArgs
) => Promise<TResult> | TResult

export type OfflineWrappedAction<TArgs extends unknown[], TResult> = OfflineActionFunction<
  TArgs,
  TResult | QueuedActionResult
> & {
  __offlineActionMeta?: OfflineActionMeta
}

export const OFFLINE_ACTION_FLAG = '__offlineActionMeta'

export function offlineAction<TArgs extends unknown[], TResult>(
  action: OfflineActionFunction<TArgs, TResult>,
): OfflineWrappedAction<TArgs, TResult>
export function offlineAction<TArgs extends unknown[], TResult>(
  meta: OfflineActionMeta,
  action: OfflineActionFunction<TArgs, TResult>,
): OfflineWrappedAction<TArgs, TResult>
export function offlineAction<TArgs extends unknown[], TResult>(
  metaOrAction: OfflineActionMeta | OfflineActionFunction<TArgs, TResult>,
  maybeAction?: OfflineActionFunction<TArgs, TResult>,
): OfflineWrappedAction<TArgs, TResult> {
  const hasMeta = typeof metaOrAction === 'object'
  const meta = (hasMeta ? metaOrAction : {}) as OfflineActionMeta
  const action = (hasMeta ? maybeAction : metaOrAction) as OfflineActionFunction<TArgs, TResult>

  if (typeof action !== 'function') {
    throw new TypeError('[pinia-offline-queue] offlineAction requires a function')
  }

  const wrapped = action as OfflineWrappedAction<TArgs, TResult>
  wrapped[OFFLINE_ACTION_FLAG] = meta
  return wrapped
}

export function isOfflineAction(candidate: unknown): candidate is OfflineWrappedAction<unknown[], unknown> {
  if (!candidate || typeof candidate !== 'function') {
    return false
  }
  return OFFLINE_ACTION_FLAG in candidate
}

export function toQueuedActionResult(id: string): QueuedActionResult {
  return { queued: true, id }
}

export function createQueueId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function buildQueuedAction(args: unknown[]): Pick<QueuedAction, 'payload' | 'timestamp' | 'retryCount'> {
  return {
    payload: args,
    timestamp: Date.now(),
    retryCount: 0,
  }
}
