/**
 * Moteur fiscal : plus-values de cession d'actifs numériques des particuliers
 * (article 150 VH bis du CGI, BOI-RPPM-PVBMC-30-20 et BOI-RPPM-PVBMC-30-10).
 *
 * Ce module est pur : aucune dépendance au navigateur, au stockage ou à l'UI.
 * Il travaille sur des « événements fiscaux » déjà qualifiés. La traduction
 * des transactions brutes (achats, échanges, imports CSV…) en événements
 * fiscaux est faite ailleurs.
 *
 * Rappel de la méthode (calcul GLOBAL sur tout le portefeuille, pas par actif) :
 *
 *   PV = (C − F) − A × C / V
 *
 *   C : prix de cession (somme réellement perçue ou valeur de la contrepartie)
 *   F : frais de cession, déduits du seul premier terme (§ 50)
 *   A : prix total d'acquisition net, c'est-à-dire la somme des acquisitions
 *       diminuée des fractions de capital initial déjà « consommées » par les
 *       cessions imposables antérieures (§ 100)
 *   V : valeur globale du portefeuille juste avant la cession (§ 140)
 *
 * La fraction de capital initial d'une cession vaut A × C / V. Elle est
 * retranchée de A pour les cessions suivantes.
 *
 * Échanges entre actifs numériques sans soulte : pas un fait générateur, ils
 * ne doivent PAS être transmis à ce moteur.
 */
import { D, dec, ZERO, toCents, toEuros, type Dec, type DecInput } from './money';

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

/** Date ISO locale : « AAAA-MM-JJ » ou « AAAA-MM-JJTHH:mm:ss ». */
export type IsoDate = string;

/**
 * Entrée dans le portefeuille, à retenir dans le prix total d'acquisition :
 * achat contre euros (montant décaissé), bien ou service remis en échange
 * (valeur), soulte versée, acquisition à titre gratuit (valeur retenue pour
 * les droits de mutation ou valeur réelle), actif reçu lors d'un échange
 * imposable (valeur).
 */
export interface AcquisitionEvent {
  kind: 'acquisition';
  date: IsoDate;
  /** Montant à ajouter au prix total d'acquisition, en euros. */
  amountEur: DecInput;
  /** Identifiant libre de la transaction d'origine (traçabilité). */
  ref?: string;
}

/**
 * Cession imposable : vente contre euros, paiement d'un bien ou service en
 * crypto, échange avec soulte reçue.
 */
export interface CessionEvent {
  kind: 'cession';
  date: IsoDate;
  /** Prix de cession C (soulte reçue incluse), en euros. */
  priceEur: DecInput;
  /** Frais de cession F (plateforme, réseau), en euros. 0 par défaut. */
  feesEur?: DecInput;
  /**
   * Valeur globale V de TOUS les actifs numériques détenus juste avant la
   * cession, toutes plateformes et wallets confondus, en euros.
   */
  portfolioValueEur: DecInput;
  ref?: string;
}

export type FiscalEvent = AcquisitionEvent | CessionEvent;

/** Détail d'une cession, dans l'ordre des lignes du formulaire 2086. */
export interface CessionDetail {
  ref?: string;
  date: IsoDate;
  year: number;
  /** Ligne 212 : valeur globale du portefeuille. */
  portfolioValue: Dec;
  /** Ligne 213 : prix de cession. */
  price: Dec;
  /** Ligne 214 : frais de cession. */
  fees: Dec;
  /** Ligne 215 : prix de cession net (C − F). */
  netPrice: Dec;
  /** Ligne 220 : prix total d'acquisition (avant fractions antérieures). */
  grossAcquisition: Dec;
  /** Ligne 221 : fractions de capital initial des cessions antérieures. */
  previousFractions: Dec;
  /** Ligne 223 : prix total d'acquisition net (A). */
  netAcquisition: Dec;
  /** Fraction de capital initial de cette cession (A × C / V). */
  capitalFraction: Dec;
  /** Ligne 224 : plus-value (positive) ou moins-value (négative). */
  gain: Dec;
}

export interface YearSummary {
  year: number;
  cessions: CessionDetail[];
  /** Somme des prix de cession bruts, servant au seuil de 305 €. */
  totalCessionPrices: Dec;
  /** Vrai si le total des prix de cession n'excède pas le seuil. */
  exempt: boolean;
  /** Somme des plus et moins-values de l'année (peut être négative). */
  netGain: Dec;
  /**
   * Base imposable : 0 si exonéré ou si moins-value nette (pas de report sur
   * les années suivantes, § 170).
   */
  taxableGain: Dec;
  /** Base imposable arrondie à l'euro, telle que reportée sur la 2042-C. */
  taxableGainRounded: Dec;
  /** Taux global appliqué (impôt + prélèvements sociaux). */
  rate: Dec;
  /** Impôt estimé (PFU), arrondi à l'euro. */
  estimatedTax: Dec;
}

export interface FiscalResult {
  years: YearSummary[];
  /** Prix total d'acquisition net restant après la dernière cession. */
  remainingAcquisition: Dec;
  warnings: FiscalWarning[];
}

export type FiscalWarningCode =
  | 'PORTFOLIO_VALUE_BELOW_PRICE'
  | 'ACQUISITION_EXHAUSTED';

export interface FiscalWarning {
  code: FiscalWarningCode;
  ref?: string;
  date: IsoDate;
  message: string;
}

export class FiscalInputError extends Error {
  constructor(
    message: string,
    public readonly ref?: string,
  ) {
    super(message);
    this.name = 'FiscalInputError';
  }
}

// ---------------------------------------------------------------------------
// Paramètres
// ---------------------------------------------------------------------------

/** Seuil d'exonération : somme des prix de cession de l'année (§ 150 VH bis II). */
export const EXEMPTION_THRESHOLD_EUR = dec(305);

/**
 * Taux global du prélèvement forfaitaire unique par année de cession.
 * 12,8 % d'impôt sur le revenu + prélèvements sociaux : 17,2 % pour les
 * cessions d'actifs numériques jusqu'au 31/12/2025, 18,6 % à partir du
 * 01/01/2026 (hausse de CSG de la LFSS 2026). Voir DECISIONS.md, D-013.
 * Le taux reste surchargeable.
 */
export const DEFAULT_RATES: Readonly<Record<number, string>> = Object.freeze({
  2019: '0.30',
  2020: '0.30',
  2021: '0.30',
  2022: '0.30',
  2023: '0.30',
  2024: '0.30',
  2025: '0.30',
  2026: '0.314',
});

export interface FiscalOptions {
  /** Surcharge des taux par année (ex. { 2026: '0.314' }). */
  rates?: Record<number, DecInput>;
}

export function rateForYear(year: number, overrides?: Record<number, DecInput>): Dec {
  if (overrides && overrides[year] !== undefined) return dec(overrides[year]);
  if (DEFAULT_RATES[year] !== undefined) return dec(DEFAULT_RATES[year]);
  // Au-delà de la table : dernier taux connu.
  const known = Object.keys(DEFAULT_RATES).map(Number).sort((a, b) => a - b);
  const last = known[known.length - 1];
  if (year > last) return dec(DEFAULT_RATES[last]);
  throw new FiscalInputError(
    `Aucun taux connu pour ${year} : le régime du 150 VH bis s'applique aux cessions depuis 2019.`,
  );
}

// ---------------------------------------------------------------------------
// Calcul
// ---------------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2})?)?$/;

function yearOf(date: IsoDate, ref?: string): number {
  const match = ISO_DATE.exec(date);
  if (!match) throw new FiscalInputError(`Date invalide : « ${date} » (attendu AAAA-MM-JJ).`, ref);
  return Number(match[1]);
}

function requirePositive(value: Dec, label: string, ref?: string, allowZero = false): void {
  if (value.isNaN() || (allowZero ? value.isNegative() : value.lte(0))) {
    throw new FiscalInputError(
      `${label} doit être ${allowZero ? 'positif ou nul' : 'strictement positif'} (reçu ${value.toString()}).`,
      ref,
    );
  }
}

/**
 * Calcule les plus-values imposables, année par année.
 *
 * Les événements sont traités par ordre chronologique. À date identique,
 * l'ordre fourni est conservé : c'est à l'appelant de placer une acquisition
 * avant une cession si elles ont lieu au même instant.
 */
export function computeFiscal(events: readonly FiscalEvent[], options: FiscalOptions = {}): FiscalResult {
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => (a.event.date < b.event.date ? -1 : a.event.date > b.event.date ? 1 : a.index - b.index))
    .map(({ event }) => event);

  let grossAcquisition = ZERO; // somme des acquisitions (ligne 220)
  let consumedFractions = ZERO; // somme des fractions de capital initial (ligne 221)
  const warnings: FiscalWarning[] = [];
  const byYear = new Map<number, CessionDetail[]>();

  for (const event of ordered) {
    const year = yearOf(event.date, event.ref);

    if (event.kind === 'acquisition') {
      const amount = dec(event.amountEur);
      requirePositive(amount, "Le montant d'acquisition", event.ref, true);
      grossAcquisition = grossAcquisition.plus(amount);
      continue;
    }

    const price = dec(event.priceEur);
    const fees = dec(event.feesEur ?? 0);
    const portfolioValue = dec(event.portfolioValueEur);
    requirePositive(price, 'Le prix de cession', event.ref);
    requirePositive(fees, 'Les frais de cession', event.ref, true);
    requirePositive(portfolioValue, 'La valeur globale du portefeuille', event.ref);

    if (portfolioValue.lt(price)) {
      warnings.push({
        code: 'PORTFOLIO_VALUE_BELOW_PRICE',
        ref: event.ref,
        date: event.date,
        message:
          'La valeur globale du portefeuille est inférieure au prix de cession : elle doit inclure les actifs cédés. Vérifiez la saisie.',
      });
    }

    let netAcquisition = grossAcquisition.minus(consumedFractions);
    if (netAcquisition.isNegative()) netAcquisition = ZERO;
    if (netAcquisition.isZero() && grossAcquisition.gt(0)) {
      warnings.push({
        code: 'ACQUISITION_EXHAUSTED',
        ref: event.ref,
        date: event.date,
        message:
          "Le prix total d'acquisition est entièrement consommé : toute la cession est imposée comme plus-value.",
      });
    }

    const capitalFraction = netAcquisition.times(price).dividedBy(portfolioValue);
    const netPrice = price.minus(fees);
    const gain = netPrice.minus(capitalFraction);

    const detail: CessionDetail = {
      ref: event.ref,
      date: event.date,
      year,
      portfolioValue,
      price,
      fees,
      netPrice,
      grossAcquisition,
      previousFractions: consumedFractions,
      netAcquisition,
      capitalFraction,
      gain,
    };

    consumedFractions = consumedFractions.plus(capitalFraction);
    const list = byYear.get(year);
    if (list) list.push(detail);
    else byYear.set(year, [detail]);
  }

  const years = [...byYear.keys()]
    .sort((a, b) => a - b)
    .map((year) => summarizeYear(year, byYear.get(year) ?? [], options));

  let remainingAcquisition = grossAcquisition.minus(consumedFractions);
  if (remainingAcquisition.isNegative()) remainingAcquisition = ZERO;

  return { years, remainingAcquisition, warnings };
}

function summarizeYear(year: number, cessions: CessionDetail[], options: FiscalOptions): YearSummary {
  const totalCessionPrices = cessions.reduce((sum, c) => sum.plus(c.price), ZERO);
  const netGain = cessions.reduce((sum, c) => sum.plus(c.gain), ZERO);
  const exempt = totalCessionPrices.lte(EXEMPTION_THRESHOLD_EUR);
  const taxableGain = exempt || netGain.lte(0) ? ZERO : netGain;
  const taxableGainRounded = toEuros(taxableGain);
  const rate = rateForYear(year, options.rates);
  const estimatedTax = toEuros(taxableGainRounded.times(rate));
  return {
    year,
    cessions,
    totalCessionPrices,
    exempt,
    netGain,
    taxableGain,
    taxableGainRounded,
    rate,
    estimatedTax,
  };
}

/** Version arrondie au centime d'un détail de cession, pour l'affichage. */
export function roundDetail(detail: CessionDetail): Record<string, string> {
  return {
    date: detail.date,
    portfolioValue: toCents(detail.portfolioValue).toFixed(2),
    price: toCents(detail.price).toFixed(2),
    fees: toCents(detail.fees).toFixed(2),
    netPrice: toCents(detail.netPrice).toFixed(2),
    netAcquisition: toCents(detail.netAcquisition).toFixed(2),
    capitalFraction: toCents(detail.capitalFraction).toFixed(2),
    gain: toCents(detail.gain).toFixed(2),
  };
}

export { D };
