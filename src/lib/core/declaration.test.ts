import { describe, expect, it } from 'vitest';
import { computeFiscal, EXEMPTION_THRESHOLD_EUR, type FiscalEvent } from './fiscal';
import { buildDeclaration, estimatedTaxFromDeclaration } from './declaration';
import { dec } from './money';

const threshold = dec(EXEMPTION_THRESHOLD_EUR);
const s = (d: { toString(): string }) => d.toString();

describe('récapitulatif 2086 arrondi à l’euro', () => {
  // Journal de référence (docs/exemples) avec les valeurs de portefeuille calculées sur les cours Binance.
  const events: FiscalEvent[] = [
    { kind: 'acquisition', date: '2025-01-10', amountEur: '3300' },
    { kind: 'cession', date: '2025-06-15', priceEur: '900', feesEur: '0.9', portfolioValueEur: '3598.93', ref: 'c1' },
    { kind: 'cession', date: '2025-08-01', priceEur: '50', portfolioValueEur: '2891.17', ref: 'c2' },
    { kind: 'cession', date: '2026-02-10', priceEur: '370', feesEur: '0.37', portfolioValueEur: '1808.06', ref: 'c3' },
    { kind: 'acquisition', date: '2026-03-05', amountEur: '252' },
  ];
  const result = computeFiscal(events);
  const [y2025, y2026] = buildDeclaration(result, threshold);

  it('lignes saisies arrondies, lignes dérivées recalculées comme le formulaire', () => {
    const [c1, c2] = y2025.cessions;
    expect([c1.l212, c1.l213, c1.l214, c1.l215, c1.l217, c1.l218, c1.l220, c1.l221, c1.l223, c1.l224].map(s)).toEqual([
      '3599', '900', '1', '899', '900', '899', '3300', '0', '3300', '74',
    ]);
    // 221 de la cession suivante = fraction déclarée de la première (3300 × 900 / 3599 = 825,23 → 825)
    expect([c2.l212, c2.l213, c2.l214, c2.l220, c2.l221, c2.l223, c2.l224].map(s)).toEqual(['2891', '50', '0', '3300', '825', '2475', '7']);
  });

  it('totaux 51/52 et case 3AN', () => {
    expect([s(y2025.l51), s(y2025.l52), y2025.box, s(y2025.boxAmount)]).toEqual(['949', '81', '3AN', '81']);
    expect(s(estimatedTaxFromDeclaration(y2025, dec('0.3')))).toBe('24');
  });

  it('chaînage sur l’année suivante et moins-value en 3BN', () => {
    const [c3] = y2026.cessions;
    // 221 = 825 + 43 (2475 × 50 / 2891 = 42,81)
    expect([c3.l212, c3.l213, c3.l214, c3.l220, c3.l221, c3.l223, c3.l224].map(s)).toEqual(['1808', '370', '0', '3300', '868', '2432', '-128']);
    expect([y2026.box, s(y2026.boxAmount), y2026.borderline]).toEqual(['3BN', '128', false]);
    expect(s(estimatedTaxFromDeclaration(y2026, dec('0.314')))).toBe('0');
  });

  it('exonération et cas limite du seuil de 305 €', () => {
    const exempt = buildDeclaration(
      computeFiscal([
        { kind: 'acquisition', date: '2025-01-01', amountEur: '100' },
        { kind: 'cession', date: '2025-02-01', priceEur: '305', portfolioValueEur: '1000' },
      ]),
      threshold,
    )[0];
    expect([exempt.exempt, exempt.box]).toEqual([true, null]);

    const limit = buildDeclaration(
      computeFiscal([
        { kind: 'acquisition', date: '2025-01-01', amountEur: '100' },
        { kind: 'cession', date: '2025-02-01', priceEur: '310', feesEur: '10', portfolioValueEur: '1000' },
      ]),
      threshold,
    )[0];
    expect([limit.exempt, limit.borderline, s(limit.l51)]).toEqual([false, true, '300']);
  });
});

describe('export CSV du récapitulatif', () => {
  it('lignes du formulaire, totaux et case 2042 C', async () => {
    const { declarationCsv } = await import('../ui/declarationCsv');
    const year = buildDeclaration(
      computeFiscal([
        { kind: 'acquisition', date: '2025-01-01', amountEur: '1000' },
        { kind: 'cession', date: '2025-02-01T10:00:00', priceEur: '500', feesEur: '2', portfolioValueEur: '2000' },
      ]),
      threshold,
    )[0];
    const rows = declarationCsv(year).replace('﻿', '').trim().split('\r\n');
    expect(rows[0]).toBe('Ligne;Libellé;Cession 1');
    expect(rows).toContain('211;Date de la cession;2025-02-01');
    expect(rows).toContain('224;Plus-value ou moins-value;248');
    expect(rows.at(-1)).toBe('3AN;Case 3AN de la 2042 C;248');
  });
});
