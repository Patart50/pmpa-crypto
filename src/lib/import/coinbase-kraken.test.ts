/** Journaux fictifs de référence Coinbase et Kraken (docs/exemples), voir RESULTATS-ATTENDUS.md. */
import { describe, expect, it } from 'vitest';
import cbText from '../../../docs/exemples/coinbase-synthetique-UTC.csv?raw';
import krText from '../../../docs/exemples/kraken-synthetique-UTC.csv?raw';
import { detectFile } from './index';
import { parseCoinbase } from './coinbase';
import { krakenAsset, parseKrakenLedger } from './kraken';
import { applyFx } from './fx';
import { BinancePrices, type Fetcher } from '../prices/binance';
import type { Transaction } from '../core/transactions';

const row = (t: Transaction) => [
  t.date,
  t.type,
  t.out ? `-${t.out.quantity} ${t.out.asset}` : '',
  t.in ? `+${t.in.quantity} ${t.in.asset}` : '',
  t.moved ? `${t.moved.quantity} ${t.moved.asset} ${t.direction}` : '',
  t.eur ?? '',
  t.fee ? `${t.fee.quantity} ${t.fee.asset}` : '',
];

describe('Coinbase', () => {
  const d = detectFile(cbText, 'coinbase-synthetique-UTC.csv');
  it('reconnu malgré les lignes d’identification avant l’en-tête', () => {
    expect(d.kind).toBe('coinbase');
  });
  const r = parseCoinbase((d as Extract<typeof d, { kind: 'coinbase' }>).table, 'cb.csv');

  it('transactions reconstituées (heure de Paris)', () => {
    expect(r.transactions.map(row)).toEqual([
      ['2025-03-01T11:05:00', 'buy', '', '+0.005 BTC', '', '400', '6 EUR'],
      ['2025-03-01T11:10:00', 'buy', '', '+108 USDC', '', '', ''],
      ['2025-03-02T10:00:00', 'swap', '-50 USDC', '+0.02 ETH', '', '', ''],
      ['2025-03-03T13:00:00', 'swap', '-50.3 USDC', '+0.5 SOL', '', '', ''],
      ['2025-03-03T14:00:00', 'swap', '-0.1 SOL', '+11 USDC', '', '', ''],
      ['2025-03-03T14:00:00', 'swap', '-0.1 SOL', '+11 USDC', '', '', ''],
      ['2025-03-04T09:00:00', 'reward', '', '+0.001 SOL', '', '', ''],
      ['2025-03-04T10:00:00', 'reward', '', '+2 ZETACHAIN', '', '', ''],
      ['2025-03-06T11:00:00', 'swap', '-0.02 ETH', '+0.018 CBETH', '', '', ''],
      ['2025-03-07T11:00:00', 'transfer', '', '', '4 USDC in', '', ''],
      ['2025-03-08T11:00:00', 'sell', '-0.002 BTC', '', '', '180', '1 EUR'],
      ['2025-03-09T11:00:00', 'transfer', '', '', '0.001 BTC out', '', ''],
    ]);
    // Deux ordres identiques dans la même seconde restent deux transactions.
    expect(new Set(r.transactions.map((t) => t.id)).size).toBe(r.transactions.length);
  });

  it('montants en USD à convertir, lignes ignorées', () => {
    expect(r.fx!.map((f) => [f.field, f.amount, f.currency])).toEqual([
      ['eur', '108', 'USD'],
      ['fee', '3.24', 'USD'],
    ]);
    expect(r.ignored.map((g) => [g.category, g.lines])).toEqual([
      ['internal', 2],
      ['euro', 1],
      ['unknown', 1],
    ]);
  });

  it('conversion USD → EUR au cours de la minute', async () => {
    const fetcher: Fetcher = async (url) => {
      if (url.includes('ticker/price')) return { ok: true, status: 200, json: async () => [{ symbol: 'EURUSDT', price: '1.08' }] };
      const start = Number(new URL(url).searchParams.get('startTime'));
      return { ok: true, status: 200, json: async () => [[start, '0', '0', '0', '1.08']] };
    };
    const out = await applyFx(r.transactions, r.fx!, new BinancePrices(fetcher));
    const usdc = out.transactions.find((t) => t.in?.asset === 'USDC' && t.type === 'buy')!;
    expect([usdc.eur, usdc.fee?.quantity, out.converted, out.missing]).toEqual(['100', '3', 2, 0]);
  });
});

describe('Kraken Ledgers', () => {
  it('codes d’actifs', () => {
    expect(['XXBT', 'XBT.M', 'ZEUR', 'ETH.F', 'DOT.S', 'ETH2.S', 'SOL'].map(krakenAsset)).toEqual(['BTC', 'BTC', 'EUR', 'ETH', 'DOT', 'ETH', 'SOL']);
  });

  const d = detectFile(krText, 'kraken-synthetique-UTC.csv');
  const r = parseKrakenLedger((d as Extract<typeof d, { kind: 'kraken' }>).table, 'kr.csv');

  it('transactions reconstituées par refid', () => {
    expect(d.kind).toBe('kraken');
    expect(r.transactions.map(row)).toEqual([
      ['2025-03-01T11:00:00', 'buy', '', '+0.005 BTC', '', '400', '1.04 EUR'],
      ['2025-03-02T12:00:00', 'swap', '-0.001 BTC', '+0.0399 ETH', '', '', ''],
      ['2025-03-04T09:00:00', 'reward', '', '+0.00002 ETH', '', '', ''],
      ['2025-03-05T09:00:00', 'reward', '', '+0.15 DOT', '', '', ''],
      ['2025-03-06T13:00:00', 'sell', '-0.002 BTC', '', '', '180', '0.47 EUR'],
      ['2025-03-07T10:00:00', 'buy', '', '+1 SOL', '', '', ''],
      ['2025-03-08T11:00:00', 'transfer', '', '', '0.001 BTC out', '', '0.00005 BTC'],
    ]);
    expect(r.fx!.map((f) => [f.field, f.amount, f.currency])).toEqual([
      ['eur', '110', 'USD'],
      ['fee', '1.65', 'USD'],
    ]);
    expect(r.ignored.map((g) => [g.category, g.lines])).toEqual([
      ['internal', 2],
      ['euro', 1],
      ['margin', 1],
    ]);
  });
});

describe('détection des fichiers', () => {
  it('historique de prix, export Kraken Trades, plateforme choisie qui ne correspond pas', () => {
    const ohlc = detectFile('time,open,high,low,close\n2026-09-30 17:15:00,1,2,0.5,1.5\n', 'BNB.csv');
    expect(ohlc.kind === 'error' && ohlc.message).toMatch(/historique de prix/);
    const trades = detectFile('"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol"\n', 'trades.csv');
    expect(trades.kind === 'error' && trades.message).toMatch(/Ledgers/);
    const wrong = detectFile(krText, 'k.csv', 'coinbase');
    expect(wrong.kind === 'error' && wrong.message).toMatch(/Coinbase/);
    expect(detectFile(krText, 'k.csv', 'other').kind).toBe('generic');
  });
});
