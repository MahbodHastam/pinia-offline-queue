import type { $Fetch } from 'nitropack'
import type { QueuedAction, ValidationErrors } from '../store/queueDB'
import type { ModuleOptions } from '../../module'

declare module '@nuxt/schema' {
  interface NuxtConfig {
    piniaOfflineQueue?: Partial<ModuleOptions>
  }

  interface NuxtOptions {
    piniaOfflineQueue?: Partial<ModuleOptions>
  }

  interface PublicRuntimeConfig {
    piniaOfflineQueue: ModuleOptions
  }
}

declare module '#app' {
  interface NuxtApp {
    $laravel: $Fetch
  }
}

declare module 'nuxt/app' {
  interface NuxtApp {
    $laravel: $Fetch
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $laravel: $Fetch
  }
}

declare module 'pinia' {
  export interface PiniaCustomProperties {
    $offline: {
      define<T>(handler: T): T
    }
  }
}

export interface FailedQueuedAction extends QueuedAction {
  validationErrors?: ValidationErrors
}

export {}
