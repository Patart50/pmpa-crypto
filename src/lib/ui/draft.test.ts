import { describe, expect, it } from 'vitest';
import type { Transaction } from '../core/transactions';
import { buildTransaction, draftFrom, emptyDraft, nowLocal } from './draft';

describe('brouillon de transaction', () => {
  it('nowLocal', () => {
    expect(nowLocal(new Date(2026, 9, 3, 9, 5))).toBe('2026-10-03T09:05');
  });

  it('construit un achat depuis une saisie française', () => {
    const draft = { ...emptyDraft('buy'), date: '2026-03-01T10:00', inAsset: 'btc', inQty: '0,015', eur: '1 200,50', feeQty: '2,4' };
    const { tx, errors } = buildTransaction(draft);
    expect(errors).toEqual({});
    expect(tx).toEqual({
      id: '',
      date: '2026-03-01T10:00',
      type: 'buy',
      in: { asset: 'BTC', quantity: '0.015' },
      eur: '1200.5',
      fee: { asset: 'EUR', quantity: '2.4' },
    });
  });

  it('ignore les champs qui ne concernent pas le type', () => {
    const draft = { ...emptyDraft('buy'), date: '2026-03-01T10:00', inAsset: 'BTC', inQty: '1', eur: '1', outAsset: 'ETH', outQty: '2', portfolioValue: '9' };
    const { tx } = buildTransaction(draft);
    expect(tx?.out).toBeUndefined();
    expect(tx?.portfolioValueEur).toBeUndefined();
  });

  it('rattache les erreurs aux champs du formulaire', () => {
    const { tx, errors } = buildTransaction({ ...emptyDraft('sell'), date: '2026-03-01T10:00', outAsset: 'ETH', outQty: 'abc' });
    expect(tx).toBeUndefined();
    expect(errors.outQty).toBe('Nombre invalide.');
    expect(errors.eur).toBe('Le montant reçu en euros est obligatoire.');
  });

  it('frais en crypto avec contre-valeur', () => {
    const { tx } = buildTransaction({
      ...emptyDraft('swap'),
      date: '2026-03-01T10:00',
      outAsset: 'ETH',
      outQty: '1',
      inAsset: 'SOL',
      inQty: '20',
      feeAsset: 'bnb',
      feeQty: '0,01',
      feeEur: '6',
    });
    expect(tx?.fee).toEqual({ asset: 'BNB', quantity: '0.01', eur: '6' });
  });

  it('aller-retour transaction → brouillon → transaction', () => {
    const original: Transaction = {
      id: 'abc',
      date: '2026-05-22T14:45:12',
      type: 'sell',
      out: { asset: 'BTC', quantity: '0.01' },
      eur: '1020',
      fee: { asset: 'EUR', quantity: '2.5' },
      portfolioValueEur: '7900',
      platform: 'Kraken',
      source: 'import:kraken.csv#12',
    };
    const { tx } = buildTransaction(draftFrom(original));
    expect(tx).toEqual(original);
  });

  it('frais nuls : pas de frais enregistrés', () => {
    const { tx } = buildTransaction({ ...emptyDraft('buy'), date: '2026-03-01T10:00', inAsset: 'BTC', inQty: '1', eur: '1', feeQty: '0' });
    expect(tx?.fee).toBeUndefined();
  });
});
