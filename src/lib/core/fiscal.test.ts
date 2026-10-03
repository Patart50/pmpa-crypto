import { describe, expect, it } from 'vitest';
import {
  computeFiscal,
  FiscalInputError,
  rateForYear,
  roundDetail,
  type FiscalEvent,
} from './fiscal';

const s = (value: { toString(): string }) => value.toString();

describe('Exemples officiels BOI-RPPM-PVBMC-30-20', () => {
  it('§ 110 : fraction de capital initial sur deux cessions successives', () => {
    const events: FiscalEvent[] = [
      { kind: 'acquisition', date: '2024-01-15', amountEur: 1000 },
      { kind: 'cession', date: '2024-03-15', priceEur: 450, portfolioValueEur: 1200, ref: 'mars' },
      { kind: 'cession', date: '2024-08-15', priceEur: 1300, portfolioValueEur: 1300, ref: 'aout' },
    ];
    const { years, remainingAcquisition } = computeFiscal(events);
    const [mars, aout] = years[0].cessions;

    expect(s(mars.capitalFraction)).toBe('375');
    expect(s(mars.gain)).toBe('75');

    expect(s(aout.grossAcquisition)).toBe('1000');
    expect(s(aout.previousFractions)).toBe('375');
    expect(s(aout.netAcquisition)).toBe('625');
    expect(s(aout.gain)).toBe('675');

    expect(s(years[0].netGain)).toBe('750');
    expect(s(remainingAcquisition)).toBe('0');
  });

  it('§ 120 : échange avec soulte reçue puis cession totale', () => {
    // L'échange imposable (actifs reçus 600 € + soulte 150 €) est une cession
    // de 750 €, et les actifs reçus entrent au prix d'acquisition pour 600 €.
    const events: FiscalEvent[] = [
      { kind: 'acquisition', date: '2024-01-10', amountEur: 500 },
      { kind: 'cession', date: '2024-03-10', priceEur: 750, portfolioValueEur: 750 },
      { kind: 'acquisition', date: '2024-03-10', amountEur: 600 },
      { kind: 'cession', date: '2024-10-10', priceEur: 800, portfolioValueEur: 800 },
    ];
    const [mars, octobre] = computeFiscal(events).years[0].cessions;
    expect(s(mars.gain)).toBe('250');
    expect(s(octobre.netAcquisition)).toBe('600');
    expect(s(octobre.gain)).toBe('200');
  });

  it('§ 70 : le prix total d’acquisition cumule achats, biens remis et soultes versées', () => {
    const events: FiscalEvent[] = [
      { kind: 'acquisition', date: '2024-01-01', amountEur: 500 },
      { kind: 'acquisition', date: '2024-03-01', amountEur: 200 }, // bien remis en échange
      { kind: 'acquisition', date: '2024-03-01', amountEur: 100 }, // soulte versée
      { kind: 'cession', date: '2024-06-01', priceEur: 400, portfolioValueEur: 1600 },
    ];
    const [cession] = computeFiscal(events).years[0].cessions;
    expect(s(cession.grossAcquisition)).toBe('800');
    expect(s(cession.capitalFraction)).toBe('200');
    expect(s(cession.gain)).toBe('200');
  });

  it('§ 160 : les résultats des cessions de l’année s’additionnent', () => {
    // Le principe du § 160, sur des montants construits pour le test.
    const events: FiscalEvent[] = [
      { kind: 'acquisition', date: '2024-01-01', amountEur: 1000 },
      { kind: 'cession', date: '2024-02-01', priceEur: 500, portfolioValueEur: 5000 }, // 500 − 100 = +400
      { kind: 'cession', date: '2024-03-01', priceEur: 300, portfolioValueEur: 2000 }, // 300 − 900×300/2000 = +165
    ];
    const { years } = computeFiscal(events);
    expect(s(years[0].cessions[0].gain)).toBe('400');
    expect(s(years[0].cessions[1].gain)).toBe('165');
    expect(s(years[0].netGain)).toBe('565');
    expect(s(years[0].taxableGain)).toBe('565');
  });

  it('§ 170 : moins-value nette non imposable et non reportable', () => {
    const events: FiscalEvent[] = [
      { kind: 'acquisition', date: '2024-01-01', amountEur: 2000 },
      { kind: 'cession', date: '2024-06-01', priceEur: 400, portfolioValueEur: 1000 }, // 400 − 800 = −400
      { kind: 'cession', date: '2025-06-01', priceEur: 600, portfolioValueEur: 1000 }, // 600 − 1200×0.6 = −120
      { kind: 'cession', date: '2025-07-01', priceEur: 1000, portfolioValueEur: 1000 },
    ];
    const { years } = computeFiscal(events);
    expect(s(years[0].netGain)).toBe('-400');
    expect(s(years[0].taxableGain)).toBe('0');
    expect(s(years[0].estimatedTax)).toBe('0');
    // La moins-value 2024 ne vient pas réduire 2025.
    // 2025 : −120 puis 1000 − 480 = +520 → net 400.
    expect(s(years[1].netGain)).toBe('400');
    expect(s(years[1].taxableGain)).toBe('400');
  });
});

describe('Frais de cession', () => {
  it('se déduisent du premier terme seulement', () => {
    const events: FiscalEvent[] = [
      { kind: 'acquisition', date: '2024-01-01', amountEur: 1000 },
      { kind: 'cession', date: '2024-03-01', priceEur: 450, feesEur: 5, portfolioValueEur: 1200 },
    ];
    const [cession] = computeFiscal(events).years[0].cessions;
    expect(s(cession.netPrice)).toBe('445');
    expect(s(cession.capitalFraction)).toBe('375'); // calculée sur le prix brut
    expect(s(cession.gain)).toBe('70');
  });
});

describe('Seuil d’exonération de 305 €', () => {
  const withPrice = (price: string): FiscalEvent[] => [
    { kind: 'acquisition', date: '2024-01-01', amountEur: 10 },
    { kind: 'cession', date: '2024-05-01', priceEur: price, portfolioValueEur: 1000 },
  ];

  it('305 € pile : exonéré', () => {
    const [year] = computeFiscal(withPrice('305')).years;
    expect(year.exempt).toBe(true);
    expect(s(year.taxableGain)).toBe('0');
    expect(s(year.netGain)).not.toBe('0');
  });

  it('305,01 € : imposable', () => {
    const [year] = computeFiscal(withPrice('305.01')).years;
    expect(year.exempt).toBe(false);
    expect(year.taxableGain.gt(0)).toBe(true);
  });

  it('porte sur la somme des prix bruts de l’année, frais compris', () => {
    const events: FiscalEvent[] = [
      { kind: 'acquisition', date: '2024-01-01', amountEur: 10 },
      { kind: 'cession', date: '2024-02-01', priceEur: 200, feesEur: 10, portfolioValueEur: 1000 },
      { kind: 'cession', date: '2024-09-01', priceEur: 110, feesEur: 10, portfolioValueEur: 1000 },
    ];
    const [year] = computeFiscal(events).years;
    expect(s(year.totalCessionPrices)).toBe('310');
    expect(year.exempt).toBe(false);
  });

  it('s’apprécie année par année', () => {
    const events: FiscalEvent[] = [
      { kind: 'acquisition', date: '2024-01-01', amountEur: 10 },
      { kind: 'cession', date: '2024-12-31T23:59:59', priceEur: 300, portfolioValueEur: 1000 },
      { kind: 'cession', date: '2025-01-01T00:00:00', priceEur: 300, portfolioValueEur: 700 },
    ];
    const { years } = computeFiscal(events);
    expect(years.map((y) => [y.year, y.exempt])).toEqual([
      [2024, true],
      [2025, true],
    ]);
  });
});

describe('Impôt estimé', () => {
  it('applique le taux de l’année sur la base arrondie à l’euro', () => {
    const events: FiscalEvent[] = [
      { kind: 'acquisition', date: '2024-01-01', amountEur: 1000 },
      { kind: 'cession', date: '2024-03-01', priceEur: 1000.6, portfolioValueEur: 2001.2 },
    ];
    // PV = 1000.6 − 1000 × 0.5 = 500.6 → base 501 → 30 % = 150.3 → 150
    const [year] = computeFiscal(events).years;
    expect(s(year.taxableGain)).toBe('500.6');
    expect(s(year.taxableGainRounded)).toBe('501');
    expect(s(year.estimatedTax)).toBe('150');
  });

  it('accepte une surcharge du taux', () => {
    const events: FiscalEvent[] = [
      { kind: 'acquisition', date: '2026-01-01', amountEur: 0 },
      { kind: 'cession', date: '2026-03-01', priceEur: 1000, portfolioValueEur: 1000 },
    ];
    const [year] = computeFiscal(events, { rates: { 2026: '0.30' } }).years;
    expect(s(year.estimatedTax)).toBe('300');
  });

  it('table des taux par défaut', () => {
    expect(s(rateForYear(2023))).toBe('0.3');
    expect(s(rateForYear(2025))).toBe('0.3');
    expect(s(rateForYear(2026))).toBe('0.314');
    expect(s(rateForYear(2030))).toBe('0.314');
    expect(() => rateForYear(2018)).toThrow(FiscalInputError);
  });
});

describe('Robustesse', () => {
  it('trie chronologiquement en conservant l’ordre à date égale', () => {
    const events: FiscalEvent[] = [
      { kind: 'cession', date: '2024-08-15', priceEur: 1300, portfolioValueEur: 1300, ref: 'aout' },
      { kind: 'acquisition', date: '2024-01-15', amountEur: 1000 },
      { kind: 'cession', date: '2024-03-15', priceEur: 450, portfolioValueEur: 1200, ref: 'mars' },
    ];
    const refs = computeFiscal(events).years[0].cessions.map((c) => c.ref);
    expect(refs).toEqual(['mars', 'aout']);
  });

  it('aucune erreur d’arrondi binaire sur les petits montants', () => {
    const events: FiscalEvent[] = [
      { kind: 'acquisition', date: '2024-01-01', amountEur: '0.1' },
      { kind: 'acquisition', date: '2024-01-02', amountEur: '0.2' },
      { kind: 'cession', date: '2024-02-01', priceEur: '0.3', portfolioValueEur: '0.3' },
    ];
    const [cession] = computeFiscal(events).years[0].cessions;
    expect(s(cession.grossAcquisition)).toBe('0.3');
    expect(s(cession.gain)).toBe('0');
  });

  it('accepte la virgule décimale française', () => {
    const events: FiscalEvent[] = [
      { kind: 'acquisition', date: '2024-01-01', amountEur: '1 000'.replace(' ', '') },
      { kind: 'cession', date: '2024-03-15', priceEur: '450,00', portfolioValueEur: '1200,00' },
    ];
    expect(s(computeFiscal(events).years[0].cessions[0].gain)).toBe('75');
  });

  it('signale une valeur de portefeuille inférieure au prix de cession', () => {
    const { warnings } = computeFiscal([
      { kind: 'acquisition', date: '2024-01-01', amountEur: 100 },
      { kind: 'cession', date: '2024-02-01', priceEur: 500, portfolioValueEur: 400, ref: 'x' },
    ]);
    expect(warnings.map((w) => w.code)).toContain('PORTFOLIO_VALUE_BELOW_PRICE');
  });

  it('signale un prix d’acquisition épuisé', () => {
    const { warnings, years } = computeFiscal([
      { kind: 'acquisition', date: '2024-01-01', amountEur: 100 },
      { kind: 'cession', date: '2024-02-01', priceEur: 200, portfolioValueEur: 200 },
      { kind: 'cession', date: '2024-03-01', priceEur: 50, portfolioValueEur: 50 },
    ]);
    expect(warnings.map((w) => w.code)).toEqual(['ACQUISITION_EXHAUSTED']);
    expect(s(years[0].cessions[1].gain)).toBe('50');
  });

  it.each([
    ['date invalide', { kind: 'cession', date: '15/03/2024', priceEur: 1, portfolioValueEur: 1 }],
    ['prix nul', { kind: 'cession', date: '2024-03-15', priceEur: 0, portfolioValueEur: 1 }],
    ['frais négatifs', { kind: 'cession', date: '2024-03-15', priceEur: 1, feesEur: -1, portfolioValueEur: 1 }],
    ['portefeuille nul', { kind: 'cession', date: '2024-03-15', priceEur: 1, portfolioValueEur: 0 }],
    ['acquisition négative', { kind: 'acquisition', date: '2024-03-15', amountEur: -5 }],
    ['montant vide', { kind: 'acquisition', date: '2024-03-15', amountEur: '' }],
  ] as const)('rejette : %s', (_label, event) => {
    expect(() => computeFiscal([event as FiscalEvent])).toThrow();
  });

  it('roundDetail formate au centime', () => {
    const [cession] = computeFiscal([
      { kind: 'acquisition', date: '2024-01-01', amountEur: 100 },
      { kind: 'cession', date: '2024-02-01', priceEur: 100, portfolioValueEur: 300 },
    ]).years[0].cessions;
    expect(roundDetail(cession).capitalFraction).toBe('33.33');
    expect(roundDetail(cession).gain).toBe('66.67');
  });
});
