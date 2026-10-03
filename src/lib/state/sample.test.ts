import { describe, expect, it } from 'vitest';
import { computeFiscalFromTransactions } from '../core/ledger';
import { computePortfolio } from '../core/portfolio';
import { validateTransaction } from '../core/transactions';
import { SAMPLE_PRICES, sampleTransactions } from './sample';

describe('données d’exemple', () => {
  const txs = sampleTransactions();

  it('sont toutes valides et d’identifiants uniques', () => {
    expect(txs.flatMap(validateTransaction)).toEqual([]);
    expect(new Set(txs.map((t) => t.id)).size).toBe(txs.length);
  });

  it('produisent un portefeuille cohérent, sans solde négatif', () => {
    const { warnings, totals } = computePortfolio(txs, { prices: SAMPLE_PRICES });
    expect(warnings).toEqual([]);
    expect(totals.currentValue).toBeDefined();
  });

  it('illustrent une cession sans valeur de portefeuille', () => {
    const result = computeFiscalFromTransactions(txs);
    expect(result.issues.map((i) => [i.code, i.transactionId])).toEqual([['MISSING_PORTFOLIO_VALUE', 'ex-9']]);
    expect(result.years.map((y) => y.year)).toEqual([2025, 2026]);
  });
});
