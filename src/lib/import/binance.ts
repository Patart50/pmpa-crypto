/**
 * Import du journal Binance « Historique des transactions » (Transaction History).
 *
 * Le journal ne contient que des variations de solde, sans prix. On
 * reconstitue les opérations :
 * - ordres (Spot, Strategy) : lignes de même horodatage et même compte,
 *   solde net par actif → achat (EUR → crypto), vente (crypto → EUR) ou échange ;
 * - Binance Convert : deux lignes de signes opposés à quelques secondes d'écart ;
 * - conversion des petits soldes : une paire par remarque (« ACE to USDC ») ;
 * - récompenses (Earn, airdrops, bons…) : agrégées par jour, actif et type ;
 * - dépôts et retraits crypto : transferts (sans effet fiscal) ;
 * - mouvements en euros, transferts internes : ignorés ;
 * - marge et dérivés : ignorés et comptés (D-006) ;
 * - opérations inconnues : listées pour l'utilisateur.
 */
import { D, dec, ZERO, type Dec } from '../core/money';
import { EUR, type Transaction } from '../core/transactions';
import { computePortfolio } from '../core/portfolio';
import type { CsvTable } from './csv';
import { bump, stableId, toParisTime, type IgnoredGroup, type ImportReport } from './common';

const COLUMNS = {
  fr: { user: 'Identifiant utilisateur', time: 'Durée', account: 'Compte', op: 'Opération', coin: 'Jeton', change: 'Change', remark: 'Remarque' },
  en: { user: 'User_ID', time: 'UTC_Time', account: 'Account', op: 'Operation', coin: 'Coin', change: 'Change', remark: 'Remark' },
} as const;

type Lang = keyof typeof COLUMNS;

export function detectBinanceLedger(headers: string[]): Lang | null {
  for (const lang of Object.keys(COLUMNS) as Lang[]) {
    const c = COLUMNS[lang];
    if ([c.time, c.account, c.op, c.coin, c.change].every((h) => headers.includes(h))) return lang;
  }
  return null;
}

interface Line {
  index: number;
  wall: string;
  date: string;
  account: string;
  op: string;
  coin: string;
  change: Dec;
  remark: string;
  raw: string;
}

const TRADE_OPS = new Set([
  'Transaction Buy',
  'Transaction Spend',
  'Transaction Sold',
  'Transaction Revenue',
  'Transaction Fee',
  'Transaction Related',
  'BNB Fee Deduction',
]);
const FEE_OPS = new Set(['Transaction Fee', 'BNB Fee Deduction']);
const FIAT_BUY_OPS = new Set(['Buy Crypto With Fiat', 'Buy Crypto']);
const CONVERT_OPS = new Set(['Binance Convert']);
const DUST_OPS = /^small assets exchange bnb$/i;
export const DUST_NOTE = 'Conversion de petits soldes';
const REWARD = /(interest|reward|airdrop|distribution|voucher|rebate|kickback|commission|crypto box|megadrop|cashback|bonus|dividend)/i;
const INTERNAL = /(subscription|redemption|inter-wallet|transfer between|^transfer$|savings|staking purchase|main and funding|funding account|sub-account)/i;
/** Emprunts et remboursements de marge : ils changent la dette, pas l'avoir net. */
const DEBT_OPS = /(margin loan|repayment)/i;
const DERIVATIVE_ACCOUNTS = /(margin|futures|options|isolated|cross)/i;
const DERIVATIVE_OPS = /(margin|liquidation|futures|funding fee|realized profit)/i;

export interface BinanceOptions {
  fileName: string;
  /** Décalage horaire de l'export, en minutes (ex. 120 pour « UTC2 »). */
  offsetMinutes: number;
}

export function parseBinanceLedger(table: CsvTable, options: BinanceOptions): ImportReport {
  const lang = detectBinanceLedger(table.headers);
  if (!lang) throw new Error("Ce fichier n'est pas un journal des transactions Binance.");
  const c = COLUMNS[lang];
  const col = (name: string) => table.headers.indexOf(name);
  const idx = { time: col(c.time), account: col(c.account), op: col(c.op), coin: col(c.coin), change: col(c.change), remark: col(c.remark) };

  const ignored = new Map<string, IgnoredGroup>();
  const transactions: Transaction[] = [];
  const notes: string[] = [];
  const source = `binance:${options.fileName}`;
  let minDate = '';
  let maxDate = '';

  const tradeGroups = new Map<string, Line[]>();
  const fiatBuyGroups = new Map<string, Line[]>();
  const dustGroups = new Map<string, Line[]>();
  const converts: Line[] = [];
  const rewards = new Map<string, { date: string; coin: string; op: string; qty: Dec; keys: string[] }>();
  const feeOnly = new Map<string, { date: string; coin: string; qty: Dec; count: number; keys: string[] }>();
  let incomplete = 0;
  let marginEur = 0;
  /** Quantités sorties de Binance vers d'autres wallets (retraits − dépôts) : toujours détenues. */
  const sentAway = new Map<string, Dec>();

  const push = (tx: Omit<Transaction, 'platform' | 'source'>, wall?: string) => {
    transactions.push({ ...tx, platform: 'Binance', source });
    if (wall && (tx.type === 'sell' || tx.type === 'payment')) cessionWalls.set(tx.id, wall);
  };
  // Lignes qui modifient l'avoir net du compte (toutes sous-comptes confondus).
  const balanceLines: Line[] = [];
  const cessionWalls = new Map<string, string>();

  table.rows.forEach((row, index) => {
    const wall = row[idx.time] ?? '';
    const date = toParisTime(wall, options.offsetMinutes);
    let change: Dec;
    try {
      change = dec(row[idx.change] ?? '');
    } catch {
      change = new D(NaN);
    }
    const op = (row[idx.op] ?? '').trim();
    const line: Line = {
      index,
      wall,
      date: date ?? '',
      account: (row[idx.account] ?? '').trim(),
      op,
      coin: (row[idx.coin] ?? '').trim().toUpperCase(),
      change,
      remark: idx.remark >= 0 ? (row[idx.remark] ?? '').trim() : '',
      raw: [wall, row[idx.account], op, row[idx.coin], row[idx.change], idx.remark >= 0 ? row[idx.remark] : ''].join('|'),
    };

    if (!date || change.isNaN() || !line.coin) {
      bump(ignored, 'invalid', { category: 'invalid', label: 'Lignes illisibles (date, montant ou jeton)' }, `ligne ${index + 2}`);
      return;
    }
    // Avoir net : tout mouvement sauf déplacements internes et emprunts/remboursements de marge.
    const movesWithinBinance = INTERNAL.test(op) && !/binance pay/i.test(line.remark);
    if (line.coin !== EUR && !change.isZero() && !movesWithinBinance) balanceLines.push(line);

    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;

    if (DERIVATIVE_ACCOUNTS.test(line.account) || DERIVATIVE_OPS.test(op)) {
      if (line.coin === EUR) marginEur++;
      bump(ignored, 'margin', { category: 'margin', label: 'Marge et dérivés (non pris en compte, à traiter à part)' }, op);
      return;
    }
    if (change.isZero()) {
      bump(ignored, 'zero', { category: 'zero', label: 'Mouvements nuls' }, op);
      return;
    }
    if (TRADE_OPS.has(op)) {
      const key = `${wall}|${line.account}`;
      (tradeGroups.get(key) ?? tradeGroups.set(key, []).get(key)!).push(line);
      return;
    }
    if (FIAT_BUY_OPS.has(op)) {
      const key = `${wall}|${line.account}`;
      (fiatBuyGroups.get(key) ?? fiatBuyGroups.set(key, []).get(key)!).push(line);
      return;
    }
    if (CONVERT_OPS.has(op)) {
      converts.push(line);
      return;
    }
    if (DUST_OPS.test(op)) {
      const key = `${wall}|${line.remark}`;
      (dustGroups.get(key) ?? dustGroups.set(key, []).get(key)!).push(line);
      return;
    }
    if (op === 'Deposit' || op === 'Withdraw' || op === 'Fiat Deposit' || op === 'Fiat Withdraw') {
      if (line.coin === EUR || op.startsWith('Fiat')) {
        bump(ignored, 'euro', { category: 'euro', label: 'Dépôts et retraits en euros (sans effet sur le calcul)' }, op);
        return;
      }
      const deposit = op === 'Deposit';
      sentAway.set(line.coin, (sentAway.get(line.coin) ?? ZERO).minus(change));
      push({
        id: stableId('bn', line.raw),
        date,
        type: 'transfer',
        moved: { asset: line.coin, quantity: change.abs().toString() },
        note: deposit
          ? 'Dépôt sur Binance depuis un autre compte ou wallet'
          : `Retrait depuis Binance vers un autre compte ou wallet${line.remark ? ` (${line.remark})` : ''}`,
      });
      return;
    }
    if (/binance pay/i.test(line.remark) && /transfer/i.test(op)) {
      incomplete++;
      if (change.gt(0)) {
        push({
          id: stableId('bn', line.raw),
          date,
          type: 'buy',
          in: { asset: line.coin, quantity: change.toString() },
          note: 'Reçu via Binance Pay : indiquez sa valeur en euros, ou supprimez cette ligne si l’envoi venait de vous.',
        });
      } else {
        push({
          id: stableId('bn', line.raw),
          date,
          type: 'payment',
          out: { asset: line.coin, quantity: change.abs().toString() },
          note: 'Envoyé via Binance Pay : paiement d’un achat → indiquez sa valeur ; envoi à un proche → type « Don » ; vers votre propre compte → type « Transfert ».',
        }, line.wall);
      }
      return;
    }
    if (REWARD.test(op) && !/subscription|redemption/i.test(op)) {
      if (change.lt(0)) {
        bump(ignored, `unknown:${op}`, { category: 'unknown', label: `Opération non reconnue : ${op} (montant négatif)` }, line.wall);
        return;
      }
      const day = date.slice(0, 10);
      const key = `${day}|${line.coin}|${op}`;
      const r = rewards.get(key);
      if (r) {
        r.qty = r.qty.plus(change);
        r.keys.push(line.raw);
      } else rewards.set(key, { date: `${day}T23:59:59`, coin: line.coin, op, qty: change, keys: [line.raw] });
      return;
    }
    if (INTERNAL.test(op)) {
      bump(ignored, 'internal', { category: 'internal', label: 'Transferts internes à Binance (Earn, Spot, Funding…)' }, op);
      return;
    }
    bump(ignored, `unknown:${op}`, { category: 'unknown', label: `Opération non reconnue : ${op}` }, line.wall);
  });

  // --- Résolution d'un groupe de lignes en une transaction -----------------
  const addFeeOnly = (date: string, coin: string, qty: Dec, key: string) => {
    const day = date.slice(0, 10);
    const k = `${day}|${coin}`;
    const f = feeOnly.get(k);
    if (f) {
      f.qty = f.qty.plus(qty);
      f.count++;
      f.keys.push(key);
    } else feeOnly.set(k, { date: `${day}T23:59:59`, coin, qty, count: 1, keys: [key] });
  };

  const resolve = (lines: Line[], label: string, fiatBuy = false, note?: string): void => {
    const net = new Map<string, Dec>();
    const fees = new Map<string, Dec>();
    for (const l of lines) {
      if (FEE_OPS.has(l.op) && l.change.lt(0)) fees.set(l.coin, (fees.get(l.coin) ?? ZERO).plus(l.change.abs()));
      else net.set(l.coin, (net.get(l.coin) ?? ZERO).plus(l.change));
    }
    const ins = [...net].filter(([, q]) => q.gt(0));
    const outs = [...net].filter(([, q]) => q.lt(0));
    const first = lines[0];
    const key = lines.map((l) => l.raw).join('\n');
    const id = stableId('bn', key);
    const feeList = [...fees];

    if (ins.length === 0 && outs.length === 0) {
      if (feeList.length === 0) {
        bump(ignored, 'zero', { category: 'zero', label: 'Mouvements nuls' }, label);
        return;
      }
      for (const [coin, qty] of feeList) addFeeOnly(first.date, coin, qty, key);
      return;
    }

    const [mainFee, ...extraFees] = feeList;
    for (const [coin, qty] of extraFees) addFeeOnly(first.date, coin, qty, `${key}#${coin}`);
    const fee = mainFee ? { asset: mainFee[0], quantity: mainFee[1].toString() } : undefined;

    if (ins.length === 1 && outs.length === 1) {
      const [inCoin, inQty] = ins[0];
      const [outCoin, outQty] = outs[0];
      if (inCoin === EUR) {
        push({ id, date: first.date, type: 'sell', out: { asset: outCoin, quantity: outQty.abs().toString() }, eur: inQty.toString(), fee }, first.wall);
      } else if (outCoin === EUR) {
        push({ id, date: first.date, type: 'buy', in: { asset: inCoin, quantity: inQty.toString() }, eur: outQty.abs().toString(), fee });
      } else {
        push({
          id,
          date: first.date,
          type: 'swap',
          out: { asset: outCoin, quantity: outQty.abs().toString() },
          in: { asset: inCoin, quantity: inQty.toString() },
          fee,
          ...(note ? { note } : {}),
        });
      }
      return;
    }
    if (fiatBuy && ins.length === 1 && outs.length === 0) {
      incomplete++;
      push({
        id,
        date: first.date,
        type: 'buy',
        in: { asset: ins[0][0], quantity: ins[0][1].toString() },
        fee,
        note: 'Achat par carte : le montant payé en euros n’est pas dans l’export Binance, indiquez-le.',
      });
      return;
    }
    bump(
      ignored,
      'ambiguous',
      { category: 'ambiguous', label: 'Opérations impossibles à reconstituer (plusieurs paires dans la même seconde)' },
      `${label} ${first.wall}`,
    );
  };

  for (const lines of tradeGroups.values()) resolve(lines, 'Ordre');
  // Achat par carte : la ligne en euros arrive parfois une seconde après la
  // crypto. On regroupe les lignes d'un même compte espacées de 5 s au plus.
  const seconds = (wall: string) => Date.parse(wall.replace(' ', 'T') + 'Z') / 1000;
  const fiatLines = [...fiatBuyGroups.values()].flat().sort((a, b) => (a.wall < b.wall ? -1 : a.wall > b.wall ? 1 : a.index - b.index));
  let cluster: Line[] = [];
  for (const line of fiatLines) {
    const last = cluster[cluster.length - 1];
    if (last && (last.account !== line.account || seconds(line.wall) - seconds(last.wall) > 5)) {
      resolve(cluster, 'Achat par carte', true);
      cluster = [];
    }
    cluster.push(line);
  }
  if (cluster.length > 0) resolve(cluster, 'Achat par carte', true);
  for (const lines of dustGroups.values()) resolve(lines, 'Petits soldes', false, DUST_NOTE);

  // Binance Convert : apparier les lignes de signes opposés à ≤ 5 s d'écart.
  const pending: Line[] = [];
  for (const line of [...converts].sort((a, b) => (a.wall < b.wall ? -1 : a.wall > b.wall ? 1 : a.index - b.index))) {
    const matchIndex = pending.findIndex(
      (p) => p.account === line.account && p.change.isNegative() !== line.change.isNegative() && Math.abs(seconds(p.wall) - seconds(line.wall)) <= 5,
    );
    if (matchIndex >= 0) {
      const [match] = pending.splice(matchIndex, 1);
      resolve([match, line], 'Convert');
    } else {
      pending.push(line);
    }
    // Purge des lignes trop anciennes.
    for (let i = pending.length - 1; i >= 0; i--) {
      if (seconds(line.wall) - seconds(pending[i].wall) > 5) {
        const [stale] = pending.splice(i, 1);
        bump(ignored, 'ambiguous', { category: 'ambiguous', label: 'Opérations impossibles à reconstituer (plusieurs paires dans la même seconde)' }, `Convert ${stale.wall}`);
      }
    }
  }
  for (const stale of pending) {
    bump(ignored, 'ambiguous', { category: 'ambiguous', label: 'Opérations impossibles à reconstituer (plusieurs paires dans la même seconde)' }, `Convert ${stale.wall}`);
  }

  for (const r of rewards.values()) {
    push({
      id: stableId('bn', r.keys.join('\n')),
      date: r.date,
      type: 'reward',
      in: { asset: r.coin, quantity: r.qty.toString() },
      note: r.keys.length > 1 ? `${r.op} (${r.keys.length} versements du jour)` : r.op,
    });
  }

  for (const f of feeOnly.values()) {
    push({
      id: stableId('bn', f.keys.join('\n')),
      date: f.date,
      type: 'transfer',
      fee: { asset: f.coin, quantity: f.qty.toString() },
      note: `Frais prélevés sans échange associé, souvent liés à la marge (${f.count} prélèvement${f.count > 1 ? 's' : ''} du jour)`,
    });
  }

  const netLines = netWorthLines(balanceLines);
  attachHoldings(transactions, cessionWalls, netLines);
  transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const adjustments = reconcileBalances(transactions, netLines, sentAway, maxDate);
  transactions.push(...adjustments);

  if (incomplete > 0) {
    notes.push(
      `${incomplete} transaction${incomplete > 1 ? 's' : ''} à compléter (montant en euros absent de l'export) : elles sont signalées dans la liste.`,
    );
  }

  if (adjustments.length > 0) {
    notes.push(
      `${adjustments.length} actif${adjustments.length > 1 ? 's' : ''} absent${adjustments.length > 1 ? 's' : ''} du compte Binance en fin d'historique (${adjustments
        .map((a) => a.out!.asset)
        .join(', ')}) : sortis via la marge ou historique incomplet. Ils sont retirés du suivi par un ajustement, sans effet fiscal.`,
    );
  }

  if (marginEur > 0) {
    notes.push(
      `${marginEur} ligne${marginEur > 1 ? 's' : ''} de marge impliquent l'euro : des ventes imposables peuvent s'y trouver. Elles ne sont pas prises en compte, vérifiez-les à part.`,
    );
  }

  return {
    format: 'Binance — historique des transactions',
    fileName: options.fileName,
    lineCount: table.rows.length,
    transactions,
    ignored: [...ignored.values()].sort((a, b) => b.lines - a.lines),
    notes,
    period: minDate ? { from: minDate, to: maxDate } : undefined,
  };
}

/**
 * Mouvements de l'avoir net, triés : un emprunt de marge n'enrichit pas (il
 * crée une dette), le remboursement du capital n'appauvrit pas. Seule la part
 * d'un remboursement qui dépasse la dette en cours (intérêts, frais de
 * liquidation) est une vraie sortie (D-037). Neutraliser tous les
 * remboursements comptait ces intérêts comme encore détenus.
 */
function netWorthLines(lines: Line[]): Line[] {
  const sorted = [...lines].sort((a, b) => (a.wall < b.wall ? -1 : a.wall > b.wall ? 1 : a.index - b.index));
  const debt = new Map<string, Dec>();
  const out: Line[] = [];
  for (const l of sorted) {
    if (!DEBT_OPS.test(l.op)) {
      out.push(l);
      continue;
    }
    const owed = debt.get(l.coin) ?? ZERO;
    if (l.change.gt(0)) {
      debt.set(l.coin, owed.plus(l.change)); // emprunt
      continue;
    }
    const paid = l.change.abs();
    const principal = D.min(paid, owed);
    debt.set(l.coin, owed.minus(principal));
    const extra = paid.minus(principal);
    if (extra.gt(0)) out.push({ ...l, change: extra.negated() });
  }
  return out;
}

/**
 * Joint à chaque cession les quantités détenues juste avant, sur tout le
 * compte Binance (Spot, Earn, Funding, marge), dette de marge déduite.
 * Les soldes négatifs (historique incomplet) sont ramenés à zéro.
 * Les intérêts d'emprunt (remboursement supérieur à la dette) sont déduits.
 */
function attachHoldings(transactions: Transaction[], cessionWalls: Map<string, string>, lines: Line[]): void {
  if (cessionWalls.size === 0) return;
  const sortedLines = [...lines].sort((a, b) => (a.wall < b.wall ? -1 : a.wall > b.wall ? 1 : a.index - b.index));
  const cessions = [...cessionWalls].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const byId = new Map(transactions.map((t) => [t.id, t]));
  const balances = new Map<string, Dec>();
  let i = 0;
  for (const [id, wall] of cessions) {
    while (i < sortedLines.length && sortedLines[i].wall < wall) {
      const l = sortedLines[i++];
      balances.set(l.coin, (balances.get(l.coin) ?? ZERO).plus(l.change));
    }
    const holdings: Record<string, string> = {};
    for (const [coin, qty] of [...balances].sort(([a], [b]) => a.localeCompare(b))) {
      if (qty.gt(0)) holdings[coin] = qty.toString();
    }
    const tx = byId.get(id);
    if (tx && Object.keys(holdings).length > 0) tx.holdings = holdings;
  }
}

export const ADJUSTMENT_PREFIX = 'bnadj';
export const ADJUSTMENT_NOTE = 'Ajustement : absent du compte Binance en fin d’historique';

/** Ajustement de solde Binance généré à l'import (remplacé à chaque nouvel import Binance). */
export const isBinanceAdjustment = (tx: Pick<Transaction, 'id'>) => tx.id.startsWith(`${ADJUSTMENT_PREFIX}-`);

/**
 * Rapproche le suivi par actif du solde réel du compte Binance en fin
 * d'historique (marge comprise, dette déduite). Les virements vers la marge
 * étant ignorés, un actif vendu sur marge resterait « détenu » dans le suivi.
 * Pour chaque actif dont le suivi dépasse le solde réel + les quantités
 * retirées vers d'autres wallets, l'excédent sort du suivi par une « sortie
 * sans contrepartie » (aucun effet fiscal, D-029). Le cas inverse (solde
 * réel supérieur) n'est pas ajusté : le coût d'acquisition serait inconnu.
 */
function reconcileBalances(transactions: Transaction[], lines: Line[], sentAway: Map<string, Dec>, lastDate: string): Transaction[] {
  if (!lastDate || transactions.length === 0) return [];
  const actual = new Map<string, Dec>();
  /** Jour du dernier mouvement de chaque actif : c'est là qu'il a quitté le compte. */
  const lastDay = new Map<string, string>();
  for (const l of lines) {
    actual.set(l.coin, (actual.get(l.coin) ?? ZERO).plus(l.change));
    const day = l.date.slice(0, 10);
    if (day > (lastDay.get(l.coin) ?? '')) lastDay.set(l.coin, day);
  }
  const out: Transaction[] = [];
  // Les achats et paiements à compléter (montant en euros absent) comptent
  // déjà en quantité : sinon, une fois complétés, ils retireraient une
  // seconde fois ce que l'ajustement a déjà sorti.
  const asComplete = transactions.map((t) => ((t.type === 'buy' || t.type === 'payment') && t.eur === undefined ? { ...t, eur: '1' } : t)); // montant fictif : seules les quantités comptent ici
  for (const p of computePortfolio(asComplete).positions) {
    if (p.quantity.lte(0)) continue;
    const real = D.max(actual.get(p.asset) ?? ZERO, ZERO);
    const expected = real.plus(D.max(sentAway.get(p.asset) ?? ZERO, ZERO));
    const excess = p.quantity.minus(expected);
    // Tolérance : arrondis de Binance (dernier chiffre des quantités).
    if (excess.lte(p.quantity.times('1e-6'))) continue;
    const quantity = excess.gt(p.quantity) ? p.quantity : excess;
    const date = `${lastDay.get(p.asset) ?? lastDate.slice(0, 10)}T23:59:59`;
    out.push({
      id: stableId(ADJUSTMENT_PREFIX, `${p.asset}|${quantity.toString()}|${date}`),
      date,
      type: 'gift',
      out: { asset: p.asset, quantity: quantity.toString() },
      platform: 'Binance',
      note: `${ADJUSTMENT_NOTE} (vendu sur marge ou historique incomplet), daté de son dernier mouvement. Retiré du suivi, sans effet fiscal.`,
    });
  }
  return out;
}

/** Décale une heure « murale » de N minutes (format AAAA-MM-JJ HH:mm:ss). */
function shiftWall(wall: string, minutes: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(wall.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) + minutes * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/**
 * Fusionne plusieurs exports Binance (périodes successives ou qui se
 * chevauchent, fuseaux éventuellement différents) en un seul journal en UTC.
 * Une ligne présente dans plusieurs fichiers n'est gardée qu'une fois
 * (multiplicité maximale observée dans un même fichier).
 */
export function mergeBinanceTables(files: { table: CsvTable; offsetMinutes: number }[]): CsvTable {
  const fr = COLUMNS.fr;
  const headers = [fr.user, fr.time, fr.account, fr.op, fr.coin, fr.change, fr.remark];
  const kept = new Map<string, { row: string[]; count: number }>();
  for (const { table, offsetMinutes } of files) {
    const lang = detectBinanceLedger(table.headers);
    if (!lang) continue;
    const c = COLUMNS[lang];
    const at = (name: string) => table.headers.indexOf(name);
    const idx = [at(c.time), at(c.account), at(c.op), at(c.coin), at(c.change), at(c.remark)];
    const counts = new Map<string, number>();
    for (const row of table.rows) {
      const wall = shiftWall(row[idx[0]] ?? '', -offsetMinutes);
      if (!wall) continue;
      const normalized = ['', wall, ...idx.slice(1).map((i) => (i >= 0 ? (row[i] ?? '').trim() : ''))];
      const key = normalized.slice(1).join('|');
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      const k = `${key}#${n}`;
      if (!kept.has(k)) kept.set(k, { row: normalized, count: n });
    }
  }
  const rows = [...kept.values()].map((v) => v.row).sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return { headers, rows, delimiter: ',' };
}
