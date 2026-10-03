/**
 * Brouillon de formulaire ↔ transaction. Les champs du brouillon sont des
 * chaînes telles que saisies (virgule française acceptée).
 */
import { EUR, normalizeAsset, validateTransaction, type Transaction, type TransactionType } from '../core/transactions';
import { parseInput } from './format';

export interface Draft {
  id?: string;
  type: TransactionType;
  date: string;
  inAsset: string;
  inQty: string;
  outAsset: string;
  outQty: string;
  eur: string;
  feeAsset: string;
  feeQty: string;
  feeEur: string;
  portfolioValue: string;
  fiscalCost: string;
  movedAsset: string;
  movedQty: string;
  platform: string;
  note: string;
  /** Champs non édités dans le formulaire, conservés tels quels. */
  source?: string;
  holdings?: Record<string, string>;
  originalDate?: string;
}

export type DraftErrors = Partial<Record<keyof Draft, string>>;

const fr = (v: string | undefined) => (v ?? '').replace('.', ',');

/** Date-heure locale courante au format AAAA-MM-JJTHH:mm. */
export function nowLocal(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function emptyDraft(type: TransactionType = 'buy', now = new Date()): Draft {
  return {
    type,
    date: nowLocal(now),
    inAsset: '',
    inQty: '',
    outAsset: '',
    outQty: '',
    eur: '',
    feeAsset: EUR,
    feeQty: '',
    feeEur: '',
    portfolioValue: '',
    fiscalCost: '',
    movedAsset: '',
    movedQty: '',
    platform: '',
    note: '',
  };
}

export function draftFrom(tx: Transaction): Draft {
  const date = tx.date.length === 10 ? `${tx.date}T00:00` : tx.date.slice(0, 16);
  return {
    id: tx.id,
    type: tx.type,
    date,
    originalDate: tx.date,
    inAsset: tx.in?.asset ?? '',
    inQty: fr(tx.in?.quantity),
    outAsset: tx.out?.asset ?? '',
    outQty: fr(tx.out?.quantity),
    eur: fr(tx.eur),
    feeAsset: tx.fee?.asset ?? EUR,
    feeQty: fr(tx.fee?.quantity),
    feeEur: fr(tx.fee?.eur),
    portfolioValue: fr(tx.portfolioValueEur),
    fiscalCost: fr(tx.fiscalCostEur),
    movedAsset: tx.moved?.asset ?? '',
    movedQty: fr(tx.moved?.quantity),
    platform: tx.platform ?? '',
    note: tx.note ?? '',
    source: tx.source,
    holdings: tx.holdings,
  };
}

/** Champs pertinents par type (les autres sont ignorés à l'enregistrement). */
export const FIELDS: Record<TransactionType, (keyof Draft)[]> = {
  buy: ['inAsset', 'inQty', 'eur'],
  sell: ['outAsset', 'outQty', 'eur', 'portfolioValue'],
  swap: ['outAsset', 'outQty', 'inAsset', 'inQty', 'eur'],
  payment: ['outAsset', 'outQty', 'eur', 'portfolioValue'],
  reward: ['inAsset', 'inQty', 'eur', 'fiscalCost'],
  gift: ['outAsset', 'outQty', 'eur'],
  transfer: ['movedAsset', 'movedQty'],
  margin: [],
};

const FIELD_MAP: Record<string, keyof Draft> = {
  'in': 'inAsset',
  'in.asset': 'inAsset',
  'in.quantity': 'inQty',
  'out': 'outAsset',
  'out.asset': 'outAsset',
  'out.quantity': 'outQty',
  eur: 'eur',
  date: 'date',
  'fee.asset': 'feeAsset',
  'fee.quantity': 'feeQty',
  'fee.eur': 'feeEur',
  portfolioValueEur: 'portfolioValue',
  fiscalCostEur: 'fiscalCost',
  'moved.asset': 'movedAsset',
  'moved.quantity': 'movedQty',
};

/**
 * Construit la transaction à enregistrer. Renvoie les erreurs par champ du
 * formulaire si la saisie est incomplète ou incohérente.
 */
export function buildTransaction(draft: Draft): { tx?: Transaction; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const fields = new Set<keyof Draft>([...FIELDS[draft.type], 'feeQty', 'feeEur']);

  const num = (key: keyof Draft): string | undefined => {
    if (!fields.has(key)) return undefined;
    const parsed = parseInput(draft[key] as string);
    if (parsed === null) {
      errors[key] = 'Nombre invalide.';
      return undefined;
    }
    return parsed;
  };

  const inQty = num('inQty');
  const outQty = num('outQty');
  const eur = num('eur');
  const portfolioValue = num('portfolioValue');
  const fiscalCost = num('fiscalCost');
  const movedQty = num('movedQty');
  const feeQty = num('feeQty');
  const feeEur = num('feeEur');

  // Conserver les secondes d'origine si la minute n'a pas été modifiée.
  const date = draft.originalDate && draft.originalDate.slice(0, 16) === draft.date ? draft.originalDate : draft.date;

  const tx: Transaction = { id: draft.id ?? '', date, type: draft.type };
  const asset = (v: string) => normalizeAsset(v);
  const has = (key: keyof Draft) => FIELDS[draft.type].includes(key);

  if (has('inAsset') && (draft.inAsset || inQty)) tx.in = { asset: asset(draft.inAsset), quantity: inQty ?? '' };
  if (has('outAsset') && (draft.outAsset || outQty)) tx.out = { asset: asset(draft.outAsset), quantity: outQty ?? '' };
  if (has('eur') && eur !== undefined) tx.eur = eur;
  if (has('portfolioValue') && portfolioValue !== undefined) tx.portfolioValueEur = portfolioValue;
  if (has('fiscalCost') && fiscalCost !== undefined) tx.fiscalCostEur = fiscalCost;
  if (has('movedAsset') && (draft.movedAsset || movedQty)) tx.moved = { asset: asset(draft.movedAsset), quantity: movedQty ?? '' };
  if (feeQty !== undefined && feeQty !== '0') {
    const feeAsset = asset(draft.feeAsset || EUR);
    tx.fee = { asset: feeAsset, quantity: feeQty };
    if (feeAsset !== EUR && feeEur !== undefined) tx.fee.eur = feeEur;
  }
  if (draft.platform.trim()) tx.platform = draft.platform.trim();
  if (draft.note.trim()) tx.note = draft.note.trim();
  if (draft.source) tx.source = draft.source;
  if (draft.holdings && (draft.type === 'sell' || draft.type === 'payment')) tx.holdings = draft.holdings;

  for (const issue of validateTransaction({ ...tx, id: tx.id || 'brouillon' })) {
    const key = FIELD_MAP[issue.field];
    if (key && !errors[key]) errors[key] = issue.message;
  }

  if (Object.keys(errors).length > 0) return { errors };
  return { tx, errors };
}

type Side = 'in' | 'out' | 'moved';
/** Champ principal de chaque type (celui qui porte l'actif concerné). */
const PRIMARY: Record<TransactionType, Side | null> = {
  buy: 'in',
  reward: 'in',
  sell: 'out',
  payment: 'out',
  gift: 'out',
  swap: 'out',
  transfer: 'moved',
  margin: null,
};
const KEYS: Record<Side, [keyof Draft, keyof Draft]> = {
  in: ['inAsset', 'inQty'],
  out: ['outAsset', 'outQty'],
  moved: ['movedAsset', 'movedQty'],
};

/**
 * Change le type d'un brouillon en conservant l'actif et la quantité : ils
 * passent du champ principal de l'ancien type à celui du nouveau (ex. un
 * retrait corrigé en vente garde « 4,99 SOL »). Rien n'est écrasé.
 */
export function switchType(draft: Draft, to: TransactionType): Draft {
  const from = draft.type;
  const next: Draft = { ...draft, type: to };
  const source = PRIMARY[from];
  const target = PRIMARY[to];
  if (!source || !target || source === target) return next;
  const [sa, sq] = KEYS[source];
  const [ta, tq] = KEYS[target];
  if (!next[ta] && !next[tq]) {
    (next[ta] as string) = draft[sa] as string;
    (next[tq] as string) = draft[sq] as string;
  }
  return next;
}
