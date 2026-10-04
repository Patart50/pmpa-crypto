import { describe, expect, it } from 'vitest';
import { listBatches, MANUAL_BATCH } from './batches';
import type { Transaction } from './transactions';

const tx = (id: string, extra: Partial<Transaction> = {}): Transaction => ({ id, date: '2026-01-01', type: 'reward', in: { asset: 'BTC', quantity: '1' }, ...extra });

describe('lots d’import', () => {
  it('lots enregistrés, saisies manuelles en dernier', () => {
    const batches = listBatches(
      [
        tx('a', { importId: 'b1', source: 'binance:x.csv' }),
        tx('b', { importId: 'b1', edited: true }),
        tx('c', { importId: 'c1' }),
        tx('m'),
      ],
      {
        b1: { platform: 'Binance', files: ['x.csv'], importedAt: '2026-10-03T10:00:00Z' },
        c1: { platform: 'Coinbase', files: ['cb.csv'], importedAt: '2026-10-04T10:00:00Z' },
      },
    );
    expect(batches.map((b) => [b.id, b.platform, b.count, b.edited])).toEqual([
      ['c1', 'Coinbase', 1, 0],
      ['b1', 'Binance', 2, 1],
      [MANUAL_BATCH, 'Saisies à la main', 1, 0],
    ]);
  });

  it('imports antérieurs aux lots reconstitués depuis la source, ajustements rattachés à Binance', () => {
    const batches = listBatches([
      tx('a', { source: 'binance:2 exports Binance', platform: 'Binance' }),
      tx('b', { source: 'binance:2 exports Binance', platform: 'Binance' }),
      tx('bnadj-1', { platform: 'Binance' }),
      tx('k', { source: 'csv:kraken.csv', platform: 'Kraken' }),
    ]);
    const binance = batches.find((b) => b.platform === 'Binance')!;
    expect([binance.count, binance.files, binance.legacy]).toEqual([3, ['2 exports Binance'], true]);
    expect(binance.ids).toContain('bnadj-1');
    expect(batches.find((b) => b.platform === 'Kraken')!.files).toEqual(['kraken.csv']);
  });
});
