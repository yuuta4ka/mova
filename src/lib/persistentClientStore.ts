import type { AppConversation, AppMessage, AppUser } from './api';

const DATABASE_NAME = 'mova-client-state';
const DATABASE_VERSION = 1;
const CACHE_STORE = 'cache';
const OUTBOX_STORE = 'outbox';

export interface PersistentCache<T> {
  value: T;
  updatedAt: number;
  hasMore?: boolean;
  nextCursor?: string | null;
}

export interface OutboxEntry {
  clientId: string;
  userId: string;
  conversationId: string;
  message: AppMessage;
  attempts: number;
  updatedAt: number;
  lastError?: string;
}

interface CacheRecord {
  key: string;
  userId: string;
  kind: 'conversations' | 'users' | 'messages';
  conversationId?: string;
  value: AppConversation[] | AppUser[] | AppMessage[];
  updatedAt: number;
  hasMore?: boolean;
  nextCursor?: string | null;
}

export interface PersistentClientState {
  conversations?: PersistentCache<AppConversation[]>;
  users?: PersistentCache<AppUser[]>;
  messages: Map<string, PersistentCache<AppMessage[]>>;
  outbox: OutboxEntry[];
}

let databasePromise: Promise<IDBDatabase | null> | null = null;

const cacheKey = (kind: CacheRecord['kind'], userId: string, conversationId?: string) => `${kind}:${userId}${conversationId ? `:${conversationId}` : ''}`;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CACHE_STORE)) {
        const cache = database.createObjectStore(CACHE_STORE, { keyPath: 'key' });
        cache.createIndex('userId', 'userId');
      }
      if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
        const outbox = database.createObjectStore(OUTBOX_STORE, { keyPath: 'clientId' });
        outbox.createIndex('userId', 'userId');
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return databasePromise;
}

const requestValue = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
});

const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
  transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
});

async function putCache(record: CacheRecord) {
  const database = await openDatabase();
  if (!database) return;
  const transaction = database.transaction(CACHE_STORE, 'readwrite');
  transaction.objectStore(CACHE_STORE).put(record);
  await transactionDone(transaction);
}

export const persistConversations = (userId: string, cache: PersistentCache<AppConversation[]>) =>
  putCache({ key: cacheKey('conversations', userId), userId, kind: 'conversations', ...cache });

export const persistUsers = (userId: string, cache: PersistentCache<AppUser[]>) =>
  putCache({ key: cacheKey('users', userId), userId, kind: 'users', ...cache });

export const persistMessages = (userId: string, conversationId: string, cache: PersistentCache<AppMessage[]>) =>
  putCache({ key: cacheKey('messages', userId, conversationId), userId, conversationId, kind: 'messages', ...cache });

export async function deletePersistentConversation(userId: string, conversationId: string) {
  const database = await openDatabase();
  if (!database) return;
  const readTransaction = database.transaction(OUTBOX_STORE, 'readonly');
  const readDone = transactionDone(readTransaction);
  const entries = await requestValue(readTransaction.objectStore(OUTBOX_STORE).index('userId').getAll(IDBKeyRange.only(userId)) as IDBRequest<OutboxEntry[]>);
  await readDone;
  const writeTransaction = database.transaction([CACHE_STORE, OUTBOX_STORE], 'readwrite');
  writeTransaction.objectStore(CACHE_STORE).delete(cacheKey('messages', userId, conversationId));
  for (const entry of entries) if (entry.conversationId === conversationId) writeTransaction.objectStore(OUTBOX_STORE).delete(entry.clientId);
  await transactionDone(writeTransaction);
}

export async function persistOutbox(entry: OutboxEntry) {
  const database = await openDatabase();
  if (!database) return;
  const transaction = database.transaction(OUTBOX_STORE, 'readwrite');
  transaction.objectStore(OUTBOX_STORE).put(entry);
  await transactionDone(transaction);
}

export async function removeOutbox(clientId: string) {
  const database = await openDatabase();
  if (!database) return;
  const transaction = database.transaction(OUTBOX_STORE, 'readwrite');
  transaction.objectStore(OUTBOX_STORE).delete(clientId);
  await transactionDone(transaction);
}

export async function loadPersistentClientState(userId: string): Promise<PersistentClientState> {
  const empty = (): PersistentClientState => ({ messages: new Map(), outbox: [] });
  try {
    const database = await openDatabase();
    if (!database) return empty();
    const transaction = database.transaction([CACHE_STORE, OUTBOX_STORE], 'readonly');
    const done = transactionDone(transaction);
    const cacheRequest = transaction.objectStore(CACHE_STORE).index('userId').getAll(IDBKeyRange.only(userId)) as IDBRequest<CacheRecord[]>;
    const outboxRequest = transaction.objectStore(OUTBOX_STORE).index('userId').getAll(IDBKeyRange.only(userId)) as IDBRequest<OutboxEntry[]>;
    const [records, outbox] = await Promise.all([requestValue(cacheRequest), requestValue(outboxRequest)]);
    await done;
    const state = empty();
    for (const record of records) {
      const cache = { value: record.value, updatedAt: record.updatedAt, hasMore: record.hasMore, nextCursor: record.nextCursor };
      if (record.kind === 'conversations' && Array.isArray(record.value)) state.conversations = cache as PersistentCache<AppConversation[]>;
      if (record.kind === 'users' && Array.isArray(record.value)) state.users = cache as PersistentCache<AppUser[]>;
      if (record.kind === 'messages' && record.conversationId && Array.isArray(record.value)) state.messages.set(record.conversationId, cache as PersistentCache<AppMessage[]>);
    }
    state.outbox = outbox
      .filter((entry) => entry?.clientId && entry?.message?.clientId === entry.clientId && entry.userId === userId)
      .sort((first, second) => first.message.createdAt.localeCompare(second.message.createdAt));
    return state;
  } catch {
    return empty();
  }
}

export async function clearPersistentUserData(userId: string) {
  const database = await openDatabase();
  if (!database) return;
  const readTransaction = database.transaction([CACHE_STORE, OUTBOX_STORE], 'readonly');
  const readDone = transactionDone(readTransaction);
  const [cacheRecords, outboxRecords] = await Promise.all([
    requestValue(readTransaction.objectStore(CACHE_STORE).index('userId').getAllKeys(IDBKeyRange.only(userId))),
    requestValue(readTransaction.objectStore(OUTBOX_STORE).index('userId').getAllKeys(IDBKeyRange.only(userId))),
  ]);
  await readDone;
  const writeTransaction = database.transaction([CACHE_STORE, OUTBOX_STORE], 'readwrite');
  cacheRecords.forEach((key) => writeTransaction.objectStore(CACHE_STORE).delete(key));
  outboxRecords.forEach((key) => writeTransaction.objectStore(OUTBOX_STORE).delete(key));
  await transactionDone(writeTransaction);
}

export async function resetPersistentClientStore() {
  const database = await databasePromise;
  database?.close();
  databasePromise = null;
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
