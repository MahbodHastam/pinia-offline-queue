<template>
  <div style="font-family: sans-serif; max-width: 800px; margin: 2rem auto;">
    <h1>Pinia Offline Queue Playground</h1>
    <p>Pending: {{ pendingCount }} | Failed: {{ failedCount }} | Syncing: {{ isSyncing }}</p>
    <button @click="createSamplePost">
      Create Post (Offline-aware)
    </button>
    <button
      style="margin-left: 0.5rem;"
      @click="sync"
    >
      Sync now
    </button>
  </div>
</template>

<script setup>
const posts = usePostsStore()
const { pendingCount, failedCount, isSyncing, sync } = useOfflineQueue()

async function createSamplePost() {
  await posts.createPost({
    title: 'Offline queue demo',
    content: 'This payload will queue when offline.',
  })
}
</script>
