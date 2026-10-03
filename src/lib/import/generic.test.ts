import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import {
  convertRow,
  guessDateFormat,
  guessDecimal,
  guessMapping,
  guessTypeValue,
  isPmpaFormat,
  parseDate,
  parseGeneric,
  parseNumber,
  pmpaOptions,
  transactionsToCsv,
  type GenericOptions,
} from './generic';
import { sampleTransactions } from '../state/sample';
import { validateTransaction, type Transaction } from '../core/transactions';

describe('détection', () => {
  it('propose une association à partir des en-têtes, en français ou en anglais', () => {
    const m = guessMapping(['Date', 'Opération', 'Actif reçu', 'Quantité reçue', 'Actif cédé', 'Quantité cédée', 'Montant EUR', 'Frais', 'Commentaire']);
    expect(m).toEqual({ date: 0, type: 1, inAsset: 2, inQty: 3, outAsset: 4, outQty: 5, eur: 6, feeQty: 7, note: 8 });
    expect(guessMapping(['Timestamp', 'Transaction Type', 'Received Currency', 'Received Amount', 'Sent Currency', 'Sent Amount'])).toMatchObject({
      date: 0,
      type: 1,
      inAsset: 2,
      inQty: 3,
      outAsset: 4,
      outQty: 5,
    });
  });

  it('valeurs de type', () => {
    expect(guessTypeValue('Achat')).toBe('buy');
    expect(guessTypeValue('Staking Income')).toBe('reward');
    expect(guessTypeValue('Convert')).toBe('swap');
    expect(guessTypeValue('Withdrawal')).toBe('transfer');
    expect(guessTypeValue('Don')).toBe('gift');
    expect(guessTypeValue('sell')).toBe('sell');
    expect(guessTypeValue('Truc bizarre')).toBeUndefined();
  });

  it('format de date et séparateur décimal', () => {
    expect(guessDateFormat(['2026-03-01 10:00:00'])).toBe('iso');
    expect(guessDateFormat(['01/03/2026 10:00', '25/03/2026 11:00'])).toBe('dmy');
    expect(guessDateFormat(['03/25/2026'])).toBe('mdy');
    expect(guessDateFormat(['1772359200'])).toBe('unix');
    expect(guessDecimal(['1,5', '1 234,56', '0,001'])).toBe(',');
    expect(guessDecimal(['1.5', '1,234.56'])).toBe('.');
  });
});

describe('conversion des valeurs', () => {
  it('dates', () => {
    expect(parseDate('2026-03-01 10:00:00', 'iso', null)).toBe('2026-03-01T10:00:00');
    expect(parseDate('2026-03-01T09:00:00Z', 'iso', null)).toBe('2026-03-01T10:00:00');
    expect(parseDate('2026-07-01T09:00:00+00:00', 'iso', null)).toBe('2026-07-01T11:00:00');
    expect(parseDate('01/03/2026 10:00', 'dmy', null)).toBe('2026-03-01T10:00:00');
    expect(parseDate('03/01/2026', 'mdy', null)).toBe('2026-03-01T00:00:00');
    expect(parseDate('2026-03-01 10:00:00', 'iso', 0)).toBe('2026-03-01T11:00:00');
    expect(parseDate('1772359200', 'unix', null)).toBe('2026-03-01T11:00:00');
    expect(parseDate('hier', 'iso', null)).toBeNull();
    expect(parseDate('2026-13-01', 'iso', null)).toBeNull();
  });

  it('nombres', () => {
    expect(parseNumber('1 234,56', ',')).toBe('1234.56');
    expect(parseNumber('1,234.56', '.')).toBe('1234.56');
    expect(parseNumber('-0.5', '.')).toBe('0.5');
    expect(parseNumber('12 €', '.')).toBe('12');
    expect(parseNumber('', '.')).toBeUndefined();
    expect(parseNumber('abc', '.')).toBeNull();
  });
});

const options = (over: Partial<GenericOptions> = {}): GenericOptions => ({
  fileName: 'mon-export.csv',
  mapping: { date: 0, type: 1, inAsset: 2, inQty: 3, outAsset: 4, outQty: 5, eur: 6, feeQty: 7 },
  typeValues: {},
  dateFormat: 'dmy',
  decimal: ',',
  offsetMinutes: null,
  ...over,
});

describe('conversion des lignes', () => {
  const csv = parseCsv(
    [
      'Date;Opération;Actif reçu;Quantité reçue;Actif cédé;Quantité cédée;Montant EUR;Frais',
      '01/03/2026 10:00;Achat;BTC;0,01;;;650;1,5',
      '02/03/2026 10:00;Vente;;;ETH;0,5;1 100;',
      '03/03/2026 10:00;Échange;SOL;10;ETH;0,4;;',
      '04/03/2026 10:00;Récompense;DOT;1,2;;;;',
      '05/03/2026 10:00;Dépôt fiat;;;;;100;',
      '06/03/2026 10:00;Inconnu;BTC;1;;;;',
      'pas une date;Achat;BTC;1;;;1;',
    ].join('\n'),
  );

  it('convertit chaque type', () => {
    const r = parseGeneric(csv, options({ typeValues: { 'Échange': 'swap', 'Récompense': 'reward', 'Dépôt fiat': 'ignore' } }));
    expect(r.transactions.map((t) => t.type)).toEqual(['buy', 'sell', 'swap', 'reward']);
    expect(r.transactions[0]).toMatchObject({ date: '2026-03-01T10:00:00', in: { asset: 'BTC', quantity: '0.01' }, eur: '650', fee: { asset: 'EUR', quantity: '1.5' } });
    expect(r.transactions[1]).toMatchObject({ out: { asset: 'ETH', quantity: '0.5' }, eur: '1100' });
    expect(r.transactions.filter((t) => validateTransaction(t).length > 0)).toEqual([]);
    expect(r.ignored.map((g) => [g.label, g.lines])).toEqual([
      ['Lignes illisibles', 2],
      ['Lignes ignorées à votre demande', 1],
    ]);
  });

  it('euro comme actif et type déduit sans colonne type', () => {
    const opts = options({ mapping: { date: 0, inAsset: 1, inQty: 2, outAsset: 3, outQty: 4 }, dateFormat: 'iso', decimal: '.' });
    expect(convertRow(['2026-03-01', 'BTC', '0.01', 'EUR', '650'], 0, opts).tx).toMatchObject({ type: 'buy', eur: '650', in: { asset: 'BTC' } });
    expect(convertRow(['2026-03-01', 'EUR', '700', 'BTC', '0.01'], 0, opts).tx).toMatchObject({ type: 'sell', eur: '700', out: { asset: 'BTC' } });
    expect(convertRow(['2026-03-01', 'ETH', '1', 'BTC', '0.05'], 0, opts).tx).toMatchObject({ type: 'swap' });
    expect(convertRow(['2026-03-01', 'ETH', '1', '', ''], 0, opts).error).toContain('type impossible');
  });

  it('une seule paire actif/quantité placée selon le type', () => {
    const opts = options({ mapping: { date: 0, type: 1, inAsset: 2, inQty: 3, eur: 4 }, dateFormat: 'iso', decimal: '.' });
    expect(convertRow(['2026-03-01', 'sell', 'BTC', '0.1', '5000'], 0, opts).tx).toMatchObject({ type: 'sell', out: { asset: 'BTC', quantity: '0.1' } });
  });
});

describe('format pmpa-crypto', () => {
  it('export puis réimport sans perte', () => {
    const original: Transaction[] = sampleTransactions();
    const text = transactionsToCsv(original);
    const table = parseCsv(text);
    expect(isPmpaFormat(table.headers)).toBe(true);
    const r = parseGeneric(table, pmpaOptions(table, 'export.csv'));
    const strip = (t: Transaction) => {
      const { source: _s, ...rest } = t;
      return rest;
    };
    expect(r.transactions.map(strip)).toEqual(original.map(strip).map((t) => ({ ...t, date: t.date.length === 16 ? `${t.date}:00` : t.date })));
  });
});
