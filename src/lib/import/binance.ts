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
const REWARD = /(interest|reward|airdrop|distribution|voucher|rebate|kickback|commission|crypto box|megadrop|cashback|bonus|dividend)/i;
const INTERNAL = /(subscription|redemption|inter-wallet|transfer between|^transfer$|savings|staking purchase|main and funding|funding account|sub-account)/i;
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

  const push = (tx: Omit<Transaction, 'platform' | 'source'>) => transactions.push({ ...tx, platform: 'Binance', source });

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
    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;

    if (DERIVATIVE_ACCOUNTS.test(line.account) || DERIVATIVE_OPS.test(op)) {
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
          note: 'Envoyé via Binance Pay : si c’est un paiement, indiquez la valeur du bien ou service ; sinon changez le type en transfert.',
        });
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

  const resolve = (lines: Line[], label: string, fiatBuy = false): void => {
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
        push({ id, date: first.date, type: 'sell', out: { asset: outCoin, quantity: outQty.abs().toString() }, eur: inQty.toString(), fee });
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
  for (const lines of fiatBuyGroups.values()) resolve(lines, 'Achat par carte', true);
  for (const lines of dustGroups.values()) resolve(lines, 'Petits soldes');

  // Binance Convert : apparier les lignes de signes opposés à ≤ 5 s d'écart.
  const seconds = (wall: string) => Date.parse(wall.replace(' ', 'T') + 'Z') / 1000;
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

  transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (incomplete > 0) {
    notes.push(
      `${incomplete} transaction${incomplete > 1 ? 's' : ''} à compléter (montant en euros absent de l'export) : elles sont signalées dans la liste.`,
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
