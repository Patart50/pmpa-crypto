import { describe, expect, it } from 'vitest';
import { feeInEur, normalizeAsset, sortTransactions, validateTransaction, type Transaction } from './transactions';

const base = { id: 't1', date: '2024-05-01' } as const;
const fields = (tx: Transaction) => validateTransaction(tx).map((i) => i.field);

describe('validateTransaction', () => {
  it('accepte un achat complet', () => {
    expect(
      validateTransaction({ ...base, type: 'buy', in: { asset: 'BTC', quantity: '0.01' }, eur: '500', fee: { asset: 'EUR', quantity: '1' } }),
    ).toEqual([]);
  });

  it('exige les champs propres à chaque type', () => {
    expect(fields({ ...base, type: 'buy' })).toEqual(['in', 'eur']);
    expect(fields({ ...base, type: 'sell' })).toEqual(['out', 'eur']);
    expect(fields({ ...base, type: 'swap' })).toEqual(['out', 'in']);
    expect(fields({ ...base, type: 'reward' })).toEqual(['in']);
    expect(fields({ ...base, type: 'transfer' })).toEqual([]);
  });

  it('refuse les champs incohérents', () => {
    expect(
      fields({ ...base, type: 'buy', in: { asset: 'BTC', quantity: '1' }, out: { asset: 'ETH', quantity: '1' }, eur: '1' }),
    ).toEqual(['out']);
    expect(
      fields({ ...base, type: 'swap', in: { asset: 'BTC', quantity: '1' }, out: { asset: 'BTC', quantity: '1' } }),
    ).toEqual(['in']);
    expect(fields({ ...base, type: 'buy', in: { asset: 'EUR', quantity: '1' }, eur: '1' })).toEqual(['in.asset']);
  });

  it('refuse quantités, dates et codes invalides', () => {
    expect(fields({ ...base, type: 'buy', in: { asset: 'BTC', quantity: '0' }, eur: '1' })).toEqual(['in.quantity']);
    expect(fields({ ...base, type: 'buy', in: { asset: 'BTC', quantity: 'abc' }, eur: '1' })).toEqual(['in.quantity']);
    expect(fields({ ...base, date: '2024-02-30', type: 'transfer' })).toEqual(['date']);
    expect(fields({ ...base, date: '01/05/2024', type: 'transfer' })).toEqual(['date']);
    expect(fields({ ...base, type: 'buy', in: { asset: 'b tc', quantity: '1' }, eur: '1' })).toEqual(['in.asset']);
    expect(fields({ ...base, type: 'transfer', fee: { asset: 'ETH', quantity: '-1' } })).toEqual(['fee.quantity']);
  });

  it('refuse une valeur de portefeuille nulle', () => {
    expect(
      fields({ ...base, type: 'sell', out: { asset: 'BTC', quantity: '1' }, eur: '1', portfolioValueEur: '0' }),
    ).toEqual(['portfolioValueEur']);
  });
});

describe('utilitaires', () => {
  it('normalizeAsset', () => expect(normalizeAsset(' btc ')).toBe('BTC'));

  it('feeInEur', () => {
    const tx = (fee?: Transaction['fee']): Transaction => ({ ...base, type: 'transfer', fee });
    expect(feeInEur(tx())).toBeUndefined();
    expect(feeInEur(tx({ asset: 'EUR', quantity: '1.5' }))?.toString()).toBe('1.5');
    expect(feeInEur(tx({ asset: 'BNB', quantity: '0.01', eur: '5' }))?.toString()).toBe('5');
    expect(feeInEur(tx({ asset: 'BNB', quantity: '0.01' }))).toBeUndefined();
  });

  it('sortTransactions est stable', () => {
    const txs = [
      { id: 'b', date: '2024-02-01' },
      { id: 'a1', date: '2024-01-01' },
      { id: 'a2', date: '2024-01-01' },
    ];
    expect(sortTransactions(txs).map((t) => t.id)).toEqual(['a1', 'a2', 'b']);
  });
});
