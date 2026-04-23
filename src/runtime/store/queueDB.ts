import { openDB, type DBSchema } from 'idb'

export interface OfflineQueueConfig {
  dbName: string
  storeName: string
  failedStoreName: string
  maxRetries: number
  apiBaseURL: string
  backgroundSync: boolean
  syncStrategy: 'networkFirst' | 'queueOnly'
  headers: Record<string, string>
}

export interface ValidationErrors {
  [key: string]: string[]
}

export interface QueuedAction {
  id: string
  storeId: string
  actionName: string
  payload: unknown[]
  timestamp: number
  retryCount: number
  endpoint?: string
  method?: HttpMethod
  headers?: Record<string, string>
  source?: 'pinia' | 'workbox'
  validationErrors?: ValidationErrors
  lastError?: string
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

type QueueDBSchema = DBSchema

interface UpgradableDatabase {
  objectStoreNames: DOMStringList
  createObjectStore: (name: string, options?: IDBObjectStoreParameters) => IDBObjectStore
}

interface QueueDatabaseClient {
  getAll: (storeName: string) => Promise<QueuedAction[]>
  put: (storeName: string, item: QueuedAction) => Promise<IDBValidKey>
  delete: (storeName: string, id: string) => Promise<void>
  clear: (storeName: string) => Promise<void>
}

const databaseCache = new Map<string, Promise<QueueDatabaseClient>>()

function dbCacheKey(config: OfflineQueueConfig) {
  return `${config.dbName}:${config.storeName}:${config.failedStoreName}`
}

function ensureStores(db: UpgradableDatabase, config: OfflineQueueConfig): void {
  if (!db.objectStoreNames.contains(config.storeName)) {
    db.createObjectStore(config.storeName, { keyPath: 'id' })
  }

  if (!db.objectStoreNames.contains(config.failedStoreName)) {
    db.createObjectStore(config.failedStoreName, { keyPath: 'id' })
  }
}

function containsFile(value: unknown): boolean {
  if (!value) {
    return false
  }

  if (typeof File !== 'undefined' && value instanceof File) {
    return true
  }

  if (Array.isArray(value)) {
    return value.some(item => containsFile(item))
  }

  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(item => containsFile(item))
  }

  return false
}

export function clonePayload<T>(value: T): T {
  if (containsFile(value)) {
    console.warn(
      '[pinia-offline-queue] File objects are not reliably serializable for background sync. Convert files to Base64 or upload separately before queueing.',
    )
  }

  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

async function getDB(config: OfflineQueueConfig): Promise<QueueDatabaseClient> {
  const key = dbCacheKey(config)
  const existing = databaseCache.get(key)
  if (existing) {
    return existing
  }

  const wrappedPromise = (async () => {
    let db = await openDB<QueueDBSchema>(config.dbName, 2, {
      upgrade(database) {
        ensureStores(database as unknown as UpgradableDatabase, config)
      },
    })

    const upgradableDb = db as unknown as UpgradableDatabase
    const missingStore = !upgradableDb.objectStoreNames.contains(config.storeName)
      || !upgradableDb.objectStoreNames.contains(config.failedStoreName)

    if (missingStore) {
      const nextVersion = db.version + 1
      db.close()
      db = await openDB<QueueDBSchema>(config.dbName, nextVersion, {
        upgrade(database) {
          ensureStores(database as unknown as UpgradableDatabase, config)
        },
      })
    }

    return db as unknown as QueueDatabaseClient
  })()
  databaseCache.set(key, wrappedPromise)
  return wrappedPromise
}

export async function getAllQueuedActions(
  config: OfflineQueueConfig,
  failed = false,
): Promise<QueuedAction[]> {
  const db = await getDB(config)
  const storeName = failed ? config.failedStoreName : config.storeName
  const actions = await db.getAll(storeName)
  return actions.sort((a, b) => a.timestamp - b.timestamp)
}

export async function putQueuedAction(
  config: OfflineQueueConfig,
  item: QueuedAction,
  failed = false,
): Promise<void> {
  const db = await getDB(config)
  const storeName = failed ? config.failedStoreName : config.storeName
  await db.put(storeName, item)
}

export async function deleteQueuedAction(
  config: OfflineQueueConfig,
  id: string,
  failed = false,
): Promise<void> {
  const db = await getDB(config)
  const storeName = failed ? config.failedStoreName : config.storeName
  await db.delete(storeName, id)
}

export async function clearQueuedStore(config: OfflineQueueConfig, failed = false): Promise<void> {
  const db = await getDB(config)
  const storeName = failed ? config.failedStoreName : config.storeName
  await db.clear(storeName)
}

export async function moveToFailed(
  config: OfflineQueueConfig,
  item: QueuedAction,
  validationErrors?: ValidationErrors,
): Promise<void> {
  await deleteQueuedAction(config, item.id, false)
  await putQueuedAction(
    config,
    {
      ...item,
      validationErrors,
    },
    true,
  )
}
