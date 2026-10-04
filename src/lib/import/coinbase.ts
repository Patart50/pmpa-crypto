/**
 * Import de l'historique des transactions Coinbase (« Transaction history »,
 * CSV). Colonnes : ID, Timestamp (UTC), Transaction Type, Asset, Quantity
 * Transacted, Price Currency, Price at Transaction, Subtotal, Total
 * (inclusive of fees and/or spread), Fees and/or Spread, Notes, Sender
 * Address, Recipient Address. Le fichier commence souvent par quelques
 * lignes d'identification, sautées par la détection de l'en-tête.
 *
 * Particularités (D-048) :
 * - Advanced Trade Buy/Sell : une seule ligne par ordre, la contrepartie
 *   n'est que dans la note (« Sold 0.48 AVAX for 11.04 USDC on AVAX-USDC ») ;
 * - Convert : deux lignes, une par côté, même note ;
 * - montants en devise du compte (souvent USD) : convertis en euros (D-047).
 */
import { dec, ZERO, type Dec } from '../core/money';
import { EUR, type Transaction } from '../core/transactions';
import type { CsvTable } from './csv';
import { bump, stableId, utcToParis, type FxAmount, type IgnoredGroup, type ImportReport } from './common';

const REQUIRED = ['Timestamp', 'Transaction Type', 'Asset', 'Quantity Transacted'];

export function detectCoinbase(headers: string[]): boolean {
  return REQUIRED.every((h) => headers.includes(h));
}

const FIAT = new Set(['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD']);
const REWARDS = /^(staking income|learning reward|incentives rewards payout|subscription rebates.*|coinbase earn|rewards income|inflation reward|interest|airdrop|coinbase one rewards|reward)$/i;
const INTERNAL = /^(retail staking transfer|retail unstaking transfer|retail eth2 deprecation|pro withdrawal|pro deposit|exchange deposit|exchange withdrawal)$/i;
const FIAT_MOVES = /^(deposit|withdrawal|fiat deposit|fiat withdrawal)$/i;

/** « $1,234.56 », « -$0.01 », « €12 » → « 1234.56 » (valeur absolue). */
function money(raw: string | undefined): Dec | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.\-]/g, '').replace(/^-/, '');
  if (!cleaned) return null;
  try {
    return dec(cleaned);
  } catch {
    return null;
  }
}

const TRADE_NOTE = /^(Bought|Sold)\s+([\d.]+)\s+(\S+)\s+for\s+([\d.]+)\s+(\S+)/i;
const CONVERT_NOTE = /^Converted\s+([\d.]+)\s+(\S+)\s+to\s+([\d.]+)\s+(\S+)/i;

export function parseCoinbase(table: CsvTable, fileName: string): ImportReport {
  if (!detectCoinbase(table.headers)) throw new Error("Ce fichier n'est pas un historique des transactions Coinbase.");
  const col = (name: string) => table.headers.indexOf(name);
  const idx = {
    time: col('Timestamp'),
    type: col('Transaction Type'),
    asset: col('Asset'),
    qty: col('Quantity Transacted'),
    currency: col('Price Currency'),
    subtotal: col('Subtotal'),
    total: col('Total (inclusive of fees and/or spread)'),
    fees: col('Fees and/or Spread'),
    notes: col('Notes'),
  };
  const source = `coinbase:${fileName}`;
  const ignored = new Map<string, IgnoredGroup>();
  const transactions: Transaction[] = [];
  const fx: FxAmount[] = [];
  const currencies = new Set<string>();
  let minDate = '';
  let maxDate = '';
  const seenConverts = new Set<string>();
  const wraps = new Map<string, { date: string; lines: { asset: string; qty: Dec }[]; raw: string[] }>();
  let incomplete = 0;

  const push = (tx: Omit<Transaction, 'platform' | 'source'>) => transactions.push({ ...tx, platform: 'Coinbase', source });
  /** Montant en devise : direct en euros, sinon différé pour conversion. */
  const amount = (txId: string, field: 'eur' | 'fee', value: Dec, currency: string, date: string): string | undefined => {
    if (value.isZero()) return undefined;
    if (currency === EUR) return value.toString();
    fx.push({ txId, field, amount: value.toString(), currency, date });
    return undefined;
  };

  const occurrences = new Map<string, number>();
  table.rows.forEach((row, index) => {
    // Lignes strictement identiques (ordres fractionnés dans la même seconde) : numérotées pour rester distinctes.
    const line = row.join('|');
    const n = (occurrences.get(line) ?? 0) + 1;
    occurrences.set(line, n);
    const raw = n > 1 ? `${line}#${n}` : line;
    const date = utcToParis(row[idx.time] ?? '');
    const type = (row[idx.type] ?? '').trim();
    const asset = (row[idx.asset] ?? '').trim().toUpperCase();
    let qty: Dec;
    try {
      qty = dec((row[idx.qty] ?? '').trim());
    } catch {
      qty = dec(NaN);
    }
    const currency = ((idx.currency >= 0 ? row[idx.currency] : '') || 'USD').trim().toUpperCase();
    const note = (idx.notes >= 0 ? row[idx.notes] : '')?.trim() ?? '';
    if (!date || !type || !asset || qty.isNaN()) {
      if (row.some((c) => c.trim())) bump(ignored, 'invalid', { category: 'invalid', label: 'Lignes illisibles (date, montant ou actif)' }, `ligne ${index + 2}`);
      return;
    }
    currencies.add(currency);
    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;
    const id = stableId('cb', raw);
    const abs = qty.abs();
    const fee = money(row[idx.fees]) ?? ZERO;

    if (/^advanced trade (buy|sell)$|^buy$|^sell$/i.test(type)) {
      const m = TRADE_NOTE.exec(note);
      const bought = /buy/i.test(type);
      // Contrepartie : lue dans la note ; à défaut (achat ou vente simple), le total en devise du compte.
      const other = m ? { qty: dec(m[4]), asset: m[5].toUpperCase() } : { qty: money(row[idx.total]) ?? ZERO, asset: currency };
      if (FIAT.has(other.asset)) {
        // Le total de la note inclut les frais (achat) ou en est net (vente). Frais séparés quand ils sont dans la même devise.
        const feeHere = currency === other.asset ? fee : ZERO;
        if (bought) {
          const tx: Omit<Transaction, 'platform' | 'source'> = { id, date, type: 'buy', in: { asset, quantity: abs.toString() } };
          tx.eur = amount(id, 'eur', other.qty.minus(feeHere), other.asset, date);
          const f = amount(id, 'fee', feeHere, other.asset, date);
          if (f) tx.fee = { asset: EUR, quantity: f };
          push(tx);
        } else {
          const tx: Omit<Transaction, 'platform' | 'source'> = { id, date, type: 'sell', out: { asset, quantity: abs.toString() } };
          tx.eur = amount(id, 'eur', other.qty.plus(m ? feeHere : ZERO), other.asset, date);
          const f = amount(id, 'fee', feeHere, other.asset, date);
          if (f) tx.fee = { asset: EUR, quantity: f };
          push(tx);
        }
        return;
      }
      push(
        bought
          ? { id, date, type: 'swap', out: { asset: other.asset, quantity: other.qty.toString() }, in: { asset, quantity: abs.toString() } }
          : { id, date, type: 'swap', out: { asset, quantity: abs.toString() }, in: { asset: other.asset, quantity: other.qty.toString() } },
      );
      return;
    }

    if (/^convert$/i.test(type)) {
      const m = CONVERT_NOTE.exec(note);
      if (!m) {
        bump(ignored, 'ambiguous', { category: 'ambiguous', label: 'Conversions sans note lisible' }, row[idx.time] ?? '');
        return;
      }
      const key = `${note}|${(row[idx.time] ?? '').slice(0, 16)}`;
      if (seenConverts.has(key)) return; // second côté de la même conversion
      seenConverts.add(key);
      const [, outQty, outAsset, inQty, inAsset] = m;
      const out = outAsset.toUpperCase();
      const into = inAsset.toUpperCase();
      const cid = stableId('cb', key);
      if (FIAT.has(out)) {
        const tx: Omit<Transaction, 'platform' | 'source'> = { id: cid, date, type: 'buy', in: { asset: into, quantity: inQty } };
        tx.eur = amount(cid, 'eur', dec(outQty), out, date);
        push(tx);
      } else if (FIAT.has(into)) {
        const tx: Omit<Transaction, 'platform' | 'source'> = { id: cid, date, type: 'sell', out: { asset: out, quantity: outQty } };
        tx.eur = amount(cid, 'eur', dec(inQty), into, date);
        push(tx);
      } else {
        push({ id: cid, date, type: 'swap', out: { asset: out, quantity: outQty }, in: { asset: into, quantity: inQty } });
      }
      return;
    }

    if (/^wrap asset$|^unwrap asset$/i.test(type)) {
      const key = row[idx.time] ?? '';
      const w = wraps.get(key) ?? { date, lines: [], raw: [] };
      w.lines.push({ asset, qty });
      w.raw.push(raw);
      wraps.set(key, w);
      return;
    }

    if (REWARDS.test(type)) {
      if (qty.lte(0)) return;
      push({ id, date, type: /airdrop/i.test(type) ? 'airdrop' : 'reward', in: { asset, quantity: abs.toString() }, note: type });
      return;
    }

    if (/^send$|^receive$/i.test(type)) {
      const incoming = qty.gt(0);
      push({
        id,
        date,
        type: 'transfer',
        direction: incoming ? 'in' : 'out',
        moved: { asset, quantity: abs.toString() },
        note: incoming ? 'Reçu sur Coinbase depuis un autre compte ou wallet' : 'Envoyé depuis Coinbase vers un autre compte ou wallet',
      });
      return;
    }

    if (INTERNAL.test(type)) {
      bump(ignored, 'internal', { category: 'internal', label: 'Mouvements internes à Coinbase (staking, comptes)' }, type);
      return;
    }
    if (FIAT_MOVES.test(type) || FIAT.has(asset)) {
      bump(ignored, 'euro', { category: 'euro', label: 'Dépôts et retraits en monnaie (sans effet sur le calcul)' }, type);
      return;
    }
    bump(ignored, `unknown:${type}`, { category: 'unknown', label: `Opération non reconnue : ${type}` }, row[idx.time] ?? '');
  });

  for (const w of wraps.values()) {
    const out = w.lines.find((l) => l.qty.lt(0));
    const into = w.lines.find((l) => l.qty.gt(0));
    if (!out || !into || w.lines.length !== 2) {
      bump(ignored, 'ambiguous', { category: 'ambiguous', label: 'Emballages (wrap) incomplets' }, w.date);
      continue;
    }
    push({
      id: stableId('cb', w.raw.join('\n')),
      date: w.date,
      type: 'swap',
      out: { asset: out.asset, quantity: out.qty.abs().toString() },
      in: { asset: into.asset, quantity: into.qty.toString() },
      note: 'Emballage (wrap)',
    });
  }

  transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const notes: string[] = [];
  const foreign = [...currencies].filter((c) => c !== EUR);
  if (fx.length > 0) {
    notes.push(
      `${fx.length} montant${fx.length > 1 ? 's' : ''} en ${foreign.join(', ')} : convertis en euros au cours Binance de la minute au moment de l'import.`,
    );
  }
  if (incomplete > 0) notes.push(`${incomplete} transaction${incomplete > 1 ? 's' : ''} à compléter.`);
  return {
    format: 'Coinbase — historique des transactions',
    fileName,
    lineCount: table.rows.length,
    transactions,
    ignored: [...ignored.values()].sort((a, b) => b.lines - a.lines),
    notes,
    period: minDate ? { from: minDate, to: maxDate } : undefined,
    currency: currencies.size === 1 ? [...currencies][0] : foreign[0] ?? EUR,
    fx,
  };
}
