import {
  clearFailed,
  onSyncError,
  onSyncSuccess,
  removeItem,
  retryFailed,
  syncQueue,
  useOfflineQueueState,
} from '../store/queueManager'

export function useOfflineQueue() {
  const state = useOfflineQueueState()

  return {
    ...state,
    sync: syncQueue,
    retryFailed,
    clearFailed,
    removeItem,
    onSyncSuccess,
    onSyncError,
  }
}
