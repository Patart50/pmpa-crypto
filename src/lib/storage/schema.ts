/**
 * Format de sauvegarde JSON (export / import) et validation à l'import.
 *
 * Le fichier est la seule copie durable des données de l'utilisateur hors du
 * navigateur : il est versionné pour pouvoir évoluer sans casser les anciennes
 * sauvegardes. Toute évolution incompatible incrémente SCHEMA_VERSION et
 * ajoute une étape dans MIGRATIONS.
 */
import {
  TRANSACTION_TYPES,
  validateTransaction,
  type Transaction,
  type ValidationIssue,
} from '../core/transactions';

export const APP_ID = 'pmpa-crypto';
export const SCHEMA_VERSION = 1;

export type Theme = 'auto' | 'light' | 'dark';

export interface Settings {
  /** Surcharges du taux d'imposition par année, ex. { "2026": "0.314" }. */
  rates?: Record<string, string>;
  theme?: Theme;
  /** Derniers prix courants saisis par l'utilisateur (EUR par unité). */
  prices?: Record<string, string>;
  /** L'utilisateur a autorisé la récupération de prix historiques sur Binance (D-026). */
  allowPriceFetch?: boolean;
}

export interface Backup {
  app: typeof APP_ID;
  schemaVersion: number;
  exportedAt: string;
  settings: Settings;
  transactions: Transaction[];
}

export interface ParseResult {
  ok: boolean;
  backup?: Backup;
  /** Erreurs bloquantes : rien n'est importé. */
  errors: string[];
  /** Transactions importées mais incohérentes, à corriger dans l'outil. */
  issues: ValidationIssue[];
}

export function createBackup(transactions: Transaction[], settings: Settings, now = new Date()): Backup {
  return {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    settings,
    transactions,
  };
}

export function serializeBackup(backup: Backup): string {
  return JSON.stringify(backup, null, 2);
}

/** Nom de fichier proposé à l'export. */
export function backupFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `pmpa-crypto-sauvegarde-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/** MIGRATIONS[n] transforme une sauvegarde de version n en version n + 1. */
const MIGRATIONS: Record<number, Migration> = {};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';

function checkAmount(value: unknown, path: string, errors: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value) || !isString(value.asset) || !isString(value.quantity)) {
    errors.push(`${path} : format invalide (attendu { asset, quantity } en texte).`);
  }
}

function checkStringMap(value: unknown, path: string, errors: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value) || !Object.values(value).every(isString)) errors.push(`${path} : format invalide.`);
}

/** Lit et valide une sauvegarde JSON. Ne lève jamais d'exception. */
export function parseBackup(text: string): ParseResult {
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["Ce fichier n'est pas un JSON valide."], issues: [] };
  }
  if (!isRecord(raw) || raw.app !== APP_ID) {
    return { ok: false, errors: ["Ce fichier n'est pas une sauvegarde pmpa-crypto."], issues: [] };
  }

  let version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, errors: ['Version de sauvegarde illisible.'], issues: [] };
  }
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [`Sauvegarde créée par une version plus récente de l'outil (format ${version}). Mettez l'outil à jour.`],
      issues: [],
    };
  }
  let data: Record<string, unknown> = raw;
  while (version < SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) return { ok: false, errors: [`Aucune migration depuis le format ${version}.`], issues: [] };
    data = migrate(data);
    version += 1;
  }

  const settings = data.settings ?? {};
  if (!isRecord(settings)) errors.push('settings : format invalide.');
  else {
    checkStringMap(settings.rates, 'settings.rates', errors);
    checkStringMap(settings.prices, 'settings.prices', errors);
    if (settings.allowPriceFetch !== undefined && typeof settings.allowPriceFetch !== 'boolean') errors.push('settings.allowPriceFetch : booléen attendu.');
    if (settings.theme !== undefined && !['auto', 'light', 'dark'].includes(settings.theme as string)) {
      errors.push('settings.theme : valeur inconnue.');
    }
  }

  if (!Array.isArray(data.transactions)) {
    errors.push('transactions : liste manquante.');
    return { ok: false, errors, issues: [] };
  }

  const seen = new Set<string>();
  data.transactions.forEach((tx, index) => {
    const path = `transactions[${index}]`;
    if (!isRecord(tx)) {
      errors.push(`${path} : format invalide.`);
      return;
    }
    if (!isString(tx.id) || tx.id === '') errors.push(`${path} : identifiant manquant.`);
    else if (seen.has(tx.id)) errors.push(`${path} : identifiant en double « ${tx.id} ».`);
    else seen.add(tx.id);
    if (!isString(tx.date)) errors.push(`${path} : date manquante.`);
    if (!TRANSACTION_TYPES.includes(tx.type as never)) errors.push(`${path} : type inconnu « ${String(tx.type)} ».`);
    checkAmount(tx.in, `${path}.in`, errors);
    checkAmount(tx.out, `${path}.out`, errors);
    checkAmount(tx.moved, `${path}.moved`, errors);
    checkStringMap(tx.holdings, `${path}.holdings`, errors);
    if (tx.fee !== undefined && (!isRecord(tx.fee) || !isString(tx.fee.asset) || !isString(tx.fee.quantity))) {
      errors.push(`${path}.fee : format invalide.`);
    }
    for (const key of ['eur', 'portfolioValueEur', 'fiscalCostEur', 'platform', 'note', 'source'] as const) {
      if (tx[key] !== undefined && !isString(tx[key])) errors.push(`${path}.${key} : texte attendu.`);
    }
  });

  if (errors.length > 0) return { ok: false, errors, issues: [] };

  const transactions = data.transactions as Transaction[];
  const issues = transactions.flatMap(validateTransaction);
  const backup: Backup = {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: isString(data.exportedAt) ? data.exportedAt : '',
    settings: settings as Settings,
    transactions,
  };
  return { ok: true, backup, errors: [], issues };
}
