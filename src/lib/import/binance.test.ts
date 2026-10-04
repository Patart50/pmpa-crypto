import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { detectBinanceLedger, isBinanceAdjustment, mergeBinanceTables, parseBinanceLedger } from './binance';
import { computePortfolio } from '../core/portfolio';
import { offsetFromFileName, toParisTime } from './common';
import { validateTransaction } from '../core/transactions';

// Jeu synthétique au format réel de l'export (identifiant et montants fictifs).
const HEADER = 'Identifiant utilisateur,Durée,Compte,Opération,Jeton,Change,Remarque';
const rows = [
  // Achat USDC contre EUR, frais en USDC
  '1,2026-01-31 15:28:41,Spot,Transaction Sold,EUR,-300,',
  '1,2026-01-31 15:28:41,Spot,Transaction Revenue,USDC,355.44,',
  '1,2026-01-31 15:28:41,Spot,Transaction Fee,USDC,-0.337668,',
  // Vente USDC contre EUR, exécutée en deux fois, frais en EUR
  '1,2026-02-08 10:40:03,Spot,Transaction Spend,USDC,-500.1311,',
  '1,2026-02-08 10:40:03,Spot,Transaction Spend,USDC,-350,',
  '1,2026-02-08 10:40:03,Spot,Transaction Buy,EUR,721,',
  '1,2026-02-08 10:40:03,Spot,Transaction Fee,EUR,-0.68495,',
  // Échange USDC → BNB, frais payés en BNB (BNB Fee Deduction)
  '1,2026-02-10 04:15:59,Spot,Transaction Spend,USDC,-49.881,',
  '1,2026-02-10 04:15:59,Spot,Transaction Buy,BNB,0.078,',
  '1,2026-02-10 04:15:59,Spot,BNB Fee Deduction,BNB,-0.00005557,',
  // Robot de trading (compte Strategy) : traité comme du Spot
  '1,2026-02-11 09:00:00,Strategy,Transaction Spend,USDC,-100,',
  '1,2026-02-11 09:00:00,Strategy,Transaction Buy,ETH,0.04,',
  '1,2026-02-11 09:00:00,Strategy,Transaction Fee,ETH,-0.00004,',
  // Binance Convert à une seconde d'écart
  '1,2026-04-16 14:21:58,Spot,Binance Convert,BNB,0.0174481,',
  '1,2026-04-16 14:21:59,Spot,Binance Convert,EUR,-9.280477,',
  // Petits soldes convertis : deux paires dans la même seconde, distinguées par la remarque
  '1,2026-06-20 20:27:44,Spot,Small Assets Exchange BNB,USDC,0.09448326,ACE to USDC',
  '1,2026-06-20 20:27:44,Spot,Small Assets Exchange BNB,ACE,-1.12603444,ACE to USDC',
  '1,2026-06-20 20:27:44,Spot,Small Assets Exchange BNB,HUMA,-29.68857135,HUMA to USDC',
  '1,2026-06-20 20:27:44,Spot,Small Assets Exchange BNB,USDC,0.69966115,HUMA to USDC',
  // Récompenses du même jour, agrégées
  '1,2026-01-01 07:37:49,Spot,Simple Earn Flexible Interest,USDC,0.00020894,Binance Earn',
  '1,2026-01-01 08:37:49,Spot,Simple Earn Flexible Interest,USDC,0.00020000,Binance Earn',
  '1,2026-01-02 09:00:00,Spot,Launchpool Airdrop - User Claim Distribution,HUMA,30,',
  // Transferts internes et mouvements en euros : ignorés
  '1,2026-01-01 07:53:35,Spot,Simple Earn Flexible Subscription,USDC,-0.00020894,Binance Earn',
  '1,2026-01-31 15:27:15,Spot,Deposit,EUR,300,',
  '1,2026-02-08 10:41:13,Spot,Fiat Withdraw,EUR,-721,',
  // Dépôt et retrait crypto : transferts
  '1,2026-06-05 09:24:53,Spot,Deposit,BTC,0.00079747,',
  '1,2026-07-01 18:02:07,Spot,Withdraw,USDC,-234.793976,Withdraw fee is included',
  // Marge : ignorée
  '1,2026-01-19 02:02:51,Isolated Margin,Transaction Revenue,USDC,1042.6441,',
  '1,2026-01-19 02:02:51,Isolated Margin,Isolated Margin Loan,USDC,1000,',
  '1,2026-01-20 02:02:51,Cross Margin,Transaction Sold,EUR,-50,',
  // Frais BNB prélevés en Spot pour la marge (pas d'échange associé)
  '1,2026-02-12 05:45:04,Spot,BNB Fee Deduction,BNB,-0.0001,',
  '1,2026-02-12 06:45:04,Spot,BNB Fee Deduction,BNB,-0.0002,',
  // Binance Pay reçu : à compléter
  '1,2026-01-31 16:38:53,Funding,Transfer,USDC,109.6148551,Binance Pay - P_XXXX',
  // Achat par carte : montant en euros absent
  '1,2026-05-01 12:00:00,Spot,Buy Crypto With Fiat,BTC,0.001,',
  // Opération inconnue
  '1,2026-05-02 12:00:00,Spot,Mystery Bonus Program,XYZ,-5,',
  '1,2026-05-03 12:00:00,Spot,Totally New Feature,XYZ,5,',
];
const csv = [HEADER, ...rows].join('\n');
const FILE = 'Binance-Historique-des-transactions-202610031149UTC2-part1-of1.csv';

const report = () => parseBinanceLedger(parseCsv(csv), { fileName: FILE, offsetMinutes: 120 });
const find = (pred: (t: ReturnType<typeof report>['transactions'][number]) => boolean) => report().transactions.filter(pred);

describe('fuseau horaire', () => {
  it('lit le décalage dans le nom du fichier', () => {
    expect(offsetFromFileName(FILE)).toBe(120);
    expect(offsetFromFileName('export-UTC+5:30.csv')).toBe(330);
    expect(offsetFromFileName('export-UTC-3.csv')).toBe(-180);
    expect(offsetFromFileName('export.csv')).toBeNull();
  });

  it('convertit en heure de Paris, heure d’hiver et d’été', () => {
    expect(toParisTime('2026-01-31 15:28:41', 120)).toBe('2026-01-31T14:28:41');
    expect(toParisTime('2026-07-01 18:02:07', 120)).toBe('2026-07-01T18:02:07');
    expect(toParisTime('2026-12-31 23:30:00', 0)).toBe('2027-01-01T00:30:00');
  });
});

describe('import Binance', () => {
  it('reconnaît les en-têtes français et anglais', () => {
    expect(detectBinanceLedger(HEADER.split(','))).toBe('fr');
    expect(detectBinanceLedger(['User_ID', 'UTC_Time', 'Account', 'Operation', 'Coin', 'Change', 'Remark'])).toBe('en');
    expect(detectBinanceLedger(['Date', 'Montant'])).toBeNull();
  });

  it('achat EUR → USDC avec frais dans l’actif reçu', () => {
    const [tx] = find((t) => t.type === 'buy' && t.eur === '300');
    expect(tx).toMatchObject({ date: '2026-01-31T14:28:41', in: { asset: 'USDC', quantity: '355.44' }, fee: { asset: 'USDC', quantity: '0.337668' } });
  });

  it('vente exécutée en plusieurs fois : quantités additionnées', () => {
    const [tx] = find((t) => t.type === 'sell');
    expect(tx).toMatchObject({ out: { asset: 'USDC', quantity: '850.1311' }, eur: '721', fee: { asset: 'EUR', quantity: '0.68495' } });
  });

  it('échanges : ordre classique, robot Strategy, Convert, petits soldes', () => {
    const swaps = find((t) => t.type === 'swap').map((t) => `${t.out!.asset}>${t.in!.asset}`).sort();
    expect(swaps).toEqual(['ACE>USDC', 'HUMA>USDC', 'USDC>BNB', 'USDC>ETH']);
    const [convert] = find((t) => t.type === 'buy' && t.in?.asset === 'BNB');
    expect(convert).toMatchObject({ eur: '9.280477', in: { quantity: '0.0174481' } });
  });

  it('récompenses agrégées par jour', () => {
    const rewards = find((t) => t.type === 'reward');
    expect(rewards.map((r) => [r.in!.asset, r.in!.quantity, r.date])).toEqual([
      ['USDC', '0.00040894', '2026-01-01T23:59:59'],
      ['HUMA', '30', '2026-01-02T23:59:59'],
    ]);
  });

  it('dépôts et retraits crypto : transferts', () => {
    const transfers = find((t) => t.type === 'transfer' && !!t.moved);
    expect(transfers.map((t) => `${t.moved!.asset} ${t.moved!.quantity}`)).toEqual(['BTC 0.00079747', 'USDC 234.793976']);
  });

  it('frais BNB sans échange : un transfert par jour qui réduit le solde', () => {
    const [fees] = find((t) => t.type === 'transfer' && !t.moved);
    expect(fees.fee).toEqual({ asset: 'BNB', quantity: '0.0003' });
  });

  it('Binance Pay et achat par carte : importés, à compléter', () => {
    const r = report();
    const incomplete = r.transactions.filter((t) => validateTransaction(t).length > 0);
    expect(incomplete.map((t) => t.in?.asset).sort()).toEqual(['BTC', 'USDC']);
    expect(r.notes.join(' ')).toContain('2 transactions à compléter');
  });

  it('résumé des lignes ignorées', () => {
    const summary = Object.fromEntries(report().ignored.map((g) => [g.category === 'unknown' ? g.label : g.category, g.lines]));
    expect(summary).toEqual({
      margin: 3,
      euro: 2,
      internal: 1,
      'Opération non reconnue : Mystery Bonus Program (montant négatif)': 1,
      'Opération non reconnue : Totally New Feature': 1,
    });
  });

  it('identifiants stables : un second import du même fichier donne les mêmes', () => {
    const a = report().transactions.map((t) => t.id);
    const b = report().transactions.map((t) => t.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it('toutes les transactions complètes sont valides', () => {
    const r = report();
    const invalid = r.transactions.filter((t) => validateTransaction(t).length > 0 && !t.note?.includes('indiquez'));
    expect(invalid).toEqual([]);
    expect(r.period).toEqual({ from: '2026-01-01T06:37:49', to: '2026-07-01T18:02:07' });
  });

  it('100 000 lignes en quelques secondes', () => {
    const lines: string[] = [HEADER];
    for (let i = 0; i < 25_000; i++) {
      const d = new Date(Date.UTC(2025, 0, 1) + i * 60_000).toISOString().slice(0, 19).replace('T', ' ');
      lines.push(`1,${d},Spot,Transaction Spend,USDC,-10,`, `1,${d},Spot,Transaction Buy,ETH,0.004,`, `1,${d},Spot,Transaction Fee,ETH,-0.000004,`);
      lines.push(`1,${d},Isolated Margin,Transaction Fee,USDC,-0.01,`);
    }
    const start = performance.now();
    const r = parseBinanceLedger(parseCsv(lines.join('\n')), { fileName: 'big.csv', offsetMinutes: 0 });
    const elapsed = performance.now() - start;
    expect(r.lineCount).toBe(100_000);
    expect(r.transactions).toHaveLength(25_000);
    expect(elapsed).toBeLessThan(5000);
  });

  it('petits soldes annotés, marge en euros signalée', () => {
    const r = report();
    expect(r.transactions.filter((t) => t.note === 'Conversion de petits soldes')).toHaveLength(2);
    expect(r.notes.join(' ')).toContain("1 ligne de marge impliquent l'euro");
  });

  it('positions avant chaque vente : marge incluse, dette déduite, internes neutres', () => {
    const lines = [
      HEADER,
      '1,2026-01-01 10:00:00,Spot,Transaction Sold,EUR,-1000,',
      '1,2026-01-01 10:00:00,Spot,Transaction Revenue,USDC,1100,',
      // Earn : souscription sans contrepartie visible → neutre
      '1,2026-01-02 10:00:00,Spot,Simple Earn Flexible Subscription,USDC,-100,',
      // Passage en marge (deux côtés) puis emprunt et achat de SOL
      '1,2026-01-03 10:00:00,Spot,Inter-Wallet Transfer,USDC,-500,',
      '1,2026-01-03 10:00:00,Isolated Margin,Inter-Wallet Transfer,USDC,500,',
      '1,2026-01-03 11:00:00,Isolated Margin,Isolated Margin Loan,USDC,500,',
      '1,2026-01-03 11:01:00,Isolated Margin,Transaction Spend,USDC,-1000,',
      '1,2026-01-03 11:01:00,Isolated Margin,Transaction Buy,SOL,10,',
      // Vente d'USDC contre EUR depuis le Spot
      '1,2026-01-04 10:00:00,Spot,Transaction Spend,USDC,-200,',
      '1,2026-01-04 10:00:00,Spot,Transaction Buy,EUR,180,',
    ].join('\n');
    const r = parseBinanceLedger(parseCsv(lines), { fileName: 'h.csv', offsetMinutes: 0 });
    const [sell] = r.transactions.filter((t) => t.type === 'sell');
    // USDC : 1100 − 1000 (achat SOL) = 100 ; emprunt de 500 non compté (dette)
    expect(sell.holdings).toEqual({ SOL: '10', USDC: '100' });
  });

  it('fin d’historique : un actif vendu sur marge sort du suivi, un retrait vers un wallet reste détenu', () => {
    const lines = [
      HEADER,
      // Achat de SOL et d'ETH en Spot
      '1,2026-01-01 10:00:00,Spot,Transaction Sold,EUR,-1500,',
      '1,2026-01-01 10:00:00,Spot,Transaction Revenue,SOL,10,',
      '1,2026-01-01 10:01:00,Spot,Transaction Sold,EUR,-1000,',
      '1,2026-01-01 10:01:00,Spot,Transaction Revenue,ETH,0.5,',
      // SOL envoyé en marge et vendu là-bas contre USDC
      '1,2026-01-02 10:00:00,Spot,Inter-Wallet Transfer,SOL,-10,',
      '1,2026-01-02 10:00:00,Isolated Margin,Inter-Wallet Transfer,SOL,10,',
      '1,2026-01-02 11:00:00,Isolated Margin,Transaction Spend,SOL,-10,',
      '1,2026-01-02 11:00:00,Isolated Margin,Transaction Buy,USDC,1600,',
      // ETH retiré vers un wallet personnel
      '1,2026-01-03 10:00:00,Spot,Withdraw,ETH,-0.5,Withdraw fee is included',
    ].join('\n');
    const r = parseBinanceLedger(parseCsv(lines), { fileName: 'm.csv', offsetMinutes: 0 });
    const adjustments = r.transactions.filter(isBinanceAdjustment);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({ type: 'gift', date: '2026-01-02T23:59:59', out: { asset: 'SOL', quantity: '10' } });
    const positions = computePortfolio(r.transactions).positions;
    expect(positions.find((p) => p.asset === 'SOL')!.quantity.toString()).toBe('0');
    expect(positions.find((p) => p.asset === 'ETH')!.quantity.toString()).toBe('0.5');
    expect(r.notes.some((n) => n.includes('SOL'))).toBe(true);

    // Réimport identique : mêmes identifiants (aucun doublon).
    const again = parseBinanceLedger(parseCsv(lines), { fileName: 'm.csv', offsetMinutes: 0 });
    expect(again.transactions.filter(isBinanceAdjustment)[0].id).toBe(adjustments[0].id);
  });

  it('intérêts de marge : un remboursement supérieur à l’emprunt est une sortie réelle', () => {
    const lines = [
      HEADER,
      '1,2026-01-01 10:00:00,Spot,Transaction Sold,EUR,-1000,',
      '1,2026-01-01 10:00:00,Spot,Transaction Revenue,USDC,1000,',
      '1,2026-01-02 10:00:00,Spot,Inter-Wallet Transfer,USDC,-1000,',
      '1,2026-01-02 10:00:00,Isolated Margin,Inter-Wallet Transfer,USDC,1000,',
      '1,2026-01-02 11:00:00,Isolated Margin,Isolated Margin Loan,USDC,500,',
      // Remboursement de 510 : 500 de capital + 10 d'intérêts
      '1,2026-01-03 11:00:00,Isolated Margin,Isolated Margin Repayment,USDC,-510,',
      '1,2026-01-03 12:00:00,Isolated Margin,Inter-Wallet Transfer,USDC,-990,',
      '1,2026-01-03 12:00:00,Spot,Inter-Wallet Transfer,USDC,990,',
      '1,2026-01-04 10:00:00,Spot,Transaction Spend,USDC,-990,',
      '1,2026-01-04 10:00:00,Spot,Transaction Buy,EUR,900,',
    ].join('\n');
    const r = parseBinanceLedger(parseCsv(lines), { fileName: 'i.csv', offsetMinutes: 0 });
    const sell = r.transactions.find((t) => t.type === 'sell')!;
    expect(sell.holdings).toEqual({ USDC: '990' });
    // Les 10 USDC d'intérêts sortent du suivi : plus aucun USDC détenu.
    const usdc = computePortfolio(r.transactions).positions.find((p) => p.asset === 'USDC')!;
    expect(usdc.quantity.toString()).toBe('0');
  });

  it('paiement Binance Pay à compléter : pas de double sortie une fois complété', () => {
    const lines = [
      HEADER,
      '1,2026-01-01 10:00:00,Spot,Transaction Sold,EUR,-100,',
      '1,2026-01-01 10:00:00,Spot,Transaction Revenue,USDC,100,',
      '1,2026-01-02 10:00:00,Spot,Transfer,USDC,-20,Binance Pay - P_X',
    ].join('\n');
    const r = parseBinanceLedger(parseCsv(lines), { fileName: 'bp.csv', offsetMinutes: 0 });
    expect(r.transactions.filter(isBinanceAdjustment)).toHaveLength(0);
    const completed = r.transactions.map((t) => (t.type === 'payment' ? { ...t, eur: '18' } : t));
    expect(computePortfolio(completed).positions.find((p) => p.asset === 'USDC')!.quantity.toString()).toBe('80');
  });

  it('achat par carte : ligne en euros décalée d’une seconde rattachée', () => {
    const lines = [
      HEADER,
      '1,2025-04-12 08:25:41,Spot,Buy Crypto With Fiat,BNB,0.03769944,Via CashBalance',
      '1,2025-04-12 08:25:42,Spot,Buy Crypto With Fiat,EUR,-19.6,Via CashBalance',
    ].join('\n');
    const [tx] = parseBinanceLedger(parseCsv(lines), { fileName: 'c.csv', offsetMinutes: 0 }).transactions;
    expect(tx).toMatchObject({ type: 'buy', in: { asset: 'BNB', quantity: '0.03769944' }, eur: '19.6' });
  });

  it('pas d’ajustement quand le solde réel couvre le suivi', () => {
    const lines = [HEADER, '1,2026-01-01 10:00:00,Spot,Transaction Sold,EUR,-1500,', '1,2026-01-01 10:00:00,Spot,Transaction Revenue,SOL,10,'].join('\n');
    const r = parseBinanceLedger(parseCsv(lines), { fileName: 'n.csv', offsetMinutes: 0 });
    expect(r.transactions.filter(isBinanceAdjustment)).toHaveLength(0);
  });

  it('fusion de plusieurs exports : chevauchement et fuseaux différents', () => {
    const a = [HEADER, '1,2026-03-01 12:00:00,Spot,Simple Earn Flexible Interest,USDC,1,', '1,2026-03-02 12:00:00,Spot,Simple Earn Flexible Interest,USDC,2,'].join('\n');
    // Même période en UTC+0 (heure murale décalée de 2 h) + une ligne de plus
    const b = [HEADER, '1,2026-03-02 10:00:00,Spot,Simple Earn Flexible Interest,USDC,2,', '1,2026-03-03 10:00:00,Spot,Simple Earn Flexible Interest,USDC,3,'].join('\n');
    const merged = mergeBinanceTables([
      { table: parseCsv(a), offsetMinutes: 120 },
      { table: parseCsv(b), offsetMinutes: 0 },
    ]);
    expect(merged.rows.map((r) => r[1])).toEqual(['2026-03-01 10:00:00', '2026-03-02 10:00:00', '2026-03-03 10:00:00']);
    const r = parseBinanceLedger(merged, { fileName: 'x', offsetMinutes: 0 });
    expect(r.transactions.map((t) => t.in!.quantity)).toEqual(['1', '2', '3']);
  });

  it('deux lignes identiques dans un même fichier restent deux lignes', () => {
    const a = [HEADER, '1,2026-03-01 12:00:00,Spot,Distribution,ABC,1,', '1,2026-03-01 12:00:00,Spot,Distribution,ABC,1,'].join('\n');
    const merged = mergeBinanceTables([{ table: parseCsv(a), offsetMinutes: 0 }, { table: parseCsv(a), offsetMinutes: 0 }]);
    expect(merged.rows).toHaveLength(2);
  });
});
