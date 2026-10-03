/**
 * Traduction des transactions en événements fiscaux (art. 150 VH bis).
 *
 * - buy     → acquisition : euros payés + frais payés en euros (D-009)
 * - reward  → acquisition au prix fiscal saisi, 0 € par défaut (D-008)
 * - sell    → cession : prix = euros reçus, frais = frais en euros ou contre-valeur
 * - payment → cession : prix = valeur du bien ou service
 * - swap, transfer → rien (pas de fait générateur)
 * - gift    → rien : un don n'est pas une cession à titre onéreux (D-024)
 * - margin  → rien, signalé (D-006)
 *
 * Les frais payés en crypto lors d'une opération non imposable ne sont ni
 * traités comme une cession ni ajoutés au prix d'acquisition (D-015).
 */
import { computeFiscal, type FiscalEvent, type FiscalOptions, type FiscalResult } from './fiscal';
import { dec } from './money';
import { feeInEur, sortTransactions, validateTransaction, type Transaction } from './transactions';

export interface LedgerIssue {
  transactionId: string;
  code: 'MISSING_PORTFOLIO_VALUE' | 'INVALID_TRANSACTION' | 'MARGIN_NOT_QUALIFIED';
  message: string;
}

export interface LedgerResult {
  events: FiscalEvent[];
  issues: LedgerIssue[];
  /** Années comportant au moins une cession écartée faute de valeur de portefeuille. */
  incompleteYears: number[];
}

export function toFiscalEvents(transactions: readonly Transaction[]): LedgerResult {
  const events: FiscalEvent[] = [];
  const issues: LedgerIssue[] = [];
  const incomplete = new Set<number>();

  for (const tx of sortTransactions(transactions)) {
    if (validateTransaction(tx).length > 0) {
      issues.push({ transactionId: tx.id, code: 'INVALID_TRANSACTION', message: 'Transaction invalide, ignorée.' });
      continue;
    }

    switch (tx.type) {
      case 'buy': {
        const fee = tx.fee?.asset === 'EUR' ? dec(tx.fee.quantity) : dec(0);
        events.push({ kind: 'acquisition', date: tx.date, amountEur: dec(tx.eur!).plus(fee), ref: tx.id });
        break;
      }
      case 'reward': {
        const cost = dec(tx.fiscalCostEur ?? '0');
        if (cost.gt(0)) events.push({ kind: 'acquisition', date: tx.date, amountEur: cost, ref: tx.id });
        break;
      }
      case 'sell':
      case 'payment': {
        if (tx.portfolioValueEur === undefined || tx.portfolioValueEur === '') {
          issues.push({
            transactionId: tx.id,
            code: 'MISSING_PORTFOLIO_VALUE',
            message:
              'Valeur globale du portefeuille manquante : cette cession est exclue du calcul tant qu’elle n’est pas renseignée.',
          });
          incomplete.add(Number(tx.date.slice(0, 4)));
          break;
        }
        events.push({
          kind: 'cession',
          date: tx.date,
          priceEur: tx.eur!,
          feesEur: feeInEur(tx) ?? 0,
          portfolioValueEur: tx.portfolioValueEur,
          ref: tx.id,
        });
        break;
      }
      case 'margin':
        issues.push({
          transactionId: tx.id,
          code: 'MARGIN_NOT_QUALIFIED',
          message: 'Opération sur marge non qualifiée fiscalement : à traiter manuellement (D-006).',
        });
        break;
      case 'swap':
      case 'transfer':
      case 'gift':
        break;
    }
  }

  return { events, issues, incompleteYears: [...incomplete].sort((a, b) => a - b) };
}

/** Raccourci : transactions → résultat fiscal complet. */
export function computeFiscalFromTransactions(
  transactions: readonly Transaction[],
  options: FiscalOptions = {},
): FiscalResult & Omit<LedgerResult, 'events'> {
  const { events, issues, incompleteYears } = toFiscalEvents(transactions);
  return { ...computeFiscal(events, options), issues, incompleteYears };
}
