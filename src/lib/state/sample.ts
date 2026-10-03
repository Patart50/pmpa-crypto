/**
 * Jeu de données d'exemple, entièrement fictif, pour découvrir l'outil.
 */
import type { Transaction } from '../core/transactions';

export function sampleTransactions(): Transaction[] {
  return [
    { id: 'ex-1', date: '2025-01-12T10:30', type: 'buy', in: { asset: 'BTC', quantity: '0.02' }, eur: '1800', fee: { asset: 'EUR', quantity: '4.5' }, platform: 'Exemple' },
    { id: 'ex-2', date: '2025-02-03T18:05', type: 'buy', in: { asset: 'ETH', quantity: '0.8' }, eur: '2400', fee: { asset: 'EUR', quantity: '6' }, platform: 'Exemple' },
    { id: 'ex-3', date: '2025-04-20T09:12', type: 'swap', out: { asset: 'ETH', quantity: '0.3' }, in: { asset: 'SOL', quantity: '7.5' }, eur: '820', platform: 'Exemple' },
    { id: 'ex-4', date: '2025-06-01T12:00', type: 'buy', in: { asset: 'BTC', quantity: '0.01' }, eur: '950', fee: { asset: 'EUR', quantity: '2.4' }, platform: 'Exemple' },
    { id: 'ex-5', date: '2025-09-14T08:40', type: 'reward', in: { asset: 'SOL', quantity: '0.12' }, eur: '22', platform: 'Exemple' },
    {
      id: 'ex-6',
      date: '2025-11-28T16:20',
      type: 'sell',
      out: { asset: 'ETH', quantity: '0.25' },
      eur: '900',
      fee: { asset: 'EUR', quantity: '2.25' },
      portfolioValueEur: '6400',
      platform: 'Exemple',
    },
    { id: 'ex-7', date: '2026-02-10T11:00', type: 'buy', in: { asset: 'ETH', quantity: '0.5' }, eur: '1150', fee: { asset: 'EUR', quantity: '3' }, platform: 'Exemple' },
    {
      id: 'ex-8',
      date: '2026-05-22T14:45',
      type: 'sell',
      out: { asset: 'BTC', quantity: '0.01' },
      eur: '1020',
      fee: { asset: 'EUR', quantity: '2.5' },
      portfolioValueEur: '7900',
      platform: 'Exemple',
    },
    { id: 'ex-9', date: '2026-07-03T19:30', type: 'sell', out: { asset: 'SOL', quantity: '2' }, eur: '310', platform: 'Exemple' },
  ];
}

export const SAMPLE_PRICES: Record<string, string> = { BTC: '98000', ETH: '2650', SOL: '150' };
