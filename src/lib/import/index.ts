/** Point d'entrée de l'import : reconnaît le format d'un fichier. */
import { parseCsv, type CsvTable } from './csv';
import { detectBinanceLedger } from './binance';
import { offsetFromFileName } from './common';
import { isPmpaFormat } from './generic';
import { detectCoinbase } from './coinbase';
import { detectKrakenLedger } from './kraken';

export type Platform = 'auto' | 'binance' | 'coinbase' | 'kraken' | 'other';

export const PLATFORM_LABELS: Record<Exclude<Platform, 'auto'>, string> = {
  binance: 'Binance',
  coinbase: 'Coinbase',
  kraken: 'Kraken',
  other: 'Autre plateforme (association des colonnes)',
};

/** Export attendu pour chaque plateforme reconnue (affiché si le fichier ne correspond pas). */
export const EXPECTED_EXPORT: Record<'binance' | 'coinbase' | 'kraken', string> = {
  binance: 'Binance → Portefeuille → Historique des transactions → Exporter (journal « Transaction History »).',
  coinbase: 'Coinbase → Relevés (« Statements ») → Historique des transactions (« Transaction history »), format CSV.',
  kraken: 'Kraken → Documents → Exports → « Ledgers » (grand livre), format CSV, toutes les colonnes.',
};

/**
 * Trouve la vraie ligne d'en-tête : certains exports (Coinbase) commencent
 * par des lignes d'identification ou des lignes vides (D-048).
 */
export function findHeaderRow(table: CsvTable): CsvTable {
  const all = [table.headers, ...table.rows];
  const sample = all.slice(0, 20);
  const filled = (r: string[]) => r.filter((c) => c.trim() !== '').length;
  const widest = Math.max(...sample.map(filled));
  const textual = (r: string[]) => r.filter((c) => c.trim() !== '' && !/^[-+$€]?[\d.,\s:/-]+$/.test(c.trim())).length;
  const index = sample.findIndex((r) => filled(r) >= Math.max(2, Math.ceil(widest * 0.6)) && textual(r) >= filled(r) * 0.6);
  if (index <= 0) return table;
  return { ...table, headers: all[index].map((h) => h.trim()), rows: all.slice(index + 1) };
}

export type DetectedFile =
  | { kind: 'binance'; fileName: string; table: CsvTable; offsetMinutes: number | null }
  | { kind: 'coinbase'; fileName: string; table: CsvTable }
  | { kind: 'kraken'; fileName: string; table: CsvTable }
  | { kind: 'pmpa'; fileName: string; table: CsvTable }
  | { kind: 'generic'; fileName: string; table: CsvTable }
  | { kind: 'error'; fileName: string; message: string };

const lower = (headers: string[]) => headers.map((h) => h.trim().toLowerCase());

export function detectFile(text: string, fileName: string, platform: Platform = 'auto'): DetectedFile {
  if (!text.trim()) return { kind: 'error', fileName, message: 'Le fichier est vide.' };
  let table: CsvTable;
  try {
    table = findHeaderRow(parseCsv(text));
  } catch {
    return { kind: 'error', fileName, message: "Ce fichier n'est pas un CSV lisible." };
  }
  if (table.headers.length < 2) return { kind: 'error', fileName, message: "Une seule colonne détectée : ce fichier n'est pas un CSV de transactions." };
  const h = lower(table.headers);
  if (['open', 'high', 'low', 'close'].every((c) => h.includes(c))) {
    return {
      kind: 'error',
      fileName,
      message: 'Ce fichier est un historique de prix (colonnes open, high, low, close), pas une liste de transactions.',
    };
  }
  if (['txid', 'ordertxid', 'pair', 'vol'].every((c) => h.includes(c))) {
    return {
      kind: 'error',
      fileName,
      message: `Export Kraken « Trades » : il ne contient que les ordres, sans dépôts, retraits ni staking. ${EXPECTED_EXPORT.kraken}`,
    };
  }
  if (table.rows.length === 0) return { kind: 'error', fileName, message: 'Le fichier ne contient aucune ligne de données.' };

  const detected: DetectedFile = detectBinanceLedger(table.headers)
    ? { kind: 'binance', fileName, table, offsetMinutes: offsetFromFileName(fileName) }
    : detectCoinbase(table.headers)
      ? { kind: 'coinbase', fileName, table }
      : detectKrakenLedger(table.headers)
        ? { kind: 'kraken', fileName, table }
        : isPmpaFormat(table.headers)
          ? { kind: 'pmpa', fileName, table }
          : { kind: 'generic', fileName, table };

  if (platform === 'other') return { kind: 'generic', fileName, table };
  if (platform !== 'auto' && detected.kind !== platform) {
    return {
      kind: 'error',
      fileName,
      message: `Ce fichier ne ressemble pas à un export ${PLATFORM_LABELS[platform]} reconnu (colonnes trouvées : ${table.headers.slice(0, 6).join(', ')}…). ${EXPECTED_EXPORT[platform]} Sinon, choisissez « Autre plateforme ».`,
    };
  }
  return detected;
}

export type { ImportReport, IgnoredGroup } from './common';
