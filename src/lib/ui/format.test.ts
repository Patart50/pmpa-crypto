import { describe, expect, it } from 'vitest';
import { dateFr, eur, eurSigned, parseInput, percent, qty, tone, unitPrice } from './format';

// Intl insère des espaces insécables : on les normalise pour les comparaisons.
const n = (s: string) => s.replace(/[  ]/g, ' ');

describe('format', () => {
  it('eur', () => {
    expect(n(eur('1234.5'))).toBe('1 234,50 €');
    expect(eur(null)).toBe('—');
    expect(n(eurSigned('10'))).toBe('+10,00 €');
    expect(n(eurSigned('-10'))).toBe('-10,00 €');
  });

  it('unitPrice adapte la précision', () => {
    expect(n(unitPrice('35015'))).toBe('35 015,00 €');
    expect(n(unitPrice('0.00001234'))).toBe('0,00001234 €');
    expect(n(unitPrice('0.5'))).toBe('0,50 €');
  });

  it('qty', () => {
    expect(n(qty('1234.5'))).toBe('1 234,5');
    expect(qty('0.00079747')).toBe('0,00079747');
    expect(qty('2')).toBe('2');
    expect(qty('0.123456789')).toBe('0,12345679');
  });

  it('percent', () => {
    expect(percent('0.314')).toBe('31,4 %');
    expect(percent('0.3')).toBe('30 %');
  });

  it('dateFr', () => {
    expect(n(dateFr('2026-03-15T10:12:30'))).toBe('15 mars 2026 à 10:12');
    expect(n(dateFr('2026-03-15'))).toBe('15 mars 2026');
  });

  it('parseInput', () => {
    expect(parseInput('1 234,56')).toBe('1234.56');
    expect(parseInput('0,0015')).toBe('0.0015');
    expect(parseInput('12 €')).toBe('12');
    expect(parseInput('')).toBeUndefined();
    expect(parseInput('abc')).toBeNull();
    expect(parseInput('1,2,3')).toBeNull();
  });

  it('tone', () => {
    expect(tone('1')).toBe('gain');
    expect(tone('-1')).toBe('loss');
    expect(tone('0')).toBe('neutral');
  });
});
