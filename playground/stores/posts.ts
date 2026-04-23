import { defineStore } from 'pinia'
import { offlineAction } from '../../src/runtime/store/offlineAction'

interface PostPayload {
  title: string
  content: string
}

export const usePostsStore = defineStore('posts', {
  state: () => ({
    posts: [] as PostPayload[],
  }),
  actions: {
    createPost: offlineAction(
      {
        endpoint: '/posts',
        method: 'POST',
      },
      async (payload: PostPayload) => {
        const { $laravel } = useNuxtApp()
        const created = await $laravel('/posts', {
          method: 'POST',
          body: payload,
        })
        return created
      },
    ),
  },
})
