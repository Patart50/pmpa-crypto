/**
 * Lots d'import : chaque import (une plateforme, un ou plusieurs fichiers)
 * forme un lot qu'on peut filtrer ou supprimer sans toucher aux autres (D-044).
 *
 * Les transactions importées avant l'existence des lots n'ont pas d'importId :
 * leur lot est reconstitué à partir de `source` (« binance:fichier »,
 * « csv:fichier »). Les ajustements de solde Binance sans source rejoignent
 * le lot Binance le plus gros.
 */
import type { Transaction } from './transactions';

export interface ImportBatch {
  platform: string;
  /** Noms des fichiers importés. */
  files: string[];
  /** Date-heure ISO de l'import. */
  importedAt: string;
}

export interface BatchSummary {
  /** Identifiant du lot ; « manual » pour les saisies à la main. */
  id: string;
  platform: string;
  files: string[];
  importedAt?: string;
  count: number;
  /** Transactions importées puis modifiées à la main. */
  edited: number;
  /** Ids des transactions du lot. */
  ids: string[];
  /** Lot reconstitué (import antérieur aux lots). */
  legacy: boolean;
}

export const MANUAL_BATCH = 'manual';
const LEGACY_PREFIX = 'legacy:';

/** Plateforme et fichier d'après le champ `source` d'une transaction importée avant les lots. */
function fromSource(source: string, platform: string | undefined): { platform: string; file: string } {
  const sep = source.indexOf(':');
  const kind = sep >= 0 ? source.slice(0, sep) : source;
  const file = sep >= 0 ? source.slice(sep + 1) : source;
  if (kind === 'binance') return { platform: 'Binance', file };
  return { platform: platform || 'Fichier CSV', file };
}

/** Identifiant du lot d'une transaction (sans le registre). */
export function batchKey(tx: Pick<Transaction, 'id' | 'importId' | 'source'>): string {
  if (tx.importId) return tx.importId;
  if (tx.source) return `${LEGACY_PREFIX}${tx.source}`;
  if (tx.id.startsWith('bnadj-')) return `${LEGACY_PREFIX}binance-adjustments`;
  return MANUAL_BATCH;
}

/** Regroupe les transactions par lot, du plus récent au plus ancien ; saisies manuelles en dernier. */
export function listBatches(transactions: readonly Transaction[], registry: Record<string, ImportBatch> = {}): BatchSummary[] {
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    const key = batchKey(tx);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(tx);
  }

  // Ajustements Binance antérieurs aux lots : rattachés au plus gros lot Binance reconstitué.
  const orphan = groups.get(`${LEGACY_PREFIX}binance-adjustments`);
  if (orphan) {
    const target = [...groups.entries()]
      .filter(([k]) => k.startsWith(`${LEGACY_PREFIX}binance:`))
      .sort((a, b) => b[1].length - a[1].length)[0];
    if (target) {
      target[1].push(...orphan);
      groups.delete(`${LEGACY_PREFIX}binance-adjustments`);
    }
  }

  const summaries: BatchSummary[] = [];
  for (const [id, txs] of groups) {
    const ids = txs.map((t) => t.id);
    const edited = txs.filter((t) => t.edited).length;
    if (id === MANUAL_BATCH) {
      summaries.push({ id, platform: 'Saisies à la main', files: [], count: txs.length, edited: 0, ids, legacy: false });
      continue;
    }
    const meta = registry[id];
    if (meta) {
      summaries.push({ id, platform: meta.platform, files: meta.files, importedAt: meta.importedAt, count: txs.length, edited, ids, legacy: false });
      continue;
    }
    const sourced = txs.find((t) => t.source);
    const origin = sourced ? fromSource(sourced.source!, sourced.platform) : { platform: 'Binance', file: 'ajustements' };
    summaries.push({ id, platform: origin.platform, files: [origin.file], count: txs.length, edited, ids, legacy: true });
  }
  return summaries.sort((a, b) => {
    if (a.id === MANUAL_BATCH) return 1;
    if (b.id === MANUAL_BATCH) return -1;
    return (b.importedAt ?? '').localeCompare(a.importedAt ?? '');
  });
}
