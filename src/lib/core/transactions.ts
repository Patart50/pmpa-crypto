/**
 * Modèle de transaction saisi ou importé par l'utilisateur.
 *
 * Toutes les quantités et tous les montants sont des chaînes décimales
 * (point comme séparateur) : le modèle est sérialisable en JSON sans perte.
 * Les calculs convertissent avec `dec()`.
 */
import { dec, type Dec } from './money';

/** Code d'actif en majuscules (BTC, ETH, USDC…). « EUR » est réservé à l'euro. */
export type AssetCode = string;

export const EUR = 'EUR';

export interface Amount {
  asset: AssetCode;
  /** Quantité strictement positive, en chaîne décimale. */
  quantity: string;
}

export interface Fee {
  /** Actif dans lequel les frais sont payés (EUR, BNB, l'actif acheté…). */
  asset: AssetCode;
  quantity: string;
  /** Contre-valeur en euros, si les frais sont payés en crypto et que l'on la connaît. */
  eur?: string;
}

/**
 * Types de transaction.
 *
 * | Type       | Sortie (out) | Entrée (in) | `eur`                         | Fiscalité          |
 * |------------|--------------|-------------|-------------------------------|--------------------|
 * | buy        | —            | crypto      | euros payés (hors frais)      | acquisition        |
 * | sell       | crypto       | —           | euros reçus (avant frais)     | cession imposable  |
 * | swap       | crypto       | crypto      | valeur de marché (facultatif) | aucune             |
 * | payment    | crypto       | —           | valeur du bien ou service     | cession imposable  |
 * | reward     | —            | crypto      | valeur à la réception (fac.)  | acquisition à 0 €* |
 * | gift       | crypto       | —           | valeur (facultatif, mémoire)  | aucune (D-024)     |
 * | transfer   | —            | —           | —                             | aucune             |
 * | margin     | —            | —           | —                             | non qualifiée      |
 *
 * * Prix d'acquisition fiscal nul par défaut (D-008), surchargeable via `fiscalCostEur`.
 */
export type TransactionType = 'buy' | 'sell' | 'swap' | 'payment' | 'reward' | 'gift' | 'transfer' | 'margin';

export const TRANSACTION_TYPES: readonly TransactionType[] = [
  'buy',
  'sell',
  'swap',
  'payment',
  'reward',
  'gift',
  'transfer',
  'margin',
];

export const TRANSACTION_LABELS: Readonly<Record<TransactionType, string>> = {
  buy: 'Achat en euros',
  sell: 'Vente en euros',
  swap: 'Échange crypto → crypto',
  payment: 'Paiement en crypto',
  reward: 'Récompense (Earn, staking)',
  gift: 'Don ou sortie sans contrepartie',
  transfer: 'Transfert entre ses comptes',
  margin: 'Opération sur marge (non traitée)',
};

export interface Transaction {
  /** Identifiant stable (UUID ou identifiant d'import). */
  id: string;
  /** Date-heure locale ISO : « AAAA-MM-JJ » ou « AAAA-MM-JJTHH:mm(:ss) ». */
  date: string;
  type: TransactionType;
  /** Actif cédé. */
  out?: Amount;
  /** Actif reçu. */
  in?: Amount;
  /** Contrepartie en euros (sens selon le type, voir tableau). */
  eur?: string;
  fee?: Fee;
  /**
   * Valeur globale de tout le portefeuille crypto juste avant une cession
   * imposable (sell, payment). Requise pour le calcul fiscal.
   */
  portfolioValueEur?: string;
  /**
   * Quantités de chaque crypto détenues juste avant une cession, reconstituées
   * à l'import (ex. journal Binance complet, marge incluse, dette déduite).
   * Sert à calculer automatiquement la valeur globale du portefeuille.
   */
  holdings?: Record<AssetCode, string>;
  /** Prix d'acquisition fiscal d'une récompense (0 € par défaut). */
  fiscalCostEur?: string;
  /** Pour un transfert : actif et quantité déplacés (informatif) ; les frais réseau vont dans `fee`. */
  moved?: Amount;
  platform?: string;
  note?: string;
  /** Origine d'un import (fichier, ligne) pour la traçabilité. */
  source?: string;
}

export interface ValidationIssue {
  id: string;
  field: string;
  message: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;
const ASSET = /^[A-Z0-9][A-Z0-9._-]{0,19}$/;

function isPositiveDecimal(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    const d = dec(value);
    return d.isFinite() && d.gt(0);
  } catch {
    return false;
  }
}

function isNonNegativeDecimal(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    const d = dec(value);
    return d.isFinite() && d.gte(0);
  } catch {
    return false;
  }
}

/** Normalise un code d'actif saisi (« btc » → « BTC »). */
export function normalizeAsset(code: string): AssetCode {
  return code.trim().toUpperCase();
}

/**
 * Vérifie la cohérence d'une transaction. Renvoie la liste des problèmes
 * (vide si la transaction est valide). Les messages sont en français et
 * destinés à l'utilisateur.
 */
export function validateTransaction(tx: Transaction): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (field: string, message: string) => issues.push({ id: tx.id, field, message });

  if (!tx.id) add('id', 'Identifiant manquant.');
  if (!DATE.test(tx.date ?? '')) add('date', 'Date invalide (attendu AAAA-MM-JJ, heure facultative).');
  else {
    const [y, m, d] = tx.date.slice(0, 10).split('-').map(Number);
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) add('date', "Cette date n'existe pas.");
  }
  if (!TRANSACTION_TYPES.includes(tx.type)) {
    add('type', 'Type de transaction inconnu.');
    return issues;
  }

  const checkAmount = (field: 'in' | 'out' | 'moved', required: boolean, allowEur = false) => {
    const amount = tx[field];
    if (!amount) {
      if (required) add(field, field === 'in' ? 'Actif reçu manquant.' : 'Actif cédé manquant.');
      return;
    }
    if (!ASSET.test(amount.asset ?? '')) add(`${field}.asset`, `Code d'actif invalide : « ${amount.asset} ».`);
    else if (!allowEur && amount.asset === EUR)
      add(`${field}.asset`, "L'euro ne peut pas être un actif crypto : utilisez le champ montant en euros.");
    if (!isPositiveDecimal(amount.quantity)) add(`${field}.quantity`, 'La quantité doit être un nombre strictement positif.');
  };

  const forbid = (field: 'in' | 'out', reason: string) => {
    if (tx[field]) add(field, reason);
  };

  switch (tx.type) {
    case 'buy':
      checkAmount('in', true);
      forbid('out', 'Un achat en euros ne cède aucun actif crypto (utilisez un échange).');
      if (!isPositiveDecimal(tx.eur)) add('eur', 'Le montant payé en euros est obligatoire.');
      break;
    case 'sell':
    case 'payment':
      checkAmount('out', true);
      forbid('in', tx.type === 'sell' ? 'Une vente en euros ne reçoit aucun actif crypto.' : 'Un paiement ne reçoit aucun actif crypto.');
      if (!isPositiveDecimal(tx.eur))
        add('eur', tx.type === 'sell' ? 'Le montant reçu en euros est obligatoire.' : 'La valeur du bien ou service payé est obligatoire.');
      if (tx.portfolioValueEur !== undefined && !isPositiveDecimal(tx.portfolioValueEur))
        add('portfolioValueEur', 'La valeur du portefeuille doit être strictement positive.');
      break;
    case 'swap':
      checkAmount('out', true);
      checkAmount('in', true);
      if (tx.out && tx.in && tx.out.asset === tx.in.asset) add('in', 'Un échange doit porter sur deux actifs différents.');
      if (tx.eur !== undefined && !isPositiveDecimal(tx.eur)) add('eur', 'La valeur de marché doit être strictement positive.');
      break;
    case 'reward':
      checkAmount('in', true);
      forbid('out', 'Une récompense ne cède aucun actif.');
      if (tx.eur !== undefined && !isNonNegativeDecimal(tx.eur)) add('eur', 'La valeur à la réception doit être positive ou nulle.');
      if (tx.fiscalCostEur !== undefined && !isNonNegativeDecimal(tx.fiscalCostEur))
        add('fiscalCostEur', "Le prix d'acquisition fiscal doit être positif ou nul.");
      break;
    case 'gift':
      checkAmount('out', true);
      forbid('in', 'Un don ne reçoit aucun actif.');
      if (tx.eur !== undefined && !isNonNegativeDecimal(tx.eur)) add('eur', 'La valeur doit être positive ou nulle.');
      break;
    case 'transfer':
      forbid('in', 'Un transfert ne change pas la composition du portefeuille : renseignez « moved ».');
      forbid('out', 'Un transfert ne change pas la composition du portefeuille : renseignez « moved ».');
      checkAmount('moved', false);
      break;
    case 'margin':
      break;
  }

  if (tx.holdings !== undefined) {
    const entries = typeof tx.holdings === 'object' && tx.holdings !== null ? Object.entries(tx.holdings) : null;
    if (!entries || entries.some(([asset, q]) => !ASSET.test(asset) || !isPositiveDecimal(q))) {
      add('holdings', 'Positions avant cession illisibles.');
    }
  }

  if (tx.fee) {
    if (!ASSET.test(tx.fee.asset ?? '')) add('fee.asset', `Code d'actif des frais invalide : « ${tx.fee.asset} ».`);
    if (!isNonNegativeDecimal(tx.fee.quantity)) add('fee.quantity', 'Les frais doivent être un nombre positif ou nul.');
    if (tx.fee.eur !== undefined && !isNonNegativeDecimal(tx.fee.eur))
      add('fee.eur', 'La contre-valeur des frais doit être positive ou nulle.');
  }

  return issues;
}

/** Montant des frais en euros, s'il est connu (frais payés en EUR ou contre-valeur renseignée). */
export function feeInEur(tx: Transaction): Dec | undefined {
  if (!tx.fee) return undefined;
  if (tx.fee.asset === EUR) return dec(tx.fee.quantity);
  if (tx.fee.eur !== undefined) return dec(tx.fee.eur);
  return undefined;
}

/** Tri chronologique stable (l'ordre de saisie départage les égalités). */
export function sortTransactions<T extends Pick<Transaction, 'date'>>(txs: readonly T[]): T[] {
  return txs
    .map((tx, index) => ({ tx, index }))
    .sort((a, b) => (a.tx.date < b.tx.date ? -1 : a.tx.date > b.tx.date ? 1 : a.index - b.index))
    .map(({ tx }) => tx);
}
