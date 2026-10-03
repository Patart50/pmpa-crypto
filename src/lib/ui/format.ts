/**
 * Formatage français des montants, quantités et dates.
 * Les montants arrivent en Decimal ; on les arrondit avant de passer par
 * Intl (qui ne travaille qu'en number) pour ne jamais afficher d'artefact
 * binaire.
 */
import { dec, type Dec } from '../core/money';

const eurFormatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const eurWholeFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

type Num = Dec | string | number;

const toDec = (v: Num): Dec => (typeof v === 'object' ? v : dec(v));

/** 1234.5 → « 1 234,50 € ». */
export function eur(value: Num | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return eurFormatter.format(Number(toDec(value).toFixed(2)));
}

/** Arrondi à l'euro : « 1 235 € ». */
export function eurWhole(value: Num): string {
  return eurWholeFormatter.format(Number(toDec(value).toFixed(0)));
}

/** Montant signé, avec « + » pour les gains. */
export function eurSigned(value: Num): string {
  const d = toDec(value);
  const text = eur(d);
  return d.gt(0) ? `+${text}` : text;
}

/**
 * Prix unitaire : plus de décimales pour les actifs à faible prix
 * (0,00001234 € pour un memecoin), 2 au-dessus de 1 €.
 */
export function unitPrice(value: Num | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const d = toDec(value);
  const abs = d.abs();
  if (abs.gte(1) || abs.isZero()) return eur(d);
  const digits = Math.min(10, Math.max(4, -Math.floor(Math.log10(Number(abs.toPrecision(6)))) + 3));
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(Number(d.toFixed(digits)));
}

/** Quantité crypto : séparateurs français, jusqu'à 8 décimales significatives, sans zéros inutiles. */
export function qty(value: Num): string {
  const d = toDec(value);
  const fixed = d.toDecimalPlaces(8).toFixed();
  const [int, frac] = fixed.split('.');
  const intFr = new Intl.NumberFormat('fr-FR').format(Number(int));
  const sign = d.isNegative() && int === '-0' ? '-' : '';
  return frac ? `${sign}${intFr},${frac}` : `${sign}${intFr}`;
}

/** 0.314 → « 31,4 % ». */
export function percent(value: Num): string {
  return `${toDec(value).times(100).toDecimalPlaces(2).toString().replace('.', ',')} %`;
}

/** « 2026-03-15T10:12 » → « 15 mars 2026 à 10:12 ». */
export function dateFr(iso: string, withTime = true): string {
  const [datePart, timePart] = iso.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const text = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
  return withTime && timePart ? `${text} à ${timePart.slice(0, 5)}` : text;
}

/**
 * Normalise une saisie numérique française (« 1 234,56 ») en chaîne
 * décimale (« 1234.56 »). Renvoie undefined si vide, null si invalide.
 */
export function parseInput(raw: string | undefined | null): string | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  const cleaned = String(raw).replace(/[\s  €]/g, '').replace(',', '.');
  if (cleaned === '') return undefined;
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(cleaned)) return null;
  try {
    return dec(cleaned).toString();
  } catch {
    return null;
  }
}

/** Sens d'un montant pour la couleur : gain, perte ou neutre. */
export function tone(value: Num | undefined): 'gain' | 'loss' | 'neutral' {
  if (value === undefined) return 'neutral';
  const d = toDec(value);
  return d.gt(0) ? 'gain' : d.lt(0) ? 'loss' : 'neutral';
}
