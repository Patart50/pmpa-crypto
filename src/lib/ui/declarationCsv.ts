/** Export CSV du récapitulatif 2086 d'une année : une ligne par numéro du formulaire, une colonne par cession. */
import type { DeclaredCession, DeclaredYear } from '../core/declaration';

const ROWS: [string, string, (c: DeclaredCession) => string][] = [
  ['211', 'Date de la cession', (c) => c.date.slice(0, 10)],
  ['212', 'Valeur globale du portefeuille', (c) => c.l212.toString()],
  ['213', 'Prix de cession', (c) => c.l213.toString()],
  ['214', 'Frais de cession', (c) => c.l214.toString()],
  ['215', 'Prix de cession net des frais', (c) => c.l215.toString()],
  ['216', 'Soulte reçue ou versée', (c) => c.l216.toString()],
  ['217', 'Prix de cession net des soultes', (c) => c.l217.toString()],
  ['218', 'Prix de cession net des frais et soultes', (c) => c.l218.toString()],
  ['220', "Prix total d'acquisition", (c) => c.l220.toString()],
  ['221', 'Fractions de capital initial', (c) => c.l221.toString()],
  ['222', "Soultes reçues lors d'échanges antérieurs", (c) => c.l222.toString()],
  ['223', "Prix total d'acquisition net", (c) => c.l223.toString()],
  ['224', 'Plus-value ou moins-value', (c) => c.l224.toString()],
];

const cell = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Séparateur « ; » : s'ouvre directement dans un tableur réglé en français. Montants en euros entiers. */
export function declarationCsv(year: DeclaredYear): string {
  const header = ['Ligne', 'Libellé', ...year.cessions.map((_, i) => `Cession ${i + 1}`)];
  const lines = [header, ...ROWS.map(([n, label, get]) => [n, label, ...year.cessions.map(get)])];
  lines.push([]);
  lines.push(['51', 'Total des prix de cession', year.l51.toString()]);
  lines.push(['52', 'Total des plus et moins-values', year.l52.toString()]);
  lines.push([year.box ?? '—', year.box ? `Case ${year.box} de la 2042 C` : 'Rien à reporter en 3AN ni 3BN', year.box ? year.boxAmount.toString() : '']);
  return '﻿' + lines.map((l) => l.map(cell).join(';')).join('\r\n') + '\r\n';
}
