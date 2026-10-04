/**
 * Conversion en euros des montants d'un import exprimés dans une autre
 * devise (USD, USDT, USDC…), au cours Binance de la minute de l'opération
 * (D-047). Appelée seulement après consentement (D-026).
 */
import { dec, type Dec } from '../core/money';
import type { Transaction } from '../core/transactions';
import { parisToUtcMs, type BinancePrices } from '../prices/binance';
import type { FxAmount } from './common';

export interface FxOutcome {
  transactions: Transaction[];
  converted: number;
  /** Montants sans cours trouvé : les transactions restent à compléter. */
  missing: number;
}

export async function applyFx(
  transactions: readonly Transaction[],
  fx: readonly FxAmount[],
  prices: BinancePrices,
  onProgress?: (done: number, total: number) => void,
): Promise<FxOutcome> {
  const rates = new Map<string, Dec | null>();
  const keyOf = (f: FxAmount) => `${f.currency}@${Math.floor(parisToUtcMs(f.date) / 60_000)}`;
  const keys = [...new Set(fx.map(keyOf))];
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < keys.length) {
      const key = keys[next++];
      const [currency, minute] = key.split('@');
      const quote = await prices.priceEur(currency, Number(minute) * 60_000);
      rates.set(key, quote?.price ?? null);
      onProgress?.(++done, keys.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, keys.length) }, worker));

  const byId = new Map(transactions.map((t) => [t.id, { ...t }]));
  let converted = 0;
  let missing = 0;
  for (const f of fx) {
    const tx = byId.get(f.txId);
    const rate = rates.get(keyOf(f));
    if (!tx) continue;
    if (!rate) {
      missing++;
      continue;
    }
    const eur = dec(f.amount).times(rate).toDecimalPlaces(2).toString();
    if (f.field === 'eur') tx.eur = eur;
    else if (dec(eur).gt(0)) tx.fee = { asset: 'EUR', quantity: eur };
    converted++;
  }
  return { transactions: transactions.map((t) => byId.get(t.id)!), converted, missing };
}
