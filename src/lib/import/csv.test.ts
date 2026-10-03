import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('lit un CSV simple avec BOM et CRLF', () => {
    const t = parseCsv('﻿a,b,c\r\n1,2,3\r\n4,5,6\r\n');
    expect(t.headers).toEqual(['a', 'b', 'c']);
    expect(t.rows).toEqual([
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('gère guillemets, séparateurs et retours à la ligne dans un champ', () => {
    const t = parseCsv('nom,note\n"Dupont, Jean","il a dit ""ok""\nsur deux lignes"\n');
    expect(t.rows).toEqual([['Dupont, Jean', 'il a dit "ok"\nsur deux lignes']]);
  });

  it('champs vides et dernière ligne sans saut', () => {
    const t = parseCsv('a,b,c\n1,,3\n,,');
    expect(t.rows).toEqual([
      ['1', '', '3'],
      ['', '', ''],
    ]);
  });

  it('ignore les lignes vides', () => {
    expect(parseCsv('a\n\n1\n\n').rows).toEqual([['1']]);
  });

  it('détecte le point-virgule et la tabulation', () => {
    expect(detectDelimiter('Date;Montant;Frais\n')).toBe(';');
    expect(detectDelimiter('Date\tMontant\n')).toBe('\t');
    expect(detectDelimiter('"a;b",c,d\n')).toBe(',');
    expect(parseCsv('Date;Montant\n2024-01-01;1,5\n').rows).toEqual([['2024-01-01', '1,5']]);
  });

  it('aller-retour avec toCsv', () => {
    const rows = [
      ['2024-01-01', 'Dupont, Jean', 'dit "ok"'],
      ['2024-01-02', '', 'a\nb'],
    ];
    const t = parseCsv(toCsv(['date', 'nom', 'note'], rows));
    expect(t.headers).toEqual(['date', 'nom', 'note']);
    expect(t.rows).toEqual(rows);
  });

  it('100 000 lignes en moins d’une seconde', () => {
    const line = '1,2026-01-19 02:02:51,Isolated Margin,Transaction Revenue,USDC,1042.6441,\n';
    const text = 'Identifiant utilisateur,Durée,Compte,Opération,Jeton,Change,Remarque\n' + line.repeat(100_000);
    const start = performance.now();
    const t = parseCsv(text);
    expect(t.rows).toHaveLength(100_000);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
