import {
  addImports,
  addPlugin,
  createResolver,
  defineNuxtModule,
  installModule,
} from '@nuxt/kit'

export interface OfflineQueueHeaders {
  [headerName: string]: string
}

export interface ModuleOptions {
  dbName: string
  storeName: string
  failedStoreName: string
  maxRetries: number
  apiBaseURL: string
  backgroundSync: boolean
  syncStrategy: 'networkFirst' | 'queueOnly'
  headers: OfflineQueueHeaders
}

const defaultOptions: ModuleOptions = {
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
}

function hasModule(modules: unknown[], moduleName: string): boolean {
  return modules.some((entry) => {
    if (typeof entry === 'string') {
      return entry === moduleName
    }
    if (Array.isArray(entry)) {
      return entry[0] === moduleName
    }
    return false
  })
}

interface PwaOptions {
  mode?: 'development' | 'production'
  workbox?: {
    disableDevLogs?: boolean
    mode?: string
    runtimeCaching?: Array<Record<string, unknown>>
  }
  injectManifest?: {
    swSrc?: string
  }
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'pinia-offline-queue',
    configKey: 'piniaOfflineQueue',
  },
  defaults: defaultOptions,
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)

    if (!hasModule(nuxt.options.modules, '@pinia/nuxt')) {
      await installModule('@pinia/nuxt')
    }

    const runtimeOptions = nuxt.options.runtimeConfig.public.piniaOfflineQueue as Partial<ModuleOptions> | undefined
    const mergedOptions: ModuleOptions = {
      ...defaultOptions,
      ...(runtimeOptions || {}),
      ...options,
      headers: {
        ...defaultOptions.headers,
        ...(runtimeOptions?.headers || {}),
        ...(options.headers || {}),
      },
    }
    nuxt.options.runtimeConfig.public.piniaOfflineQueue = mergedOptions as typeof nuxt.options.runtimeConfig.public.piniaOfflineQueue

    addPlugin({
      src: resolver.resolve('./runtime/plugin'),
      mode: 'client',
    })

    addImports([
      {
        from: resolver.resolve('./runtime/composables/useOfflineQueue'),
        name: 'useOfflineQueue',
      },
      {
        from: resolver.resolve('./runtime/store/offlineAction'),
        name: 'offlineAction',
      },
    ])

    nuxt.hook('prepare:types', ({ references }) => {
      references.push({ path: resolver.resolve('./runtime/types') })
    })

    if (options.backgroundSync && hasModule(nuxt.options.modules, '@vite-pwa/nuxt')) {
      const moduleOptions = nuxt.options as typeof nuxt.options & { pwa?: PwaOptions | false }
      const pwa = moduleOptions.pwa && typeof moduleOptions.pwa === 'object'
        ? moduleOptions.pwa
        : {} as PwaOptions
      pwa.mode = pwa.mode || 'development'
      pwa.workbox = pwa.workbox || {}
      pwa.workbox.mode = pwa.workbox.mode || 'development'
      pwa.workbox.disableDevLogs = pwa.workbox.disableDevLogs ?? true
      pwa.workbox.runtimeCaching = pwa.workbox.runtimeCaching || []

      const queueName = 'offline-queue-sync'
      const methods = ['POST', 'PUT', 'DELETE']
      for (const method of methods) {
        pwa.workbox.runtimeCaching.push({
          urlPattern: `${options.apiBaseURL.replace(/\/$/, '')}/.*`,
          method,
          handler: 'NetworkOnly',
          options: {
            backgroundSync: {
              name: queueName,
              options: {
                maxRetentionTime: 24 * 60,
              },
            },
          },
        })
      }

      pwa.injectManifest = pwa.injectManifest || {}
      pwa.injectManifest.swSrc = pwa.injectManifest.swSrc || resolver.resolve('./runtime/worker/sw.js')
      moduleOptions.pwa = pwa as typeof moduleOptions.pwa
    }
  },
})
