/**
 * Persistance locale dans IndexedDB.
 *
 * IndexedDB plutôt que localStorage : capacité bien supérieure (milliers de
 * transactions importées), écritures transactionnelles. Les données restent
 * dans le navigateur ; l'export JSON (schema.ts) est la sauvegarde durable.
 */
import type { Transaction } from '../core/transactions';
import type { Settings } from './schema';

const DB_NAME = 'pmpa-crypto';
const DB_VERSION = 1;
const TX_STORE = 'transactions';
const KV_STORE = 'kv';
const SETTINGS_KEY = 'settings';

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction IndexedDB annulée.'));
  });
}

export class LocalStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<LocalStore> {
    const request = factory.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TX_STORE)) db.createObjectStore(TX_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
    };
    return new LocalStore(await promisify(request));
  }

  async listTransactions(): Promise<Transaction[]> {
    const tx = this.db.transaction(TX_STORE, 'readonly');
    return promisify(tx.objectStore(TX_STORE).getAll() as IDBRequest<Transaction[]>);
  }

  /** Crée ou remplace une transaction (même id). */
  async putTransaction(transaction: Transaction): Promise<void> {
    await this.putTransactions([transaction]);
  }

  async putTransactions(transactions: Transaction[]): Promise<void> {
    const tx = this.db.transaction(TX_STORE, 'readwrite');
    const store = tx.objectStore(TX_STORE);
    // Copie structurée « propre » : pas de proxys réactifs Svelte dans la base.
    for (const t of transactions) store.put(JSON.parse(JSON.stringify(t)));
    await done(tx);
  }

  async deleteTransaction(id: string): Promise<void> {
    await this.deleteTransactions([id]);
  }

  async deleteTransactions(ids: string[]): Promise<void> {
    const tx = this.db.transaction(TX_STORE, 'readwrite');
    const store = tx.objectStore(TX_STORE);
    for (const id of ids) store.delete(id);
    await done(tx);
  }

  async getSettings(): Promise<Settings> {
    const tx = this.db.transaction(KV_STORE, 'readonly');
    const value = await promisify(tx.objectStore(KV_STORE).get(SETTINGS_KEY) as IDBRequest<Settings | undefined>);
    return value ?? {};
  }

  async saveSettings(settings: Settings): Promise<void> {
    const tx = this.db.transaction(KV_STORE, 'readwrite');
    tx.objectStore(KV_STORE).put(JSON.parse(JSON.stringify(settings)), SETTINGS_KEY);
    await done(tx);
  }

  /** Remplace tout le contenu (import d'une sauvegarde), de façon atomique. */
  async replaceAll(transactions: Transaction[], settings: Settings): Promise<void> {
    const tx = this.db.transaction([TX_STORE, KV_STORE], 'readwrite');
    const txStore = tx.objectStore(TX_STORE);
    txStore.clear();
    for (const t of transactions) txStore.put(JSON.parse(JSON.stringify(t)));
    tx.objectStore(KV_STORE).put(JSON.parse(JSON.stringify(settings)), SETTINGS_KEY);
    await done(tx);
  }

  async clear(): Promise<void> {
    await this.replaceAll([], {});
  }

  close(): void {
    this.db.close();
  }
}
