/**
 * Récapitulatif prêt à reporter sur le formulaire 2086 et la 2042 C.
 *
 * Le moteur fiscal (fiscal.ts) calcule au centime près. Le contribuable, lui,
 * saisit des euros entiers et le formulaire recalcule les lignes dérivées à
 * partir de ces saisies. On reproduit donc ce que le formulaire affichera :
 * les montants saisis (212, 213, 214, 220) sont arrondis à l'euro, les lignes
 * dérivées sont recalculées à partir d'eux, et les fractions de capital
 * initial (ligne 221) sont chaînées à partir des valeurs déclarées (D-040).
 *
 * Lignes du formulaire 2086 (déclarant 1) :
 *   211 date · 212 valeur globale du portefeuille · 213 prix de cession ·
 *   214 frais · 215 = 213 − 214 · 216 soulte · 217 = 213 ∓ 216 ·
 *   218 = 215 ∓ 216 · 220 prix total d'acquisition · 221 fractions de
 *   capital initial · 222 soultes reçues antérieures · 223 = 220 − 221 − 222 ·
 *   224 = 218 − 223 × 217 / 212.
 * Totaux du foyer : 51 = Σ 218, 52 = Σ 224 → case 3AN (plus-value) ou 3BN
 * (moins-value) de la 2042 C.
 */
import { ZERO, toEuros, type Dec } from './money';
import type { FiscalResult } from './fiscal';

export interface DeclaredCession {
  ref?: string;
  date: string;
  l212: Dec;
  l213: Dec;
  l214: Dec;
  l215: Dec;
  /** Soultes : non gérées en v1.0, toujours 0. */
  l216: Dec;
  l217: Dec;
  l218: Dec;
  l220: Dec;
  l221: Dec;
  l222: Dec;
  l223: Dec;
  l224: Dec;
}

export interface DeclaredYear {
  year: number;
  cessions: DeclaredCession[];
  /** Ligne 51 : total des prix de cession nets des frais. */
  l51: Dec;
  /** Ligne 52 : total des plus et moins-values. */
  l52: Dec;
  /** Exonéré : total des prix de cession bruts ≤ 305 € (D-010). */
  exempt: boolean;
  /**
   * Cas limite : prix bruts au-dessus de 305 € mais ligne 51 (nette de
   * frais) en dessous. Le formulaire pourrait conclure à l'exonération.
   */
  borderline: boolean;
  /** Case de la 2042 C et montant à y porter (aucune si exonéré ou nul). */
  box: '3AN' | '3BN' | null;
  boxAmount: Dec;
}

/** Construit le récapitulatif de chaque année à partir du résultat du moteur. */
export function buildDeclaration(result: FiscalResult, threshold: Dec): DeclaredYear[] {
  let declaredFractions = ZERO;
  return result.years.map((y) => {
    const cessions = y.cessions.map((c): DeclaredCession => {
      const l212 = toEuros(c.portfolioValue);
      const l213 = toEuros(c.price);
      const l214 = toEuros(c.fees);
      const l215 = l213.minus(l214);
      const l216 = ZERO;
      const l217 = l213.minus(l216);
      const l218 = l215.minus(l216);
      const l220 = toEuros(c.grossAcquisition);
      const l221 = declaredFractions;
      const l222 = ZERO;
      const l223 = l220.minus(l221).minus(l222);
      const fraction = l212.isZero() ? ZERO : l223.times(l217).dividedBy(l212);
      const l224 = toEuros(l218.minus(fraction));
      declaredFractions = declaredFractions.plus(toEuros(fraction));
      return { ref: c.ref, date: c.date, l212, l213, l214, l215, l216, l217, l218, l220, l221, l222, l223, l224 };
    });
    const l51 = cessions.reduce((s, c) => s.plus(c.l218), ZERO);
    const l52 = cessions.reduce((s, c) => s.plus(c.l224), ZERO);
    const exempt = y.exempt;
    const box = exempt || l52.isZero() ? null : l52.gt(0) ? '3AN' : '3BN';
    return {
      year: y.year,
      cessions,
      l51,
      l52,
      exempt,
      borderline: !exempt && l51.lte(threshold),
      box,
      boxAmount: box ? l52.abs() : ZERO,
    };
  });
}

/** Impôt estimé à partir du montant déclaré en 3AN (euros entiers). */
export function estimatedTaxFromDeclaration(year: DeclaredYear, rate: Dec): Dec {
  return year.box === '3AN' ? toEuros(year.boxAmount.times(rate)) : ZERO;
}
