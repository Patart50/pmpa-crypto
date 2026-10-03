/**
 * Journal Binance synthétique de référence (docs/exemples/binance-synthetique-UTC0.csv).
 * Les valeurs attendues sont celles publiées dans docs/exemples/RESULTATS-ATTENDUS.md :
 * si ce test change, ce document doit changer aussi.
 */
import csvText from '../../../docs/exemples/binance-synthetique-UTC0.csv?raw';
import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { isBinanceAdjustment, parseBinanceLedger } from './binance';
import { computePortfolio } from '../core/portfolio';
import { computeFiscalFromTransactions } from '../core/ledger';

const FILE = 'binance-synthetique-UTC0.csv';
const report = parseBinanceLedger(parseCsv(csvText), { fileName: FILE, offsetMinutes: 0 });
const txs = report.transactions;
const summary = txs.map((t) => [t.date, t.type, t.out ? `-${t.out.quantity} ${t.out.asset}` : '', t.in ? `+${t.in.quantity} ${t.in.asset}` : '', t.eur ?? '']);

describe('journal Binance synthétique', () => {
  it('transactions reconstituées (heure de Paris)', () => {
    expect(summary).toEqual([
      ['2025-01-10T10:05:00', 'buy', '', '+0.025 BTC', '2000'],
      ['2025-01-10T10:10:00', 'buy', '', '+1100 USDC', '1000'],
      ['2025-01-10T10:15:00', 'buy', '', '+0.5 BNB', '300'],
      ['2025-01-12T23:59:59', 'reward', '', '+20 ACE', ''],
      ['2025-01-15T11:00:00', 'swap', '-500 USDC', '+2.5 SOL', ''],
      ['2025-01-16T23:59:59', 'reward', '', '+0.2 USDC', ''],
      ['2025-02-02T23:59:59', 'transfer', '', '', ''],
      ['2025-03-01T13:00:00', 'swap', '-20 ACE', '+0.004 BNB', ''],
      ['2025-06-15T16:00:00', 'sell', '-0.01 BTC', '', '900'],
      ['2025-08-01T11:00:00', 'payment', '-50 USDC', '', ''],
      ['2025-09-10T11:00:00', 'transfer', '', '', ''],
      ['2026-02-10T11:00:00', 'sell', '-400 USDC', '', '370'],
      ['2026-03-05T10:00:00', 'buy', '', '+0.1 ETH', ''],
      ['2025-02-01T23:59:59', 'gift', '-2.5 SOL', '', ''],
    ]);
    expect(txs.filter(isBinanceAdjustment).map((t) => t.out!.asset)).toEqual(['SOL']);
  });

  it('positions détenues avant chaque cession (tout le compte, marge comprise)', () => {
    const cessions = txs.filter((t) => t.type === 'sell' || t.type === 'payment');
    expect(cessions.map((t) => t.holdings)).toEqual([
      { BNB: '0.498', BTC: '0.024975', USDC: '1199.1' },
      { BNB: '0.498', BTC: '0.014975', USDC: '1199.1' },
      { BNB: '0.498', BTC: '0.009975', USDC: '1150.1' },
    ]);
  });

  it('résumé d’import', () => {
    expect(report.ignored.map((g) => [g.category, g.lines])).toEqual([
      ['margin', 5],
      ['internal', 4],
      ['euro', 2],
      ['unknown', 1],
    ]);
    expect(report.notes).toHaveLength(3);
  });

  it('suivi par actif', () => {
    const p = Object.fromEntries(computePortfolio(txs).positions.map((x) => [x.asset, x]));
    const row = (a: string) => [
      p[a].quantity.toString(),
      p[a].openCost.toFixed(2),
      p[a].averageOpenPrice?.toFixed(2) ?? '—',
      p[a].realizedPnl.toFixed(2),
      p[a].breakEvenPrice?.toFixed(2) ?? '—',
    ];
    expect(row('BTC')).toEqual(['0.014975', '1199.20', '80080.08', '98.30', '73515.86']);
    expect(row('BNB')).toEqual(['0.498', '296.40', '595.18', '-3.00', '601.20']);
    expect(row('USDC')).toEqual(['199.1', '181.12', '0.91', '5.75', '0.88']);
    expect(row('SOL')).toEqual(['0', '0.00', '—', '0.00', '—']);
    expect(row('ACE')).toEqual(['0', '0.00', '—', '0.00', '—']);
  });

  it('calcul fiscal avec des valeurs de portefeuille fixées (3 000 € et 1 500 €)', () => {
    const values: Record<string, string> = { '2025-06-15T16:00:00': '3000', '2026-02-10T11:00:00': '1500' };
    const withValues = txs.map((t) => (values[t.date] ? { ...t, portfolioValueEur: values[t.date] } : t));
    const fiscal = computeFiscalFromTransactions(withValues);
    const lines = fiscal.years.flatMap((y) => y.cessions.map((c) => [y.year, c.price.toFixed(2), c.fees.toFixed(2), c.netAcquisition.toFixed(2), c.capitalFraction.toFixed(2), c.gain.toFixed(2)]));
    expect(lines).toEqual([
      [2025, '900.00', '0.90', '3300.00', '990.00', '-90.90'],
      [2026, '370.00', '0.37', '2310.00', '569.80', '-200.17'],
    ]);
    // Paiement Binance Pay sans valeur, achat par carte sans montant : signalés, hors calcul.
    expect(fiscal.issues.length).toBeGreaterThanOrEqual(1);
  });
});
