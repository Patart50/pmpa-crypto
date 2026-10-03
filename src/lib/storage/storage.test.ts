import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../core/transactions';
import { LocalStore } from './db';
import { APP_ID, backupFileName, createBackup, parseBackup, SCHEMA_VERSION, serializeBackup } from './schema';

const buy: Transaction = { id: 'b1', date: '2024-01-01', type: 'buy', in: { asset: 'BTC', quantity: '0.1' }, eur: '3000' };
const sell: Transaction = {
  id: 's1',
  date: '2024-06-01',
  type: 'sell',
  out: { asset: 'BTC', quantity: '0.05' },
  eur: '2000',
  fee: { asset: 'EUR', quantity: '2' },
  portfolioValueEur: '4000',
};

describe('Sauvegarde JSON', () => {
  it('aller-retour sans perte', () => {
    const backup = createBackup([buy, sell], { theme: 'dark', rates: { '2026': '0.314' } }, new Date('2026-10-03T12:00:00Z'));
    const parsed = parseBackup(serializeBackup(backup));
    expect(parsed.ok).toBe(true);
    expect(parsed.backup).toEqual(backup);
    expect(parsed.issues).toEqual([]);
  });

  it('nom de fichier daté', () => {
    expect(backupFileName(new Date(2026, 9, 3))).toBe('pmpa-crypto-sauvegarde-2026-10-03.json');
  });

  it.each([
    ['JSON invalide', '{pas du json', "n'est pas un JSON valide"],
    ['autre application', JSON.stringify({ app: 'autre', schemaVersion: 1 }), "n'est pas une sauvegarde"],
    ['version future', JSON.stringify({ app: APP_ID, schemaVersion: SCHEMA_VERSION + 1, transactions: [] }), 'plus récente'],
    ['version illisible', JSON.stringify({ app: APP_ID, schemaVersion: '1', transactions: [] }), 'illisible'],
    ['liste absente', JSON.stringify({ app: APP_ID, schemaVersion: 1 }), 'liste manquante'],
  ])('rejette : %s', (_label, text, message) => {
    const r = parseBackup(text);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain(message);
  });

  it('rejette une structure corrompue en listant les erreurs', () => {
    const r = parseBackup(
      JSON.stringify({
        app: APP_ID,
        schemaVersion: 1,
        transactions: [buy, { ...buy }, { id: 'x', date: '2024-01-01', type: 'vol', in: { asset: 'BTC', quantity: 1 } }],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([
      'transactions[1] : identifiant en double « b1 ».',
      'transactions[2] : type inconnu « vol ».',
      'transactions[2].in : format invalide (attendu { asset, quantity } en texte).',
    ]);
  });

  it('importe les transactions incohérentes mais les signale', () => {
    const r = parseBackup(
      JSON.stringify({ app: APP_ID, schemaVersion: 1, transactions: [{ id: 'b', date: '2024-01-01', type: 'buy', in: { asset: 'BTC', quantity: '1' } }] }),
    );
    expect(r.ok).toBe(true);
    expect(r.issues.map((i) => i.field)).toEqual(['eur']);
  });
});

describe('Stockage IndexedDB', () => {
  const open = () => LocalStore.open(new IDBFactory(), 'test');

  it('crée, liste, modifie et supprime', async () => {
    const store = await open();
    expect(await store.listTransactions()).toEqual([]);
    await store.putTransaction(buy);
    await store.putTransaction(sell);
    expect((await store.listTransactions()).map((t) => t.id).sort()).toEqual(['b1', 's1']);
    await store.putTransaction({ ...buy, eur: '3100' });
    expect((await store.listTransactions()).find((t) => t.id === 'b1')?.eur).toBe('3100');
    await store.deleteTransaction('s1');
    expect((await store.listTransactions()).map((t) => t.id)).toEqual(['b1']);
    store.close();
  });

  it('réglages : vides par défaut, puis persistés', async () => {
    const store = await open();
    expect(await store.getSettings()).toEqual({});
    await store.saveSettings({ theme: 'light', prices: { BTC: '60000' } });
    expect(await store.getSettings()).toEqual({ theme: 'light', prices: { BTC: '60000' } });
    store.close();
  });

  it('replaceAll remplace tout le contenu', async () => {
    const store = await open();
    await store.putTransaction(buy);
    await store.replaceAll([sell], { theme: 'dark' });
    expect((await store.listTransactions()).map((t) => t.id)).toEqual(['s1']);
    expect(await store.getSettings()).toEqual({ theme: 'dark' });
    await store.clear();
    expect(await store.listTransactions()).toEqual([]);
    store.close();
  });

  it('les données survivent à la réouverture', async () => {
    const factory = new IDBFactory();
    const first = await LocalStore.open(factory, 'persist');
    await first.putTransaction(buy);
    first.close();
    const second = await LocalStore.open(factory, 'persist');
    expect((await second.listTransactions()).map((t) => t.id)).toEqual(['b1']);
    second.close();
  });
});
