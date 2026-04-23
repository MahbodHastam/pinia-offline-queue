# pinia-offline-queue

[npm version](https://npmjs.com/package/pinia-offline-queue)
[npm downloads](https://npm.chart.dev/pinia-offline-queue)
[License](https://npmjs.com/package/pinia-offline-queue)
[Nuxt](https://nuxt.com)

Offline support for Pinia actions in Nuxt.
Keep actions in a local queue, survive refreshes, and sync them when the user is back online.

## Features

- `offlineAction()` wrapper for Pinia actions
- `useOfflineQueue()` composable with reactive queue state + controls
- IndexedDB queue persistence (`idb`)
- Auto-sync on reconnect (`navigator.onLine` + `online` event)
- Laravel validation error (`422`) items moved to a failed/review queue
- Optional `$laravel` helper with Sanctum-friendly CSRF header handling

## Installation

```bash
pnpm add pinia-offline-queue
```

If you want Background Sync through Workbox:

```bash
pnpm add @vite-pwa/nuxt
```

## Nuxt Setup

Add modules and configure `piniaOfflineQueue` in `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: [
    // ...
    'pinia-offline-queue',
  ],

  piniaOfflineQueue: {
    dbName: 'offlineQueueDB',
    storeName: 'pendingActions',
    failedStoreName: 'failedActions',
    maxRetries: 3,
    apiBaseURL: '/api',
    backgroundSync: true,
    syncStrategy: 'networkFirst', // 'networkFirst' | 'queueOnly'
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
  },
})
```

## Usage

### 1) Wrap offline-capable Pinia actions

```ts
// stores/posts.ts
import { defineStore } from 'pinia'
import { offlineAction } from '#imports'

export const usePostStore = defineStore('posts', {
  actions: {
    createPost: offlineAction(
      {
        endpoint: '/posts',
        method: 'POST',
      },
      async (payload: { title: string; content: string }) => {
        const { $laravel } = useNuxtApp()
        return await $laravel('/posts', {
          method: 'POST',
          body: payload,
        })
      },
    ),
  },
})
```

Behavior:

- **Online** (`networkFirst`): action executes normally
- **Offline**: action is queued in IndexedDB and resolves:

```ts
{ queued: true, id: '...' }
```

### 2) Manage queue state in UI

```ts
const {
  pendingCount,
  failedCount,
  isSyncing,
  pendingItems,
  failedItems,
  sync,
  retryFailed,
  clearFailed,
  removeItem,
  onSyncSuccess,
  onSyncError,
} = useOfflineQueue()
```

## Laravel-specific Behavior

During sync:

- `2xx`: item removed from pending queue
- `422`: item moved immediately to failed queue with `validationErrors`
- `408`, `425`, `429`, `5xx`, or missing-status network failures: `retryCount` increments
  - if `retryCount < maxRetries`: remains in pending queue
  - otherwise: moved to failed queue
- Other `4xx`: item moves directly to the failed queue with `lastError`

Laravel validation payloads (example):

```json
{
  "message": "The given data was invalid.",
  "errors": {
    "title": ["The title field is required."]
  }
}
```

Those `errors` are saved on the failed item so your UI can display and correct payloads before retry.

If endpoint-based replay is used without a registered action handler, a single action argument is sent as the request body. Multiple arguments are sent as a JSON array so no payload data is dropped during replay.

## Background Sync (Workbox)

When all are true:

- `piniaOfflineQueue.backgroundSync = true`
- `@vite-pwa/nuxt` is installed
- module is included in `modules`

The module injects Workbox runtime caching for mutation methods (`POST`/`PUT`/`DELETE`) to your API base path and wires a service worker sync signal (`offline-queue-sync`) back to the app for queue processing.

## TypeScript

The module augments:

- Nuxt config/runtime types for `piniaOfflineQueue`
- `NuxtApp` / Vue component instance with `$laravel`
- Pinia store custom properties with `$offline`

## SSR and Client-only Notes

Queue operations depend on browser APIs (`IndexedDB`, `navigator`, `window`, service worker) and run client-side only. The module plugin is registered in client mode.

## Serialization Caveat

Queued payloads are cloned before persistence. If payloads include `File` objects, the module warns because browser file handles are not reliably serializable for background replay. Prefer converting files to base64/blob upload workflows before queueing.

## Development

```bash
pnpm install
pnpm dev:prepare
pnpm dev
pnpm lint
pnpm test
pnpm test:types
```

