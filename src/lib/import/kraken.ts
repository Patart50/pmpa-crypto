/**
 * Import du grand livre Kraken (« Ledgers », CSV). Colonnes : txid, refid,
 * time (UTC), type, subtype, aclass, subclass, asset, wallet, amount, fee,
 * balance, puis selon la version amountusd, feeusd, balanceusd, feecurrency.
 *
 * ⚠️ Écrit d'après le format publié par Kraken, non vérifié sur un historique
 * réel (D-049) : à confirmer dès qu'un utilisateur fournit un export anonymisé.
 *
 * - Une opération (trade, achat instantané, conversion) = plusieurs lignes de
 *   même refid, une par actif ; le solde réel est amount − fee.
 * - Codes historiques : XXBT → BTC, ZEUR → EUR… ; suffixes de staking ou
 *   d'Earn (.S, .M, .F, .B, .P) ramenés à l'actif de base.
 * - Allocations Earn, passages Spot ↔ staking : mouvements internes ignorés.
 */
import { dec, ZERO, type Dec } from '../core/money';
import { EUR, type Transaction } from '../core/transactions';
import type { CsvTable } from './csv';
import { bump, stableId, utcToParis, type FxAmount, type IgnoredGroup, type ImportReport } from './common';

const REQUIRED = ['txid', 'refid', 'time', 'type', 'asset', 'amount', 'fee'];

export function detectKrakenLedger(headers: string[]): boolean {
  const h = headers.map((x) => x.trim().toLowerCase());
  return REQUIRED.every((c) => h.includes(c)) && !h.includes('ordertxid');
}

const LEGACY: Record<string, string> = {
  XXBT: 'BTC', XBT: 'BTC', XBTC: 'BTC', XETH: 'ETH', XXDG: 'DOGE', XDG: 'DOGE', XXRP: 'XRP', XLTC: 'LTC', XXLM: 'XLM',
  XETC: 'ETC', XZEC: 'ZEC', XXMR: 'XMR', XMLN: 'MLN', XREP: 'REP', XXTZ: 'XTZ', ETH2: 'ETH',
  ZEUR: 'EUR', ZUSD: 'USD', ZGBP: 'GBP', ZCAD: 'CAD', ZJPY: 'JPY', ZCHF: 'CHF', ZAUD: 'AUD',
};

/** Code Kraken → code usuel (« XXBT » → « BTC », « DOT.S » → « DOT », « ETH2.S » → « ETH »). */
export function krakenAsset(raw: string): string {
  const base = raw.trim().toUpperCase().replace(/\.(S|M|F|B|P|HOLD)$/, '').replace(/\d{2}\.S$/, '');
  return LEGACY[base] ?? base;
}

const FIAT = new Set(['EUR', 'USD', 'GBP', 'CAD', 'JPY', 'CHF', 'AUD']);
const GROUPED = new Set(['trade', 'spend', 'receive', 'conversion']);
const REWARD_TYPES = new Set(['staking', 'dividend', 'credit', 'invite bonus', 'reward']);
const INTERNAL_SUBTYPES = /^(spottostaking|stakingfromspot|spotfromstaking|stakingtospot|spottofutures|spotfromfutures|allocation|deallocation|autoallocation|migration)$/i;
const MARGIN = new Set(['margin', 'rollover', 'settled']);

interface Line {
  index: number;
  raw: string;
  date: string;
  refid: string;
  type: string;
  subtype: string;
  asset: string;
  amount: Dec;
  fee: Dec;
}

export function parseKrakenLedger(table: CsvTable, fileName: string): ImportReport {
  if (!detectKrakenLedger(table.headers)) throw new Error("Ce fichier n'est pas un grand livre Kraken (Ledgers).");
  const h = table.headers.map((x) => x.trim().toLowerCase());
  const at = (name: string) => h.indexOf(name);
  const idx = { refid: at('refid'), time: at('time'), type: at('type'), subtype: at('subtype'), asset: at('asset'), amount: at('amount'), fee: at('fee') };
  const source = `kraken:${fileName}`;
  const ignored = new Map<string, IgnoredGroup>();
  const transactions: Transaction[] = [];
  const fx: FxAmount[] = [];
  const groups = new Map<string, Line[]>();
  let minDate = '';
  let maxDate = '';

  const push = (tx: Omit<Transaction, 'platform' | 'source'>) => transactions.push({ ...tx, platform: 'Kraken', source });
  const fiatAmount = (txId: string, field: 'eur' | 'fee', value: Dec, currency: string, date: string): string | undefined => {
    if (value.isZero()) return undefined;
    if (currency === EUR) return value.toString();
    fx.push({ txId, field, amount: value.toString(), currency, date });
    return undefined;
  };

  table.rows.forEach((row, index) => {
    const date = utcToParis(row[idx.time] ?? '');
    let amount: Dec;
    let fee: Dec;
    try {
      amount = dec((row[idx.amount] ?? '').trim() || '0');
      fee = dec((row[idx.fee] ?? '').trim() || '0');
    } catch {
      amount = dec(NaN);
      fee = ZERO;
    }
    const line: Line = {
      index,
      raw: row.join('|'),
      date: date ?? '',
      refid: (row[idx.refid] ?? '').trim(),
      type: (row[idx.type] ?? '').trim().toLowerCase(),
      subtype: idx.subtype >= 0 ? (row[idx.subtype] ?? '').trim().toLowerCase() : '',
      asset: krakenAsset(row[idx.asset] ?? ''),
      amount,
      fee,
    };
    if (!date || amount.isNaN() || !line.asset) {
      if (row.some((c) => c.trim())) bump(ignored, 'invalid', { category: 'invalid', label: 'Lignes illisibles (date, montant ou actif)' }, `ligne ${index + 2}`);
      return;
    }
    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;
    const net = amount.minus(fee);
    const id = stableId('kr', line.raw);

    if (GROUPED.has(line.type)) {
      const key = line.refid || line.raw;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(line);
      return;
    }
    if (MARGIN.has(line.type)) {
      bump(ignored, 'margin', { category: 'margin', label: 'Marge (non prise en compte, à traiter à part)' }, line.type);
      return;
    }
    if (line.type === 'transfer' || line.type === 'earn') {
      if (INTERNAL_SUBTYPES.test(line.subtype) || (line.type === 'earn' && line.subtype !== 'reward')) {
        bump(ignored, 'internal', { category: 'internal', label: 'Mouvements internes à Kraken (Earn, staking, Futures)' }, `${line.type} ${line.subtype}`.trim());
        return;
      }
      if (line.type === 'earn' && net.gt(0)) {
        push({ id, date, type: 'reward', in: { asset: line.asset, quantity: net.toString() }, note: 'Kraken Earn' });
        return;
      }
      if (net.gt(0) && !FIAT.has(line.asset)) {
        // Transfert entrant sans sous-type : distribution gratuite (airdrop, fork) le plus souvent.
        push({ id, date, type: 'airdrop', in: { asset: line.asset, quantity: net.toString() }, note: 'Transfert entrant Kraken (airdrop ou fork probable) : à vérifier' });
        return;
      }
      bump(ignored, `unknown:transfer`, { category: 'unknown', label: 'Transferts Kraken non reconnus' }, line.subtype || line.date);
      return;
    }
    if (REWARD_TYPES.has(line.type)) {
      if (net.lte(0)) {
        bump(ignored, 'internal', { category: 'internal', label: 'Mouvements internes à Kraken (Earn, staking, Futures)' }, line.type);
        return;
      }
      push({ id, date, type: 'reward', in: { asset: line.asset, quantity: net.toString() }, note: `Kraken ${line.type}` });
      return;
    }
    if (line.type === 'deposit' || line.type === 'withdrawal') {
      if (FIAT.has(line.asset)) {
        bump(ignored, 'euro', { category: 'euro', label: 'Dépôts et retraits en monnaie (sans effet sur le calcul)' }, line.type);
        return;
      }
      const incoming = line.type === 'deposit';
      push({
        id,
        date,
        type: 'transfer',
        direction: incoming ? 'in' : 'out',
        moved: { asset: line.asset, quantity: amount.abs().toString() },
        ...(fee.gt(0) ? { fee: { asset: line.asset, quantity: fee.toString() } } : {}),
        note: incoming ? 'Dépôt sur Kraken depuis un autre compte ou wallet' : 'Retrait depuis Kraken vers un autre compte ou wallet',
      });
      return;
    }
    bump(ignored, `unknown:${line.type}`, { category: 'unknown', label: `Opération non reconnue : ${line.type}${line.subtype ? ` (${line.subtype})` : ''}` }, line.date);
  });

  // Opérations multi-lignes (même refid) : une sortie, une entrée.
  for (const lines of groups.values()) {
    const first = lines[0];
    const byAsset = new Map<string, { amount: Dec; fee: Dec }>();
    for (const l of lines) {
      const a = byAsset.get(l.asset) ?? { amount: ZERO, fee: ZERO };
      byAsset.set(l.asset, { amount: a.amount.plus(l.amount), fee: a.fee.plus(l.fee) });
    }
    const legs = [...byAsset].map(([asset, v]) => ({ asset, ...v, net: v.amount.minus(v.fee) }));
    const out = legs.filter((l) => l.net.lt(0));
    const into = legs.filter((l) => l.net.gt(0));
    const id = stableId('kr', lines.map((l) => l.raw).join('\n'));
    if (out.length !== 1 || into.length !== 1) {
      bump(ignored, 'ambiguous', { category: 'ambiguous', label: 'Opérations Kraken impossibles à reconstituer' }, `${first.type} ${first.refid}`);
      continue;
    }
    const [o] = out;
    const [i] = into;
    if (FIAT.has(o.asset)) {
      // Achat : montant brut en monnaie, frais séparés.
      const tx: Omit<Transaction, 'platform' | 'source'> = { id, date: first.date, type: 'buy', in: { asset: i.asset, quantity: i.net.toString() } };
      tx.eur = fiatAmount(id, 'eur', o.amount.abs(), o.asset, first.date);
      const f = fiatAmount(id, 'fee', o.fee, o.asset, first.date);
      if (f) tx.fee = { asset: EUR, quantity: f };
      push(tx);
    } else if (FIAT.has(i.asset)) {
      const tx: Omit<Transaction, 'platform' | 'source'> = { id, date: first.date, type: 'sell', out: { asset: o.asset, quantity: o.net.abs().toString() } };
      tx.eur = fiatAmount(id, 'eur', i.amount, i.asset, first.date);
      const f = fiatAmount(id, 'fee', i.fee, i.asset, first.date);
      if (f) tx.fee = { asset: EUR, quantity: f };
      push(tx);
    } else {
      push({ id, date: first.date, type: 'swap', out: { asset: o.asset, quantity: o.net.abs().toString() }, in: { asset: i.asset, quantity: i.net.toString() } });
    }
  }

  transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const currencies = [...new Set(fx.map((f) => f.currency))];
  const notes = ["Format Kraken « Ledgers » reconnu d'après sa documentation : vérifiez le résultat et signalez tout écart."];
  if (fx.length > 0) notes.push(`${fx.length} montant${fx.length > 1 ? 's' : ''} en ${currencies.join(', ')} : convertis en euros au cours Binance de la minute au moment de l'import.`);
  return {
    format: 'Kraken — grand livre (Ledgers)',
    fileName,
    lineCount: table.rows.length,
    transactions,
    ignored: [...ignored.values()].sort((a, b) => b.lines - a.lines),
    notes,
    period: minDate ? { from: minDate, to: maxDate } : undefined,
    currency: currencies[0] ?? EUR,
    fx,
  };
}
