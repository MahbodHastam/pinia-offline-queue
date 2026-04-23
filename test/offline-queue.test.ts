// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearFailed,
  enqueueAction,
  initializeOfflineQueue,
  registerReplayHandler,
  syncQueue,
  useOfflineQueueState,
} from '../src/runtime/store/queueManager'
import type { OfflineQueueConfig } from '../src/runtime/store/queueDB'

function makeConfig(seed: string): OfflineQueueConfig {
  return {
    dbName: `offline-queue-test-${seed}`,
    storeName: 'pendingActions',
    failedStoreName: 'failedActions',
    maxRetries: 2,
    apiBaseURL: '/api',
    backgroundSync: false,
    syncStrategy: 'networkFirst',
    headers: {
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
  }
}

async function init(seed: string) {
  const app = {
    hook: () => {},
  }
  await initializeOfflineQueue(makeConfig(seed), {
    ...app,
  })
}

describe('offline queue sync behavior', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    })
  })

  it('removes pending item after successful replay', async () => {
    await init('success')
    registerReplayHandler('posts', 'createPost', async () => ({ ok: true }))

    await enqueueAction({
      storeId: 'posts',
      actionName: 'createPost',
      payload: [{ title: 'Hello', content: 'World' }],
    })
    await syncQueue()

    const { pendingCount, failedCount } = useOfflineQueueState()
    expect(pendingCount.value).toBe(0)
    expect(failedCount.value).toBe(0)
  })

  it('moves item to failed queue after exceeding max retries', async () => {
    await init('retry')
    registerReplayHandler('posts', 'createPost', async () => {
      throw { status: 500 }
    })

    await enqueueAction({
      storeId: 'posts',
      actionName: 'createPost',
      payload: [{ title: 'Retry me', content: 'Please' }],
    })

    await syncQueue()
    await syncQueue()

    const { pendingCount, failedCount } = useOfflineQueueState()
    expect(pendingCount.value).toBe(0)
    expect(failedCount.value).toBe(1)
    await clearFailed()
  })

  it('moves Laravel validation failures to failed queue with errors', async () => {
    await init('validation')
    registerReplayHandler('posts', 'createPost', async () => {
      throw {
        status: 422,
        data: {
          message: 'The given data was invalid.',
          errors: {
            title: ['The title field is required.'],
          },
        },
      }
    })

    await enqueueAction({
      storeId: 'posts',
      actionName: 'createPost',
      payload: [{ title: '', content: 'Invalid' }],
    })
    await syncQueue()

    const { pendingCount, failedCount, failedItems } = useOfflineQueueState()
    expect(pendingCount.value).toBe(0)
    expect(failedCount.value).toBe(1)
    expect(failedItems.value[0]?.validationErrors?.title?.[0]).toContain('required')
    await clearFailed()
  })

  it('moves non-retryable client errors to failed queue immediately', async () => {
    await init('client-error')
    registerReplayHandler('posts', 'createPost', async () => {
      throw { status: 400 }
    })

    await enqueueAction({
      storeId: 'posts',
      actionName: 'createPost',
      payload: [{ title: 'Bad request', content: 'No retry' }],
    })
    await syncQueue()

    const { pendingCount, failedCount } = useOfflineQueueState()
    expect(pendingCount.value).toBe(0)
    expect(failedCount.value).toBe(1)
    await clearFailed()
  })

  it('moves unexpected non-retryable statuses to failed queue', async () => {
    await init('unexpected-status')
    registerReplayHandler('posts', 'createPost', async () => {
      throw { status: 304 }
    })

    await enqueueAction({
      storeId: 'posts',
      actionName: 'createPost',
      payload: [{ title: 'Unexpected', content: 'Status' }],
    })
    await syncQueue()

    const { pendingCount, failedCount } = useOfflineQueueState()
    expect(pendingCount.value).toBe(0)
    expect(failedCount.value).toBe(1)
    await clearFailed()
  })

  it('replays all payload arguments when falling back to endpoint sync', async () => {
    await init('endpoint-args')
    const fetchSpy = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('$fetch', fetchSpy)

    await enqueueAction({
      storeId: 'endpoint-posts',
      actionName: 'createPostViaEndpoint',
      payload: [{ title: 'Hello' }, { publish: true }],
      endpoint: '/posts',
      method: 'POST',
    })
    await syncQueue()

    expect(fetchSpy).toHaveBeenCalledWith('/posts', expect.objectContaining({
      body: JSON.stringify([{ title: 'Hello' }, { publish: true }]),
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
      }),
    }))
  })
})
