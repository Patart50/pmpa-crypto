import { describe, expect, it } from 'vitest';
import { BinancePrices, parisToUtcMs, PriceFetchError, valueHoldings, type Fetcher } from './binance';

/** Faux Binance : cours fixes par symbole, 400 pour un symbole inconnu. */
function fakeBinance(prices: Record<string, string>, calls: string[] = [], fail = false): Fetcher {
  return async (url) => {
    calls.push(url);
    if (fail) throw new TypeError('Failed to fetch');
    const u = new URL(url);
    const symbol = u.searchParams.get('symbol')!;
    const start = Number(u.searchParams.get('startTime'));
    if (!(symbol in prices)) return { ok: false, status: 400, json: async () => ({ code: -1121 }) };
    return { ok: true, status: 200, json: async () => [[start, '0', '0', '0', prices[symbol], '0', start + 59_999]] };
  };
}

describe('heure de Paris → UTC', () => {
  it('hiver et été', () => {
    expect(new Date(parisToUtcMs('2026-01-31T14:28:41')).toISOString()).toBe('2026-01-31T13:28:41.000Z');
    expect(new Date(parisToUtcMs('2026-07-01T18:02:07')).toISOString()).toBe('2026-07-01T16:02:07.000Z');
    expect(new Date(parisToUtcMs('2026-03-01')).toISOString()).toBe('2026-02-28T23:00:00.000Z');
  });
});

describe('BinancePrices', () => {
  const t = parisToUtcMs('2026-05-30T20:31:00');

  it('paire directe en euros', async () => {
    const p = new BinancePrices(fakeBinance({ BTCEUR: '95000.5' }));
    expect(await p.priceEur('BTC', t)).toEqual({ price: expect.anything(), route: 'BTCEUR' });
    expect((await p.priceEur('btc', t))!.price.toString()).toBe('95000.5');
  });

  it('via USDT et EURUSDT', async () => {
    const p = new BinancePrices(fakeBinance({ SOLUSDT: '150', EURUSDT: '1.2' }));
    const q = await p.priceEur('SOL', t);
    expect(q!.price.toString()).toBe('125');
    expect(q!.route).toBe('SOLUSDT ÷ EURUSDT');
  });

  it('USDT et USDC', async () => {
    const p = new BinancePrices(fakeBinance({ EURUSDT: '1.25', USDCUSDT: '1' }));
    expect((await p.priceEur('USDT', t))!.price.toString()).toBe('0.8');
    const p2 = new BinancePrices(fakeBinance({ EURUSDT: '1.25', USDCUSDT: '0.9998' }));
    expect((await p2.priceEur('USDC', t))!.price.toString()).toBe('0.79984');
  });

  it('via BTC en dernier recours, null si introuvable', async () => {
    const p = new BinancePrices(fakeBinance({ EURUSDT: '1.2', ABCBTC: '0.00001', BTCEUR: '90000' }));
    expect((await p.priceEur('ABC', t))!.price.toString()).toBe('0.9');
    expect(await p.priceEur('NOPE', t)).toBeNull();
  });

  it('met en cache et mémorise les symboles inexistants', async () => {
    const calls: string[] = [];
    const p = new BinancePrices(fakeBinance({ SOLUSDT: '150', EURUSDT: '1.2' }, calls));
    await p.priceEur('SOL', t);
    const first = calls.length;
    await p.priceEur('SOL', t + 10_000); // même minute
    expect(calls.length).toBe(first);
    expect(calls.filter((c) => c.includes('SOLEUR'))).toHaveLength(1);
  });

  it('erreur réseau explicite', async () => {
    const p = new BinancePrices(fakeBinance({}, [], true));
    await expect(p.priceEur('SOL', t)).rejects.toBeInstanceOf(PriceFetchError);
  });

  it('bougie trop éloignée de l’heure demandée : pas de prix', async () => {
    const far: Fetcher = async (url) => {
      const start = Number(new URL(url).searchParams.get('startTime'));
      return { ok: true, status: 200, json: async () => [[start + 2 * 3600_000, '0', '0', '0', '10']] };
    };
    expect(await new BinancePrices(far).kline('NEWUSDT', t)).toBeNull();
  });
});

describe('valueHoldings', () => {
  it('valorise et liste les prix manquants', async () => {
    const p = new BinancePrices(fakeBinance({ BTCEUR: '90000', EURUSDT: '1.2', SOLUSDT: '144', USDCUSDT: '1.2' }));
    const progress: number[] = [];
    const v = await valueHoldings({ BTC: '0.01', SOL: '2', USDC: '120', XYZ: '5' }, '2026-05-30T20:31:00', p, (d) => progress.push(d));
    expect(v.value.toString()).toBe('1260'); // 900 + 240 + 120
    expect(v.missing).toEqual(['XYZ']);
    expect(progress.at(-1)).toBe(4);
  });
});
