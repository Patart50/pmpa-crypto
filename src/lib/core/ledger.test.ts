import { describe, expect, it } from 'vitest';
import { computeFiscalFromTransactions, toFiscalEvents } from './ledger';
import type { Transaction } from './transactions';

const s = (v: { toString(): string }) => v.toString();

describe('toFiscalEvents', () => {
  it('achat : acquisition = euros payés + frais en euros (D-009)', () => {
    const { events } = toFiscalEvents([
      { id: 'b', date: '2024-01-01', type: 'buy', in: { asset: 'BTC', quantity: '1' }, eur: '30000', fee: { asset: 'EUR', quantity: '30' } },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('acquisition');
    expect(s((events[0] as { amountEur: { toString(): string } }).amountEur)).toBe('30030');
  });

  it('frais d’achat en crypto : non ajoutés (D-015)', () => {
    const { events } = toFiscalEvents([
      { id: 'b', date: '2024-01-01', type: 'buy', in: { asset: 'BTC', quantity: '1' }, eur: '30000', fee: { asset: 'BNB', quantity: '0.1', eur: '50' } },
    ]);
    expect(s((events[0] as { amountEur: { toString(): string } }).amountEur)).toBe('30000');
  });

  it('échanges, transferts : aucun événement', () => {
    const { events, issues } = toFiscalEvents([
      { id: 'x', date: '2024-01-01', type: 'swap', out: { asset: 'BTC', quantity: '1' }, in: { asset: 'ETH', quantity: '10' }, eur: '30000' },
      { id: 't', date: '2024-01-02', type: 'transfer' },
    ]);
    expect(events).toEqual([]);
    expect(issues).toEqual([]);
  });

  it('récompense : 0 € par défaut (D-008), prix fiscal saisi sinon', () => {
    const { events } = toFiscalEvents([
      { id: 'r1', date: '2024-01-01', type: 'reward', in: { asset: 'USDC', quantity: '1' }, eur: '0.9' },
      { id: 'r2', date: '2024-01-02', type: 'reward', in: { asset: 'USDC', quantity: '1' }, fiscalCostEur: '0.9' },
    ]);
    expect(events.map((e) => e.ref)).toEqual(['r2']);
  });

  it('cession sans valeur de portefeuille : exclue et signalée', () => {
    const r = toFiscalEvents([
      { id: 's', date: '2025-06-01', type: 'sell', out: { asset: 'BTC', quantity: '1' }, eur: '50000' },
    ]);
    expect(r.events).toEqual([]);
    expect(r.issues.map((i) => i.code)).toEqual(['MISSING_PORTFOLIO_VALUE']);
    expect(r.incompleteYears).toEqual([2025]);
  });

  it('cession : frais en euros ou contre-valeur des frais crypto', () => {
    const { events } = toFiscalEvents([
      { id: 's1', date: '2024-06-01', type: 'sell', out: { asset: 'BTC', quantity: '1' }, eur: '50000', fee: { asset: 'EUR', quantity: '50' }, portfolioValueEur: '60000' },
      { id: 's2', date: '2024-06-02', type: 'sell', out: { asset: 'BTC', quantity: '0.1' }, eur: '5000', fee: { asset: 'BNB', quantity: '0.01', eur: '5' }, portfolioValueEur: '10000' },
    ]);
    expect(events.map((e) => (e.kind === 'cession' ? s(e.feesEur ?? 0) : null))).toEqual(['50', '5']);
  });

  it('marge et transactions invalides : signalées', () => {
    const { issues } = toFiscalEvents([
      { id: 'm', date: '2024-01-01', type: 'margin' },
      { id: 'bad', date: 'hier', type: 'transfer' },
    ]);
    expect(issues.map((i) => i.code).sort()).toEqual(['INVALID_TRANSACTION', 'MARGIN_NOT_QUALIFIED']);
  });
});

describe('computeFiscalFromTransactions', () => {
  it('exemple BOFiP § 110 rejoué avec des échanges intermédiaires ignorés', () => {
    const txs: Transaction[] = [
      { id: 'b', date: '2024-01-15', type: 'buy', in: { asset: 'BTC', quantity: '0.03' }, eur: '1000' },
      { id: 'x', date: '2024-02-01', type: 'swap', out: { asset: 'BTC', quantity: '0.01' }, in: { asset: 'ETH', quantity: '0.15' } },
      { id: 's1', date: '2024-03-15', type: 'sell', out: { asset: 'ETH', quantity: '0.15' }, eur: '450', portfolioValueEur: '1200' },
      { id: 's2', date: '2024-08-15', type: 'payment', out: { asset: 'BTC', quantity: '0.02' }, eur: '1300', portfolioValueEur: '1300' },
    ];
    const result = computeFiscalFromTransactions(txs);
    expect(result.years[0].cessions.map((c) => s(c.gain))).toEqual(['75', '675']);
    expect(result.issues).toEqual([]);
  });

  it('applique le taux de l’année (31,4 % en 2026)', () => {
    const result = computeFiscalFromTransactions([
      { id: 'b', date: '2025-01-01', type: 'buy', in: { asset: 'BTC', quantity: '1' }, eur: '1000' },
      { id: 's', date: '2026-03-01', type: 'sell', out: { asset: 'BTC', quantity: '1' }, eur: '2000', portfolioValueEur: '2000' },
    ]);
    expect(s(result.years[0].estimatedTax)).toBe('314');
  });

  it('un don n’est pas une cession', () => {
    const r = computeFiscalFromTransactions([
      { id: 'b', date: '2025-01-01', type: 'buy', in: { asset: 'USDC', quantity: '200' }, eur: '180' },
      { id: 'g', date: '2025-02-01', type: 'gift', out: { asset: 'USDC', quantity: '50' }, eur: '45' },
    ]);
    expect(r.years).toEqual([]);
    expect(r.issues).toEqual([]);
  });
});
