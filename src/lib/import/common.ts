/**
 * Types et utilitaires partagés par les importeurs.
 */
import type { Transaction } from '../core/transactions';

export interface IgnoredGroup {
  /** Catégorie stable (pour les tests et le regroupement). */
  category: 'euro' | 'internal' | 'margin' | 'zero' | 'ambiguous' | 'invalid' | 'unknown';
  /** Libellé affiché. */
  label: string;
  lines: number;
  /** Quelques exemples (opérations, dates) pour aider l'utilisateur. */
  examples: string[];
}

export interface ImportReport {
  format: string;
  fileName: string;
  /** Nombre de lignes de données lues. */
  lineCount: number;
  transactions: Transaction[];
  ignored: IgnoredGroup[];
  /** Messages à afficher (fuseau, champs à compléter…). */
  notes: string[];
  period?: { from: string; to: string };
}

/** Hachage FNV-1a 32 bits, en base 36 : identifiants stables pour le dédoublonnage. */
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Double hachage pour réduire les collisions sur de gros volumes. */
export function stableId(prefix: string, key: string): string {
  return `${prefix}-${hash(key)}${hash(`${key.length}:${key}`)}`;
}

export const PARIS = 'Europe/Paris';

const parisFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: PARIS,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * Convertit une heure « murale » exprimée à un décalage UTC fixe
 * (ex. +2 pour un export Binance « UTC2 ») en heure locale de Paris,
 * changement d'heure compris. Entrée « AAAA-MM-JJ HH:mm(:ss) ».
 */
export function toParisTime(wall: string, offsetMinutes: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(wall.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '0'] = m;
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - offsetMinutes * 60_000;
  const parts = Object.fromEntries(parisFormatter.formatToParts(new Date(utc)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/**
 * Lit le décalage horaire dans un nom de fichier (« …UTC2… », « UTC+5:30 », « UTC-3 »).
 * Renvoie des minutes, ou null si absent.
 */
export function offsetFromFileName(name: string): number | null {
  const m = /UTC([+-]?)(\d{1,2})(?::?(\d{2}))?(?!\d)/i.exec(name);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return minutes > 14 * 60 ? null : sign * minutes;
}

/** Ajoute une ligne à un groupe ignoré, en limitant les exemples. */
export function bump(map: Map<string, IgnoredGroup>, key: string, init: Omit<IgnoredGroup, 'lines' | 'examples'>, example?: string): void {
  let group = map.get(key);
  if (!group) {
    group = { ...init, lines: 0, examples: [] };
    map.set(key, group);
  }
  group.lines++;
  if (example && group.examples.length < 3 && !group.examples.includes(example)) group.examples.push(example);
}
