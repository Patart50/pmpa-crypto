import { describe, expect, it } from 'vitest';
import { computePortfolio, estimatePortfolioValue, holdingsBefore, type PositionSummary } from './portfolio';
import type { Transaction } from './transactions';

const s = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? v : v.toString());
const pos = (positions: PositionSummary[], asset: string) => {
  const p = positions.find((x) => x.asset === asset);
  if (!p) throw new Error(`position ${asset} absente`);
  return p;
};

const btcHistory: Transaction[] = [
  { id: 'b1', date: '2024-01-10', type: 'buy', in: { asset: 'BTC', quantity: '1' }, eur: '30000', fee: { asset: 'EUR', quantity: '30' } },
  { id: 'b2', date: '2024-02-10', type: 'buy', in: { asset: 'BTC', quantity: '1' }, eur: '40000' },
  { id: 's1', date: '2024-03-10', type: 'sell', out: { asset: 'BTC', quantity: '0.5' }, eur: '25000', fee: { asset: 'EUR', quantity: '25' } },
];

describe('PMP et coût', () => {
  it('cumule achats et frais en euros', () => {
    const { positions } = computePortfolio(btcHistory.slice(0, 2));
    const btc = pos(positions, 'BTC');
    expect(s(btc.quantity)).toBe('2');
    expect(s(btc.openCost)).toBe('70030');
    expect(s(btc.averageOpenPrice)).toBe('35015');
    expect(s(btc.historicalAveragePrice)).toBe('35015');
  });

  it('une vente ne change pas le PMP ouvert et dégage un résultat de suivi', () => {
    const { positions, totals } = computePortfolio(btcHistory);
    const btc = pos(positions, 'BTC');
    expect(s(btc.quantity)).toBe('1.5');
    expect(s(btc.openCost)).toBe('52522.5');
    expect(s(btc.averageOpenPrice)).toBe('35015');
    // 25 000 − 25 de frais − 0,5 × 35 015
    expect(s(btc.realizedPnl)).toBe('7467.5');
    expect(s(btc.historicalAveragePrice)).toBe('35015');
    expect(s(totals.realizedPnl)).toBe('7467.5');
  });

  it('prix d’équilibre : intègre le résultat déjà réalisé', () => {
    const btc = pos(computePortfolio(btcHistory).positions, 'BTC');
    // (52 522,5 − 7 467,5) / 1,5
    expect(btc.breakEvenPrice!.toFixed(2)).toBe('30036.67');
  });

  it('prix d’équilibre nul si l’actif a déjà remboursé son coût', () => {
    const txs: Transaction[] = [
      { id: 'b', date: '2024-01-01', type: 'buy', in: { asset: 'ETH', quantity: '2' }, eur: '2000' },
      { id: 's', date: '2024-02-01', type: 'sell', out: { asset: 'ETH', quantity: '1' }, eur: '5000' },
    ];
    expect(s(pos(computePortfolio(txs).positions, 'ETH').breakEvenPrice)).toBe('0');
  });

  it('valeur et latent avec prix courants', () => {
    const { positions, totals } = computePortfolio(btcHistory, { prices: { BTC: '40000' } });
    expect(s(pos(positions, 'BTC').currentValue)).toBe('60000');
    expect(s(pos(positions, 'BTC').unrealizedPnl)).toBe('7477.5');
    expect(s(totals.currentValue)).toBe('60000');
    expect(s(totals.unrealizedPnl)).toBe('7477.5');
  });

  it('prix manquant : valeur et latent partiels, actif listé', () => {
    const txs: Transaction[] = [
      ...btcHistory,
      { id: 'e', date: '2024-04-01', type: 'buy', in: { asset: 'ETH', quantity: '1' }, eur: '3000' },
    ];
    const { totals, positions } = computePortfolio(txs, { prices: { BTC: '40000' } });
    const btc = pos(positions, 'BTC');
    expect(s(totals.currentValue!)).toBe(s(btc.currentValue!));
    expect(s(totals.unrealizedPnl!)).toBe(s(btc.unrealizedPnl!));
    expect(totals.unpriced).toEqual(['ETH']);
    expect(s(totals.openCost)).toBe('55522.5');
    expect(computePortfolio(txs).totals.currentValue).toBeUndefined();
  });

  it('sortie via la marge : quantité et coût retirés, sans résultat ni avertissement', () => {
    const { positions, warnings } = computePortfolio([
      { id: 'b', date: '2024-01-01', type: 'buy', in: { asset: 'SOL', quantity: '10' }, eur: '1000' },
      { id: 'm', date: '2024-02-01', type: 'margin', out: { asset: 'SOL', quantity: '4' } },
      { id: 'n', date: '2024-02-02', type: 'margin' },
    ]);
    const sol = pos(positions, 'SOL');
    expect([s(sol.quantity), s(sol.openCost), s(sol.realizedPnl)]).toEqual(['6', '600', '0']);
    expect(warnings.map((w) => w.code)).toEqual(['MARGIN_IGNORED']);
  });

  it('position soldée : quantité et coût nuls, PMP historique conservé', () => {
    const txs: Transaction[] = [
      { id: 'b', date: '2024-01-01', type: 'buy', in: { asset: 'SOL', quantity: '3' }, eur: '100' },
      { id: 's', date: '2024-02-01', type: 'sell', out: { asset: 'SOL', quantity: '3' }, eur: '150' },
    ];
    const sol = pos(computePortfolio(txs).positions, 'SOL');
    expect(s(sol.quantity)).toBe('0');
    expect(s(sol.openCost)).toBe('0');
    expect(sol.averageOpenPrice).toBeNull();
    expect(sol.breakEvenPrice).toBeNull();
    expect(sol.historicalAveragePrice!.toFixed(4)).toBe('33.3333');
    expect(s(sol.realizedPnl)).toBe('50');
  });

  it('pas de dérive d’arrondi sur trois achats au tiers', () => {
    const txs: Transaction[] = ['a', 'b', 'c'].map((id, i) => ({
      id,
      date: `2024-01-0${i + 1}`,
      type: 'buy' as const,
      in: { asset: 'BTC', quantity: '0.1' },
      eur: '100',
    }));
    txs.push({ id: 's', date: '2024-02-01', type: 'sell', out: { asset: 'BTC', quantity: '0.3' }, eur: '300' });
    const btc = pos(computePortfolio(txs).positions, 'BTC');
    expect(s(btc.quantity)).toBe('0');
    expect(s(btc.openCost)).toBe('0');
    expect(s(btc.realizedPnl)).toBe('0');
  });
});

describe('Échanges crypto → crypto', () => {
  const eth: Transaction = { id: 'e', date: '2024-01-01', type: 'buy', in: { asset: 'ETH', quantity: '2' }, eur: '4000' };

  it('sans valeur de marché : report du coût', () => {
    const txs: Transaction[] = [
      eth,
      { id: 'x', date: '2024-02-01', type: 'swap', out: { asset: 'ETH', quantity: '1' }, in: { asset: 'SOL', quantity: '100' } },
    ];
    const { positions } = computePortfolio(txs);
    expect(s(pos(positions, 'SOL').openCost)).toBe('2000');
    expect(s(pos(positions, 'SOL').averageOpenPrice)).toBe('20');
    expect(s(pos(positions, 'ETH').realizedPnl)).toBe('0');
  });

  it('avec valeur de marché : résultat de suivi et coût de marché', () => {
    const txs: Transaction[] = [
      eth,
      { id: 'x', date: '2024-02-01', type: 'swap', out: { asset: 'ETH', quantity: '1' }, in: { asset: 'SOL', quantity: '100' }, eur: '2500' },
    ];
    const { positions } = computePortfolio(txs);
    expect(s(pos(positions, 'SOL').openCost)).toBe('2500');
    expect(s(pos(positions, 'ETH').realizedPnl)).toBe('500');
    expect(s(pos(positions, 'ETH').openCost)).toBe('2000');
  });

  it('frais payés en BNB : coût du BNB reporté sur l’actif reçu', () => {
    const txs: Transaction[] = [
      eth,
      { id: 'bnb', date: '2024-01-02', type: 'buy', in: { asset: 'BNB', quantity: '1' }, eur: '500' },
      {
        id: 'x',
        date: '2024-02-01',
        type: 'swap',
        out: { asset: 'ETH', quantity: '1' },
        in: { asset: 'SOL', quantity: '100' },
        fee: { asset: 'BNB', quantity: '0.01' },
      },
    ];
    const { positions } = computePortfolio(txs);
    expect(s(pos(positions, 'BNB').quantity)).toBe('0.99');
    expect(s(pos(positions, 'BNB').openCost)).toBe('495');
    expect(s(pos(positions, 'SOL').openCost)).toBe('2005');
  });
});

describe('Frais en crypto et cas particuliers', () => {
  it('frais dans l’actif reçu : quantité diminuée, coût inchangé', () => {
    const { positions } = computePortfolio([
      { id: 'b', date: '2024-01-01', type: 'buy', in: { asset: 'ETH', quantity: '1.5' }, eur: '3000', fee: { asset: 'ETH', quantity: '0.0015' } },
    ]);
    expect(s(pos(positions, 'ETH').quantity)).toBe('1.4985');
    expect(s(pos(positions, 'ETH').openCost)).toBe('3000');
  });

  it('frais dans l’actif vendu : retirés et imputés au résultat', () => {
    const { positions } = computePortfolio([
      { id: 'b', date: '2024-01-01', type: 'buy', in: { asset: 'ETH', quantity: '2' }, eur: '2000' },
      { id: 's', date: '2024-02-01', type: 'sell', out: { asset: 'ETH', quantity: '1' }, eur: '1500', fee: { asset: 'ETH', quantity: '0.1' } },
    ]);
    const e = pos(positions, 'ETH');
    expect(s(e.quantity)).toBe('0.9');
    expect(s(e.openCost)).toBe('900');
    expect(s(e.realizedPnl)).toBe('400'); // 1500 − 1000 − 100
  });

  it('transfert avec frais réseau : quantité retirée, coût conservé', () => {
    const { positions } = computePortfolio([
      { id: 'b', date: '2024-01-01', type: 'buy', in: { asset: 'ETH', quantity: '1' }, eur: '2000' },
      { id: 't', date: '2024-02-01', type: 'transfer', moved: { asset: 'ETH', quantity: '1' }, fee: { asset: 'ETH', quantity: '0.01' } },
    ]);
    expect(s(pos(positions, 'ETH').quantity)).toBe('0.99');
    expect(s(pos(positions, 'ETH').openCost)).toBe('2000');
  });

  it('frais seuls (marge, BNB) : coût retiré au prorata, PMP inchangé, perte constatée', () => {
    const { positions } = computePortfolio([
      { id: 'b', date: '2024-01-01', type: 'buy', in: { asset: 'BNB', quantity: '1' }, eur: '600' },
      { id: 'f', date: '2024-02-01', type: 'transfer', fee: { asset: 'BNB', quantity: '0.9' } },
    ]);
    const bnb = pos(positions, 'BNB');
    expect(s(bnb.quantity)).toBe('0.1');
    expect(s(bnb.openCost)).toBe('60');
    expect(s(bnb.averageOpenPrice!)).toBe('600');
    expect(s(bnb.realizedPnl)).toBe('-540');
  });

  it('récompense : coût à la valeur fournie, sinon nul', () => {
    const { positions } = computePortfolio([
      { id: 'r1', date: '2024-01-01', type: 'reward', in: { asset: 'USDC', quantity: '1' }, eur: '0.92' },
      { id: 'r2', date: '2024-01-02', type: 'reward', in: { asset: 'USDC', quantity: '1' } },
    ]);
    const usdc = pos(positions, 'USDC');
    expect(s(usdc.quantity)).toBe('2');
    expect(s(usdc.openCost)).toBe('0.92');
    expect(s(usdc.totalAcquiredQuantity)).toBe('2');
  });

  it('solde insuffisant : vente plafonnée et avertissement', () => {
    const { positions, warnings } = computePortfolio([
      { id: 's', date: '2024-02-01', type: 'sell', out: { asset: 'BTC', quantity: '1' }, eur: '30000' },
    ]);
    expect(warnings.map((w) => w.code)).toEqual(['INSUFFICIENT_BALANCE']);
    expect(s(pos(positions, 'BTC').quantity)).toBe('0');
    expect(s(pos(positions, 'BTC').realizedPnl)).toBe('30000');
  });

  it('marge et transactions invalides : ignorées avec avertissement', () => {
    const { positions, warnings } = computePortfolio([
      { id: 'm', date: '2024-01-01', type: 'margin' },
      { id: 'bad', date: '2024-01-02', type: 'buy', in: { asset: 'BTC', quantity: '-1' }, eur: '1' },
    ]);
    expect(warnings.map((w) => [w.code, w.transactionId])).toEqual([
      ['MARGIN_IGNORED', 'm'],
      ['INVALID_TRANSACTION', 'bad'],
    ]);
    expect(positions).toEqual([]);
  });

  it('signale des frais de vente en crypto non valorisés', () => {
    const { warnings } = computePortfolio([
      { id: 'b', date: '2024-01-01', type: 'buy', in: { asset: 'BNB', quantity: '1' }, eur: '500' },
      { id: 'b2', date: '2024-01-01', type: 'buy', in: { asset: 'ETH', quantity: '1' }, eur: '2000' },
      { id: 's', date: '2024-02-01', type: 'sell', out: { asset: 'ETH', quantity: '1' }, eur: '2500', fee: { asset: 'BNB', quantity: '0.01' } },
    ]);
    expect(warnings.map((w) => w.code)).toEqual(['UNVALUED_FEE']);
  });
});

describe('Valeur du portefeuille avant une cession', () => {
  const txs: Transaction[] = [
    { id: 'b1', date: '2024-01-01', type: 'buy', in: { asset: 'BTC', quantity: '0.5' }, eur: '15000' },
    { id: 'b2', date: '2024-01-02', type: 'buy', in: { asset: 'ETH', quantity: '2' }, eur: '4000' },
    { id: 's', date: '2024-03-01', type: 'sell', out: { asset: 'ETH', quantity: '1' }, eur: '2600' },
    { id: 'b3', date: '2024-04-01', type: 'buy', in: { asset: 'SOL', quantity: '10' }, eur: '1000' },
  ];

  it('holdingsBefore exclut la transaction visée et les suivantes', () => {
    const h = holdingsBefore(txs, 's');
    expect([...h.entries()].map(([a, q]) => [a, q.toString()])).toEqual([
      ['BTC', '0.5'],
      ['ETH', '2'],
    ]);
  });

  it('estimatePortfolioValue signale les prix manquants', () => {
    const h = holdingsBefore(txs, 's');
    expect(s(estimatePortfolioValue(h, { BTC: '60000', ETH: '2600' }).value)).toBe('35200');
    expect(estimatePortfolioValue(h, { BTC: '60000' }).missingPrices).toEqual(['ETH']);
  });

  it('don : quantité et coût retirés, sans résultat', () => {
    const { positions } = computePortfolio([
      { id: 'b', date: '2024-01-01', type: 'buy', in: { asset: 'USDC', quantity: '200' }, eur: '180' },
      { id: 'g', date: '2024-02-01', type: 'gift', out: { asset: 'USDC', quantity: '50' } },
    ]);
    const u = pos(positions, 'USDC');
    expect(s(u.quantity)).toBe('150');
    expect(s(u.openCost)).toBe('135');
    expect(s(u.averageOpenPrice)).toBe('0.9');
    expect(s(u.realizedPnl)).toBe('0');
  });
});
