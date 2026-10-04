/**
 * Import CSV générique : l'utilisateur associe les colonnes de son fichier
 * aux champs de l'outil (avec une proposition automatique), puis les valeurs
 * de sa colonne « type » aux types de transaction.
 *
 * Le format d'export de pmpa-crypto est reconnu automatiquement et se
 * réimporte sans perte.
 */
import { dec } from '../core/money';
import { EUR, normalizeAsset, TRANSACTION_TYPES, type Transaction, type TransactionType } from '../core/transactions';
import { toCsv, type CsvTable } from './csv';
import { bump, PARIS, stableId, toParisTime, type IgnoredGroup, type ImportReport } from './common';

export const FIELDS = [
  'date',
  'type',
  'inAsset',
  'inQty',
  'outAsset',
  'outQty',
  'eur',
  'feeAsset',
  'feeQty',
  'feeEur',
  'portfolioValue',
  'fiscalCost',
  'movedAsset',
  'movedQty',
  'platform',
  'note',
  'id',
] as const;
export type Field = (typeof FIELDS)[number];

export const FIELD_LABELS: Record<Field, string> = {
  date: 'Date',
  type: 'Type d’opération',
  inAsset: 'Actif reçu',
  inQty: 'Quantité reçue',
  outAsset: 'Actif cédé',
  outQty: 'Quantité cédée',
  eur: 'Montant en euros',
  feeAsset: 'Actif des frais',
  feeQty: 'Montant des frais',
  feeEur: 'Frais en euros (contre-valeur)',
  portfolioValue: 'Valeur du portefeuille avant cession',
  fiscalCost: 'Prix d’acquisition fiscal',
  movedAsset: 'Actif transféré',
  movedQty: 'Quantité transférée',
  platform: 'Plateforme',
  note: 'Note',
  id: 'Identifiant',
};

/** Champs proposés dans l'écran d'association (les autres restent possibles via le format pmpa-crypto). */
export const MAPPABLE_FIELDS: Field[] = ['date', 'type', 'inAsset', 'inQty', 'outAsset', 'outQty', 'eur', 'feeAsset', 'feeQty', 'portfolioValue', 'platform', 'note'];

/** En-têtes du format d'export pmpa-crypto, dans l'ordre. */
export const PMPA_HEADERS: Record<Field, string> = {
  date: 'date',
  type: 'type',
  inAsset: 'in_asset',
  inQty: 'in_quantity',
  outAsset: 'out_asset',
  outQty: 'out_quantity',
  eur: 'eur',
  feeAsset: 'fee_asset',
  feeQty: 'fee_quantity',
  feeEur: 'fee_eur',
  portfolioValue: 'portfolio_value_eur',
  fiscalCost: 'fiscal_cost_eur',
  movedAsset: 'moved_asset',
  movedQty: 'moved_quantity',
  platform: 'platform',
  note: 'note',
  id: 'id',
};

export type Mapping = Partial<Record<Field, number>>;
export type DateFormat = 'iso' | 'dmy' | 'mdy' | 'unix';
export type DecimalSep = '.' | ',';
export type TypeChoice = TransactionType | 'ignore';

export interface GenericOptions {
  fileName: string;
  mapping: Mapping;
  /** Valeur brute de la colonne type → type de transaction. */
  typeValues: Record<string, TypeChoice>;
  dateFormat: DateFormat;
  decimal: DecimalSep;
  /** Décalage des dates sans fuseau, en minutes ; null : heure de Paris. */
  offsetMinutes: number | null;
  platform?: string;
}

// ---------------------------------------------------------------------------
// Détection
// ---------------------------------------------------------------------------

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const SYNONYMS: Record<Field, RegExp> = {
  date: /^(date|time|timestamp|datetime|horodatage|duree|utc time|date heure|date time|created at|operation date)$/,
  type: /^(type|operation|operation type|transaction type|kind|nature|categorie|category|side|sens)$/,
  inAsset: /^(in asset|actif recu|received asset|received currency|buy currency|buy asset|incoming asset|to asset|to currency|asset in|devise recue)$/,
  inQty: /^(in quantity|in amount|quantite recue|montant recu|received quantity|received amount|buy amount|buy quantity|incoming amount|to amount|amount in|quantity in)$/,
  outAsset: /^(out asset|actif cede|sent asset|sent currency|sell currency|sell asset|outgoing asset|from asset|from currency|asset out|devise cedee)$/,
  outQty: /^(out quantity|out amount|quantite cedee|montant cede|sent quantity|sent amount|sell amount|sell quantity|outgoing amount|from amount|amount out|quantity out)$/,
  eur: /^(eur|montant eur|montant en euros|amount eur|value eur|eur value|valeur eur|total eur|euro amount|subtotal|total)$/,
  feeAsset: /^(fee asset|fee currency|frais devise|actif des frais|commission asset|fee coin)$/,
  feeQty: /^(fee|fees|fee amount|fee quantity|frais|montant des frais|commission)$/,
  feeEur: /^(fee eur|frais eur)$/,
  portfolioValue: /^(portfolio value eur|valeur portefeuille|portfolio value)$/,
  fiscalCost: /^(fiscal cost eur)$/,
  movedAsset: /^(moved asset)$/,
  movedQty: /^(moved quantity)$/,
  platform: /^(platform|plateforme|exchange|wallet|source)$/,
  note: /^(note|notes|comment|commentaire|description|label|libelle|remark|remarque)$/,
  id: /^(id|txid|transaction id|identifiant)$/,
};

/** Format d'export de pmpa-crypto ? */
export function isPmpaFormat(headers: string[]): boolean {
  return ['date', 'type', 'in_asset', 'in_quantity', 'out_asset', 'out_quantity', 'eur'].every((h) => headers.includes(h));
}

export function guessMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  if (isPmpaFormat(headers)) {
    for (const field of FIELDS) {
      const i = headers.indexOf(PMPA_HEADERS[field]);
      if (i >= 0) mapping[field] = i;
    }
    return mapping;
  }
  const used = new Set<number>();
  for (const field of FIELDS) {
    const i = headers.findIndex((h, index) => !used.has(index) && SYNONYMS[field].test(norm(h)));
    if (i >= 0) {
      mapping[field] = i;
      used.add(i);
    }
  }
  return mapping;
}

const TYPE_SYNONYMS: [RegExp, TypeChoice][] = [
  [/^(buy|achat|purchase|acheter|bought|advanced trade buy|buy crypto)$/, 'buy'],
  [/^(sell|vente|vendre|sold|advanced trade sell)$/, 'sell'],
  [/^(swap|convert|conversion|echange|exchange|trade|transaction)$/, 'swap'],
  [/^(payment|paiement|spend|depense|card spend|purchase with crypto)$/, 'payment'],
  [/^(airdrop|airdrops|airdrop assets|distribution|launchpool|megadrop)$/, 'airdrop'],
  [/^(reward|rewards|recompense|staking|staking income|staking reward|interest|interet|interets|bonus|income|learning reward|earn|mining|cashback)$/, 'reward'],
  [/^(gift|don|donation|gift sent|don envoye|loss|perte|lost|stolen|vol)$/, 'gift'],
  [/^(transfer|transfert|deposit|depot|withdraw|withdrawal|retrait|send|receive|envoi|reception|internal transfer)$/, 'transfer'],
  [/^(margin|marge|futures|liquidation)$/, 'margin'],
  [/^(fiat deposit|fiat withdrawal|depot fiat|retrait fiat|ignore|ignorer)$/, 'ignore'],
];

export function guessTypeValue(value: string): TypeChoice | undefined {
  const v = norm(value);
  if ((TRANSACTION_TYPES as readonly string[]).includes(v)) return v as TransactionType;
  for (const [re, type] of TYPE_SYNONYMS) if (re.test(v)) return type;
  return undefined;
}

export function distinctValues(table: CsvTable, column: number | undefined, limit = 50): string[] {
  if (column === undefined) return [];
  const seen = new Set<string>();
  for (const row of table.rows) {
    const v = (row[column] ?? '').trim();
    if (v) seen.add(v);
    if (seen.size >= limit) break;
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export function guessDateFormat(samples: string[]): DateFormat {
  const s = samples.map((x) => x.trim()).filter(Boolean).slice(0, 200);
  if (s.length === 0) return 'iso';
  if (s.every((x) => /^\d{10}(\d{3})?$/.test(x))) return 'unix';
  if (s.every((x) => /^\d{4}-\d{2}-\d{2}/.test(x))) return 'iso';
  // JJ/MM ou MM/JJ : un premier nombre > 12 tranche pour le format français.
  const firsts = s.map((x) => /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/.exec(x)).filter(Boolean) as RegExpExecArray[];
  if (firsts.some((m) => Number(m[2]) > 12)) return 'mdy';
  return 'dmy';
}

export function guessDecimal(samples: string[]): DecimalSep {
  const s = samples.map((x) => x.trim()).filter(Boolean).slice(0, 200);
  const comma = s.filter((x) => /^-?[\d\s.]*,\d+$/.test(x)).length;
  const dot = s.filter((x) => /^-?[\d\s,]*\.\d+$/.test(x)).length;
  return comma > dot ? ',' : '.';
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

const pad = (n: number | string) => String(n).padStart(2, '0');

/** Date du fichier → date-heure locale de Paris (AAAA-MM-JJTHH:mm:ss). */
export function parseDate(raw: string, format: DateFormat, offsetMinutes: number | null): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (format === 'unix') {
    if (!/^\d{10}(\d{3})?$/.test(v)) return null;
    const ms = v.length === 13 ? Number(v) : Number(v) * 1000;
    const d = new Date(ms);
    return toParisTime(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`, 0);
  }
  let y: string, mo: string, d: string, rest: string;
  if (format === 'iso') {
    const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(v);
    if (!m) return null;
    [, y, mo, d, rest] = m;
  } else {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(.*)$/.exec(v);
    if (!m) return null;
    const [, a, b, yy, r] = m;
    [d, mo] = format === 'dmy' ? [a, b] : [b, a];
    y = yy.length === 2 ? `20${yy}` : yy;
    rest = r;
  }
  const t = /^[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|UTC|[+-]\d{2}:?\d{2})?\s*$/i.exec(rest);
  if (rest.trim() !== '' && !t) return null;
  const hh = t ? pad(t[1]) : '00';
  const mi = t ? t[2] : '00';
  const ss = t?.[3] ?? '00';
  const wall = `${y}-${pad(mo)}-${pad(d)} ${hh}:${mi}:${ss}`;
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  const zone = t?.[4];
  if (zone) {
    const offset = /^(z|utc)$/i.test(zone) ? 0 : (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)));
    return toParisTime(wall, offset);
  }
  if (offsetMinutes === null) return `${y}-${pad(mo)}-${pad(d)}T${hh}:${mi}:${ss}`;
  return toParisTime(wall, offsetMinutes);
}

/** Nombre du fichier → chaîne décimale positive, undefined si vide, null si illisible. */
export function parseNumber(raw: string | undefined, decimal: DecimalSep): string | undefined | null {
  if (raw === undefined) return undefined;
  let v = raw.trim().replace(/[\s  €$£]/g, '').replace(/^\+/, '');
  if (v === '' || v === '-') return undefined;
  v = decimal === ',' ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '');
  try {
    const d = dec(v);
    return d.isFinite() ? d.abs().toString() : null;
  } catch {
    return null;
  }
}

export interface RowResult {
  tx?: Transaction;
  ignored?: boolean;
  error?: string;
}

/** Convertit une ligne. Exporté pour l'aperçu de l'écran d'association. */
export function convertRow(row: string[], rowIndex: number, options: GenericOptions): RowResult {
  const get = (field: Field) => {
    const i = options.mapping[field];
    return i === undefined ? '' : (row[i] ?? '').trim();
  };
  const num = (field: Field) => parseNumber(get(field) || undefined, options.decimal);

  const date = parseDate(get('date'), options.dateFormat, options.offsetMinutes);
  if (!date) return { error: `date illisible « ${get('date')} »` };

  let type: TypeChoice | undefined;
  const rawType = get('type');
  if (options.mapping.type !== undefined) {
    type = options.typeValues[rawType] ?? guessTypeValue(rawType);
    if (!type) return { error: `type « ${rawType} » non associé` };
  }
  if (type === 'ignore') return { ignored: true };

  const numbers = { inQty: num('inQty'), outQty: num('outQty'), eur: num('eur'), feeQty: num('feeQty'), feeEur: num('feeEur'), portfolioValue: num('portfolioValue'), fiscalCost: num('fiscalCost'), movedQty: num('movedQty') };
  for (const [field, value] of Object.entries(numbers)) {
    if (value === null) return { error: `${FIELD_LABELS[field as Field].toLowerCase()} illisible « ${get(field as Field)} »` };
  }
  let inAsset = get('inAsset') ? normalizeAsset(get('inAsset')) : '';
  let outAsset = get('outAsset') ? normalizeAsset(get('outAsset')) : '';
  let { inQty, outQty, eur } = numbers as Record<string, string | undefined>;

  // L'euro comme « actif » : achat ou vente.
  if (outAsset === EUR && inAsset && inAsset !== EUR) {
    eur = eur ?? outQty;
    outAsset = '';
    outQty = undefined;
    type = type ?? 'buy';
  }
  if (inAsset === EUR && outAsset && outAsset !== EUR) {
    eur = eur ?? inQty;
    inAsset = '';
    inQty = undefined;
    type = type ?? 'sell';
  }

  if (!type) {
    if (inAsset && outAsset) type = 'swap';
    else if (inAsset && eur) type = 'buy';
    else if (outAsset && eur) type = 'sell';
    else return { error: 'type impossible à déduire : associez une colonne « type »' };
  }

  // Un seul couple actif/quantité renseigné : on le place selon le type.
  const single = (inAsset && !outAsset) || (!inAsset && outAsset);
  if (single && (type === 'sell' || type === 'payment' || type === 'gift') && inAsset) {
    [outAsset, outQty, inAsset, inQty] = [inAsset, inQty, '', undefined];
  }
  if (single && (type === 'buy' || type === 'reward' || type === 'airdrop') && outAsset) {
    [inAsset, inQty, outAsset, outQty] = [outAsset, outQty, '', undefined];
  }

  const tx: Transaction = {
    id: get('id') || stableId('csv', `${options.fileName}|${rowIndex}|${row.join('|')}`),
    date,
    type,
  };
  if (type === 'transfer') {
    const asset = get('movedAsset') || inAsset || outAsset;
    const qty = numbers.movedQty ?? inQty ?? outQty;
    if (asset && qty) tx.moved = { asset: normalizeAsset(asset), quantity: qty };
  } else {
    if (inAsset && type !== 'sell' && type !== 'payment' && type !== 'gift') tx.in = { asset: inAsset, quantity: inQty ?? '' };
    if (outAsset && type !== 'buy' && type !== 'reward' && type !== 'airdrop') tx.out = { asset: outAsset, quantity: outQty ?? '' };
  }
  if (eur !== undefined && type !== 'transfer' && type !== 'margin') tx.eur = eur;
  if (numbers.feeQty && numbers.feeQty !== '0') {
    tx.fee = { asset: get('feeAsset') ? normalizeAsset(get('feeAsset')) : EUR, quantity: numbers.feeQty };
    if (numbers.feeEur && tx.fee.asset !== EUR) tx.fee.eur = numbers.feeEur;
  }
  if (numbers.portfolioValue && (type === 'sell' || type === 'payment')) tx.portfolioValueEur = numbers.portfolioValue;
  if (numbers.fiscalCost && (type === 'reward' || type === 'airdrop')) tx.fiscalCostEur = numbers.fiscalCost;
  const platform = get('platform') || options.platform;
  if (platform) tx.platform = platform;
  if (get('note')) tx.note = get('note');
  if (options.mapping.type !== undefined && rawType && !(TRANSACTION_TYPES as readonly string[]).includes(rawType) && !tx.note) tx.note = rawType;
  tx.source = `csv:${options.fileName}`;
  return { tx };
}

export function parseGeneric(table: CsvTable, options: GenericOptions): ImportReport {
  const transactions: Transaction[] = [];
  const ignored = new Map<string, IgnoredGroup>();
  const seen = new Set<string>();
  let from = '';
  let to = '';
  table.rows.forEach((row, index) => {
    const r = convertRow(row, index, options);
    if (r.ignored) {
      bump(ignored, 'ignored', { category: 'euro', label: 'Lignes ignorées à votre demande' }, row[options.mapping.type ?? 0]);
      return;
    }
    if (!r.tx) {
      bump(ignored, 'invalid', { category: 'invalid', label: 'Lignes illisibles' }, `ligne ${index + 2} : ${r.error}`);
      return;
    }
    if (seen.has(r.tx.id)) {
      bump(ignored, 'dup', { category: 'zero', label: 'Lignes en double dans le fichier' }, `ligne ${index + 2}`);
      return;
    }
    seen.add(r.tx.id);
    if (!from || r.tx.date < from) from = r.tx.date;
    if (!to || r.tx.date > to) to = r.tx.date;
    transactions.push(r.tx);
  });
  return {
    format: isPmpaFormat(table.headers) ? 'Export pmpa-crypto' : 'CSV personnalisé',
    fileName: options.fileName,
    lineCount: table.rows.length,
    transactions,
    ignored: [...ignored.values()].sort((a, b) => b.lines - a.lines),
    notes: options.offsetMinutes === null ? [`Dates sans fuseau lues à l'heure de Paris (${PARIS}).`] : [],
    period: from ? { from, to } : undefined,
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Export CSV au format pmpa-crypto (réimportable sans perte). */
export function transactionsToCsv(transactions: readonly Transaction[]): string {
  const headers = FIELDS.map((f) => PMPA_HEADERS[f]);
  const rows = transactions.map((t) => [
    t.date,
    t.type,
    t.in?.asset,
    t.in?.quantity,
    t.out?.asset,
    t.out?.quantity,
    t.eur,
    t.fee?.asset,
    t.fee?.quantity,
    t.fee?.eur,
    t.portfolioValueEur,
    t.fiscalCostEur,
    t.moved?.asset,
    t.moved?.quantity,
    t.platform,
    t.note,
    t.id,
  ]);
  return toCsv(headers, rows);
}

export function pmpaOptions(table: CsvTable, fileName: string): GenericOptions {
  return {
    fileName,
    mapping: guessMapping(table.headers),
    typeValues: {},
    dateFormat: 'iso',
    decimal: '.',
    offsetMinutes: null,
  };
}
