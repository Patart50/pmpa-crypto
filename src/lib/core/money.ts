/**
 * Arithmétique monétaire exacte.
 *
 * Aucun calcul de montant ne doit passer par `number` : les quantités crypto
 * ont jusqu'à 18 décimales et les flottants IEEE 754 produisent des écarts
 * visibles (0.1 + 0.2 !== 0.3). Tout passe par decimal.js.
 */
import Decimal from 'decimal.js';

/** Instance isolée : ne modifie pas la configuration globale de decimal.js. */
export const D = Decimal.clone({
  precision: 50,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -30,
  toExpPos: 40,
});

export type Dec = InstanceType<typeof D>;

export type DecInput = Dec | string | number;

/**
 * Convertit une entrée en décimal exact.
 * Les `number` sont acceptés pour la commodité des tests mais passent par
 * leur représentation texte pour éviter de propager l'erreur binaire.
 */
export function dec(value: DecInput): Dec {
  if (value instanceof D) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError(`Montant non fini : ${value}`);
    return new D(String(value));
  }
  const normalized = value.trim().replace(',', '.');
  if (normalized === '') throw new RangeError('Montant vide');
  return new D(normalized);
}

export const ZERO = new D(0);

/** Arrondi au centime (affichage, détail des cessions). */
export function toCents(value: Dec): Dec {
  return value.toDecimalPlaces(2, D.ROUND_HALF_UP);
}

/** Arrondi à l'euro (montants reportés sur la déclaration 2086). */
export function toEuros(value: Dec): Dec {
  return value.toDecimalPlaces(0, D.ROUND_HALF_UP);
}
