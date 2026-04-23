self.addEventListener('sync', (event) => {
  if (event.tag !== 'offline-queue-sync') {
    return
  }

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        includeUncontrolled: true,
        type: 'window',
      })
      for (const client of clients) {
        client.postMessage({ type: 'offline-queue-sync' })
      }
    })(),
  )
})
