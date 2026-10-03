/**
 * État de l'application (Svelte 5, runes) relié au stockage local.
 *
 * Toutes les données vivent dans IndexedDB. Si IndexedDB est indisponible
 * (navigation privée stricte), l'application fonctionne en mémoire et le
 * signale : rien n'est conservé à la fermeture de l'onglet.
 */
import { computeFiscalFromTransactions } from '../core/ledger';
import { computePortfolio } from '../core/portfolio';
import { sortTransactions, type Transaction } from '../core/transactions';
import { LocalStore } from '../storage/db';
import { backupFileName, createBackup, parseBackup, serializeBackup, type Settings, type Theme } from '../storage/schema';
import { SAMPLE_PRICES, sampleTransactions } from './sample';

export type ImportOutcome = { ok: true; count: number; issueCount: number } | { ok: false; errors: string[] };

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

class AppState {
  transactions = $state<Transaction[]>([]);
  settings = $state<Settings>({});
  ready = $state(false);
  /** Vrai si les données ne peuvent pas être conservées (IndexedDB indisponible). */
  memoryOnly = $state(false);

  private store: LocalStore | null = null;

  /** Transactions triées, la plus récente en premier (affichage). */
  readonly newestFirst = $derived(sortTransactions(this.transactions).reverse());

  readonly portfolio = $derived(computePortfolio(this.transactions, { prices: this.settings.prices }));

  readonly fiscal = $derived.by(() => {
    try {
      return { ok: true as const, result: computeFiscalFromTransactions(this.transactions, { rates: this.settings.rates }) };
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
    }
  });

  async init(): Promise<void> {
    try {
      this.store = await LocalStore.open();
      const [transactions, settings] = await Promise.all([this.store.listTransactions(), this.store.getSettings()]);
      this.transactions = transactions;
      this.settings = settings;
    } catch {
      this.memoryOnly = true;
    }
    this.ready = true;
  }

  find(id: string): Transaction | undefined {
    return this.transactions.find((t) => t.id === id);
  }

  async save(tx: Omit<Transaction, 'id'> & { id?: string }): Promise<Transaction> {
    const record: Transaction = { ...tx, id: tx.id ?? newId() } as Transaction;
    const index = this.transactions.findIndex((t) => t.id === record.id);
    if (index >= 0) this.transactions[index] = record;
    else this.transactions.push(record);
    await this.store?.putTransaction(record);
    return record;
  }

  /** Ajoute des transactions importées ; ignore celles déjà présentes (même identifiant). */
  async addMany(transactions: Transaction[]): Promise<{ added: Transaction[]; duplicates: number }> {
    const existing = new Set(this.transactions.map((t) => t.id));
    const added = transactions.filter((t) => !existing.has(t.id));
    if (added.length > 0) {
      await this.store?.putTransactions(added);
      this.transactions = [...this.transactions, ...added];
    }
    return { added, duplicates: transactions.length - added.length };
  }

  /** Met à jour des transactions existantes (même identifiant). */
  async updateMany(transactions: Transaction[]): Promise<void> {
    if (transactions.length === 0) return;
    const byId = new Map(transactions.map((t) => [t.id, t]));
    this.transactions = this.transactions.map((t) => byId.get(t.id) ?? t);
    await this.store?.putTransactions(transactions);
  }

  async removeMany(ids: string[]): Promise<void> {
    const remove = new Set(ids);
    this.transactions = this.transactions.filter((t) => !remove.has(t.id));
    await this.store?.deleteTransactions(ids);
  }

  async remove(id: string): Promise<void> {
    this.transactions = this.transactions.filter((t) => t.id !== id);
    await this.store?.deleteTransaction(id);
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    await this.store?.saveSettings($state.snapshot(this.settings));
  }

  async setPrice(asset: string, price: string | undefined): Promise<void> {
    const prices = { ...(this.settings.prices ?? {}) };
    if (price === undefined) delete prices[asset];
    else prices[asset] = price;
    await this.updateSettings({ prices });
  }

  async setRate(year: number, rate: string | undefined): Promise<void> {
    const rates = { ...(this.settings.rates ?? {}) };
    if (rate === undefined) delete rates[String(year)];
    else rates[String(year)] = rate;
    await this.updateSettings({ rates });
  }

  async setTheme(theme: Theme): Promise<void> {
    await this.updateSettings({ theme });
  }

  /** Contenu du fichier de sauvegarde et nom proposé. */
  exportBackup(): { fileName: string; content: string } {
    const backup = createBackup($state.snapshot(this.transactions), $state.snapshot(this.settings));
    return { fileName: backupFileName(), content: serializeBackup(backup) };
  }

  /** Remplace toutes les données par celles d'une sauvegarde. */
  async importBackup(text: string): Promise<ImportOutcome> {
    const parsed = parseBackup(text);
    if (!parsed.ok || !parsed.backup) return { ok: false, errors: parsed.errors };
    const { transactions, settings } = parsed.backup;
    await this.store?.replaceAll(transactions, settings);
    this.transactions = transactions;
    this.settings = settings;
    return { ok: true, count: transactions.length, issueCount: parsed.issues.length };
  }

  async loadSample(): Promise<void> {
    const transactions = sampleTransactions();
    const settings: Settings = { ...$state.snapshot(this.settings), prices: { ...SAMPLE_PRICES } };
    await this.store?.replaceAll(transactions, settings);
    this.transactions = transactions;
    this.settings = settings;
  }

  async clearAll(): Promise<void> {
    const theme = this.settings.theme;
    const settings: Settings = theme ? { theme } : {};
    await this.store?.replaceAll([], settings);
    this.transactions = [];
    this.settings = settings;
  }
}

export const app = new AppState();
