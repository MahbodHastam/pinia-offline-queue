import { defineNuxtPlugin, useRuntimeConfig } from '#app'
import type { PiniaPluginContext } from 'pinia'
import { enqueueAction, initializeOfflineQueue, registerReplayHandler } from './store/queueManager'
import { OFFLINE_ACTION_FLAG, isOfflineAction, type OfflineActionMeta } from './store/offlineAction'
import type { OfflineQueueConfig } from './store/queueDB'

function getCookie(name: string): string | undefined {
  if (typeof document === 'undefined') {
    return undefined
  }
  const found = document.cookie
    .split(';')
    .map(item => item.trim())
    .find(item => item.startsWith(`${name}=`))

  if (!found) {
    return undefined
  }

  const value = found.split('=').slice(1).join('=')
  return decodeURIComponent(value)
}

function isOnline(): boolean {
  if (typeof navigator === 'undefined') {
    return true
  }
  return navigator.onLine
}

function getOfflineActionEntries(store: PiniaPluginContext['store'], options: PiniaPluginContext['options']) {
  const entries = new Map<string, unknown>()

  for (const [actionName, candidate] of Object.entries(store)) {
    if (typeof candidate === 'function') {
      entries.set(actionName, candidate)
    }
  }

  for (const [actionName, candidate] of Object.entries(options.actions || {})) {
    entries.set(actionName, candidate)
  }

  return [...entries.entries()].filter(([, candidate]) => isOfflineAction(candidate))
}

export default defineNuxtPlugin(async (nuxtApp) => {
  const runtime = useRuntimeConfig().public.piniaOfflineQueue as OfflineQueueConfig
  const config: OfflineQueueConfig = {
    ...runtime,
    headers: {
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(runtime.headers || {}),
    },
  }

  const $laravel = $fetch.create({
    baseURL: config.apiBaseURL,
    credentials: 'include',
    headers: config.headers,
    onRequest({ options }) {
      const token = getCookie('XSRF-TOKEN')
      if (!token) {
        return
      }

      const mergedHeaders = new Headers(options.headers as HeadersInit | undefined)
      if (!mergedHeaders.has('X-XSRF-TOKEN')) {
        mergedHeaders.set('X-XSRF-TOKEN', token)
      }
      options.headers = mergedHeaders
    },
  })

  await initializeOfflineQueue(config, {
    hook: (name, callback) => nuxtApp.hook(name, callback),
    $laravel,
  })

  const pinia = nuxtApp.$pinia as PiniaPluginContext['pinia']
  pinia.use(({ store, options }: PiniaPluginContext) => {
    const offlineApi = {
      define: <T>(handler: T) => handler,
    }

    Object.assign(store, { $offline: offlineApi })

    for (const [actionName, candidate] of getOfflineActionEntries(store, options)) {
      const action = candidate as (...args: unknown[]) => Promise<unknown>
      const meta = (Reflect.get(candidate as object, OFFLINE_ACTION_FLAG) || {}) as OfflineActionMeta

      registerReplayHandler(
        store.$id,
        actionName,
        (...args: unknown[]) => action.apply(store, args),
        {
          endpoint: meta.endpoint,
          method: meta.method,
          headers: meta.headers,
        },
      )

      Reflect.set(store, actionName, async (...args: unknown[]) => {
        const shouldQueue = config.syncStrategy === 'queueOnly' || !isOnline()
        if (!shouldQueue) {
          return await action.apply(store, args)
        }

        return await enqueueAction({
          storeId: store.$id,
          actionName,
          payload: args,
          endpoint: meta.endpoint,
          method: meta.method,
          headers: {
            ...config.headers,
            ...(meta.headers || {}),
          },
          source: 'pinia',
        })
      })
    }
  })

  return {
    provide: {
      laravel: $laravel,
    },
  }
})
