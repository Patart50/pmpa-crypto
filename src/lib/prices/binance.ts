/**
 * Prix historiques à la minute, via l'API publique de données de marché de
 * Binance (bougies d'une minute). Seule fonction de l'outil qui contacte un
 * service extérieur : appelée uniquement à la demande de l'utilisateur (D-026).
 *
 * Ce qui est envoyé : un symbole de marché (ex. « SOLUSDT ») et une heure.
 * Jamais de quantité, de montant ni d'identifiant.
 */
import { D, dec, ZERO, type Dec } from '../core/money';
import { PARIS } from '../import/common';

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
/** Au-delà, la première bougie trouvée est trop éloignée de l'heure demandée. */
const MAX_GAP_MS = 60 * 60_000;

export class PriceFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PriceFetchError';
  }
}

const offsetFormatter = new Intl.DateTimeFormat('en-US', { timeZone: PARIS, timeZoneName: 'longOffset' });

function parisOffsetMinutes(utcMs: number): number {
  const name = offsetFormatter.formatToParts(new Date(utcMs)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** Date-heure locale de Paris (AAAA-MM-JJTHH:mm(:ss)) → instant UTC en millisecondes. */
export function parisToUtcMs(local: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(local);
  if (!m) throw new RangeError(`Date invalide : ${local}`);
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  let utc = wall - parisOffsetMinutes(wall) * 60_000;
  utc = wall - parisOffsetMinutes(utc) * 60_000;
  return utc;
}

export interface PriceQuote {
  price: Dec;
  /** Chemin utilisé, ex. « SOLUSDT ÷ EURUSDT ». */
  route: string;
}

export class BinancePrices {
  private readonly cache = new Map<string, Promise<Dec | null>>();
  private readonly invalid = new Set<string>();
  private host = 0;

  constructor(private readonly fetcher: Fetcher = (url) => fetch(url)) {}

  /** Cours de clôture de la bougie d'une minute contenant l'instant donné. */
  kline(symbol: string, utcMs: number): Promise<Dec | null> {
    if (this.invalid.has(symbol)) return Promise.resolve(null);
    const minute = Math.floor(utcMs / 60_000) * 60_000;
    const key = `${symbol}@${minute}`;
    let pending = this.cache.get(key);
    if (!pending) {
      pending = this.load(symbol, minute);
      this.cache.set(key, pending);
      pending.catch(() => this.cache.delete(key));
    }
    return pending;
  }

  private async load(symbol: string, minute: number): Promise<Dec | null> {
    let lastError: unknown;
    for (let attempt = 0; attempt < HOSTS.length; attempt++) {
      const base = HOSTS[(this.host + attempt) % HOSTS.length];
      try {
        const res = await this.fetcher(`${base}/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${minute}&limit=1`);
        if (res.status === 400) {
          this.invalid.add(symbol); // symbole inexistant
          return null;
        }
        if (!res.ok) throw new PriceFetchError(`Binance a répondu ${res.status}`);
        this.host = (this.host + attempt) % HOSTS.length;
        const data = (await res.json()) as unknown[][];
        const candle = data[0];
        if (!candle || Math.abs(Number(candle[0]) - minute) > MAX_GAP_MS) return null;
        return dec(String(candle[4]));
      } catch (error) {
        lastError = error;
      }
    }
    throw new PriceFetchError(
      lastError instanceof PriceFetchError ? lastError.message : 'Impossible de joindre Binance (connexion ou blocage du navigateur).',
    );
  }

  /** Prix d'un actif en euros à un instant, en essayant plusieurs paires. */
  async priceEur(asset: string, utcMs: number): Promise<PriceQuote | null> {
    const a = asset.toUpperCase();
    if (a === 'EUR') return { price: new D(1), route: 'EUR' };

    const direct = await this.kline(`${a}EUR`, utcMs);
    if (direct) return { price: direct, route: `${a}EUR` };

    const eurUsdt = await this.kline('EURUSDT', utcMs);
    if (!eurUsdt || eurUsdt.isZero()) return null;
    if (a === 'USDT') return { price: new D(1).dividedBy(eurUsdt), route: '1 ÷ EURUSDT' };

    const viaUsdt = await this.kline(`${a}USDT`, utcMs);
    if (viaUsdt) return { price: viaUsdt.dividedBy(eurUsdt), route: `${a}USDT ÷ EURUSDT` };

    const viaUsdc = await this.kline(`${a}USDC`, utcMs);
    if (viaUsdc) {
      const usdcUsdt = await this.kline('USDCUSDT', utcMs);
      if (usdcUsdt) return { price: viaUsdc.times(usdcUsdt).dividedBy(eurUsdt), route: `${a}USDC × USDCUSDT ÷ EURUSDT` };
    }

    const viaBtc = await this.kline(`${a}BTC`, utcMs);
    if (viaBtc) {
      const btcEur = await this.kline('BTCEUR', utcMs);
      if (btcEur) return { price: viaBtc.times(btcEur), route: `${a}BTC × BTCEUR` };
    }
    return null;
  }
}

export interface ValuationLine {
  asset: string;
  quantity: Dec;
  price: Dec | null;
  value: Dec | null;
  route?: string;
}

export interface Valuation {
  value: Dec;
  lines: ValuationLine[];
  missing: string[];
}

/** Valorise des positions à un instant (heure de Paris), 4 requêtes en parallèle au plus. */
export async function valueHoldings(
  holdings: Record<string, string> | Map<string, Dec>,
  localDate: string,
  prices: BinancePrices,
  onProgress?: (done: number, total: number) => void,
): Promise<Valuation> {
  const utcMs = parisToUtcMs(localDate);
  const entries = (holdings instanceof Map ? [...holdings] : Object.entries(holdings).map(([a, q]) => [a, dec(q)] as const)).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const lines: ValuationLine[] = new Array(entries.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < entries.length) {
      const i = next++;
      const [asset, quantity] = entries[i];
      const quote = await prices.priceEur(asset, utcMs);
      lines[i] = quote
        ? { asset, quantity, price: quote.price, value: quantity.times(quote.price), route: quote.route }
        : { asset, quantity, price: null, value: null };
      onProgress?.(++done, entries.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker));
  const value = lines.reduce((sum, l) => (l.value ? sum.plus(l.value) : sum), ZERO);
  return { value, lines, missing: lines.filter((l) => !l.price).map((l) => l.asset) };
}
