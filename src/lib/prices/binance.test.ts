import { describe, expect, it } from 'vitest';
import { BinancePrices, parisToUtcMs, PriceFetchError, valueHoldings, type Fetcher } from './binance';

/** Faux Binance : cours fixes par symbole, liste des paires sur ticker/price. */
function fakeBinance(prices: Record<string, string>, calls: string[] = [], fail = false): Fetcher {
  return async (url) => {
    calls.push(url);
    if (fail) throw new TypeError('Failed to fetch');
    const u = new URL(url);
    if (u.pathname.endsWith('/ticker/price')) {
      return { ok: true, status: 200, json: async () => Object.keys(prices).map((symbol) => ({ symbol, price: prices[symbol] })) };
    }
    const symbol = u.searchParams.get('symbol')!;
    const start = Number(u.searchParams.get('startTime'));
    // Comme le vrai Binance : paire inexistante → réponse sans CORS, vue comme une erreur réseau.
    if (!(symbol in prices)) throw new TypeError('CORS');
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

  it('n’interroge que des paires existantes, avec cache', async () => {
    const calls: string[] = [];
    const p = new BinancePrices(fakeBinance({ SOLUSDT: '150', EURUSDT: '1.2' }, calls));
    await p.priceEur('SOL', t);
    const first = calls.length;
    await p.priceEur('SOL', t + 10_000); // même minute
    expect(calls.length).toBe(first);
    expect(calls.some((c) => c.includes('SOLEUR'))).toBe(false); // paire inexistante jamais demandée
    expect(calls.filter((c) => c.includes('ticker/price'))).toHaveLength(1);
    expect(p.failures).toBe(0);
  });

  it('une bougie illisible ne bloque pas les autres', async () => {
    const flaky: Fetcher = async (url) => {
      if (url.includes('ticker/price')) return { ok: true, status: 200, json: async () => [{ symbol: 'BTCEUR' }, { symbol: 'ETHEUR' }] };
      if (url.includes('ETHEUR')) throw new TypeError('reset');
      const start = Number(new URL(url).searchParams.get('startTime'));
      return { ok: true, status: 200, json: async () => [[start, '0', '0', '0', '90000']] };
    };
    const p = new BinancePrices(flaky);
    const v = await valueHoldings({ BTC: '1', ETH: '1' }, '2026-05-30T20:31:00', p);
    expect(v.value.toString()).toBe('90000');
    expect(v.missing).toEqual(['ETH']);
    expect(p.failures).toBe(1);
  });

  it('erreur réseau explicite', async () => {
    const p = new BinancePrices(fakeBinance({}, [], true));
    await expect(p.priceEur('SOL', t)).rejects.toBeInstanceOf(PriceFetchError);
  });

  it('bougie trop éloignée de l’heure demandée : pas de prix', async () => {
    const far: Fetcher = async (url) => {
      if (url.includes('ticker/price')) return { ok: true, status: 200, json: async () => [{ symbol: 'NEWUSDT', price: '1' }] };
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

describe('prix du jour', () => {
  it('une seule requête, routes directes et indirectes, actifs introuvables listés', async () => {
    const calls: string[] = [];
    const p = new BinancePrices(fakeBinance({ BTCEUR: '90000', SOLUSDT: '150', EURUSDT: '1.2', ACEBTC: '0.00001' }, calls));
    const { quotes, missing } = await p.currentPricesEur(['BTC', 'SOL', 'ACE', 'USDT', 'ZZZ']);
    expect(quotes.get('BTC')!.price.toString()).toBe('90000');
    expect(quotes.get('SOL')!.price.toString()).toBe('125');
    expect(quotes.get('ACE')!.price.toString()).toBe('0.9');
    expect(quotes.get('USDT')!.route).toBe('1 ÷ EURUSDT');
    expect(missing).toEqual(['ZZZ']);
    expect(calls).toHaveLength(1);
  });

  it('Binance injoignable : erreur explicite', async () => {
    const p = new BinancePrices(fakeBinance({}, [], true));
    await expect(p.currentPricesEur(['BTC'])).rejects.toBeInstanceOf(PriceFetchError);
  });
});
