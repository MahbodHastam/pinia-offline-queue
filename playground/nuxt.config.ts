export default defineNuxtConfig({
  modules: ['@pinia/nuxt', 'pinia-offline-queue', '@vite-pwa/nuxt'],
  devtools: { enabled: true },
  compatibilityDate: 'latest',
  piniaOfflineQueue: {
    dbName: 'offlineQueueDB',
    storeName: 'pendingActions',
    failedStoreName: 'failedActions',
    maxRetries: 3,
    apiBaseURL: '/api',
    backgroundSync: true,
    syncStrategy: 'networkFirst',
    headers: {
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
  },
})
