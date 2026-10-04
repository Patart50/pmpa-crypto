import { describe, expect, it } from 'vitest';
import type { Transaction } from '../core/transactions';
import { buildTransaction, draftFrom, emptyDraft, markEdited, nowLocal, swapSides, switchType } from './draft';

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

describe('changement de type', () => {
  const withdraw: Transaction = { id: 'w', date: '2026-01-05T10:00', type: 'transfer', moved: { asset: 'SOL', quantity: '4.99' } };

  it('un retrait corrigé en vente garde actif et quantité', () => {
    const d = switchType(draftFrom(withdraw), 'sell');
    expect([d.outAsset, d.outQty]).toEqual(['SOL', '4,99']);
    const built = buildTransaction({ ...d, eur: '500', portfolioValue: '1000' });
    expect(built.tx?.out).toEqual({ asset: 'SOL', quantity: '4.99' });
  });

  it('aller-retour sans perte, champs déjà remplis jamais écrasés', () => {
    const gift = draftFrom({ id: 'g', date: '2026-10-03T23:57', type: 'gift', out: { asset: 'SOL', quantity: '0.01711169' } });
    const swap = switchType(gift, 'swap');
    expect([swap.outAsset, swap.outQty]).toEqual(['SOL', '0,01711169']);
    const buy = switchType({ ...swap, inAsset: 'BNB' }, 'buy');
    expect(buy.inAsset).toBe('BNB');
    expect(switchType(buy, 'gift').outAsset).toBe('SOL');
  });
});

describe('sens des transferts et échanges', () => {
  const deposit: Transaction = { id: 'd', date: '2026-01-05T10:00', type: 'transfer', moved: { asset: 'BTC', quantity: '0.002' }, note: 'Dépôt sur Binance depuis un autre compte ou wallet', source: 'binance:x' };

  it('un dépôt changé en échange passe côté reçu', () => {
    const d = switchType(draftFrom(deposit), 'swap');
    expect([d.inAsset, d.inQty, d.outAsset]).toEqual(['BTC', '0,002', '']);
  });

  it('un achat changé en échange garde l’actif côté reçu', () => {
    const buy = draftFrom({ id: 'b', date: '2026-01-05T10:00', type: 'buy', in: { asset: 'ETH', quantity: '1' }, eur: '2000' });
    expect(switchType(buy, 'swap').inAsset).toBe('ETH');
  });

  it('bouton ⇄ : inverse cédé et reçu', () => {
    const d = swapSides({ ...emptyDraft('swap'), outAsset: 'BNB', outQty: '0,5', inAsset: 'SOL', inQty: '0,01' });
    expect([d.outAsset, d.outQty, d.inAsset, d.inQty]).toEqual(['SOL', '0,01', 'BNB', '0,5']);
  });

  it('sens enregistré ; importée marquée modifiée seulement si elle change', () => {
    const same = buildTransaction(draftFrom(deposit)).tx!;
    expect(same.direction).toBe('in');
    expect(markEdited(deposit, same).edited).toBeUndefined();
    const changed = buildTransaction({ ...draftFrom(deposit), movedQty: '0,003' }).tx!;
    expect(markEdited(deposit, changed).edited).toBe(true);
  });

  it('airdrop : même saisie qu’une récompense', () => {
    const built = buildTransaction({ ...emptyDraft('airdrop'), inAsset: 'HUMA', inQty: '30' });
    expect(built.tx).toMatchObject({ type: 'airdrop', in: { asset: 'HUMA', quantity: '30' } });
  });
});
