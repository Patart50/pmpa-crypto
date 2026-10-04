/**
 * Suivi du portefeuille par actif : quantités, prix moyen pondéré (PMP),
 * coût, plus-values réalisées « de suivi », prix d'équilibre, latent.
 *
 * ⚠️ Ce module ne sert PAS au calcul fiscal (voir fiscal.ts et ledger.ts) :
 * il raisonne actif par actif et tient compte des échanges crypto → crypto,
 * ce que la méthode fiscale française ne fait pas.
 *
 * Méthode : coût moyen pondéré. À chaque sortie, on retire le coût au prorata
 * de la quantité sortie (coût moyen courant × quantité). Le PMP des positions
 * restantes est donc inchangé par une vente.
 *
 * Conventions sur les frais (D-014) :
 * - en EUR : ajoutés au coût de l'actif reçu, ou déduits du produit d'une vente ;
 * - dans l'actif reçu : la quantité reçue est diminuée, le coût est inchangé ;
 * - dans l'actif cédé ou un autre actif (BNB…) : la quantité est retirée de cet
 *   actif et son coût est reporté sur l'opération (coût de l'actif reçu, ou
 *   charge de la vente) ;
 * - sur un transfert : la quantité est retirée, le coût reste sur l'actif
 *   (le PMP augmente légèrement) ;
 * - frais seuls, sans actif déplacé (frais de marge en BNB) : coût retiré au
 *   prorata et constaté en perte (D-033).
 */
import { dec, ZERO, type Dec } from './money';
import { EUR, sortTransactions, validateTransaction, type AssetCode, type Transaction } from './transactions';

export interface PositionSummary {
  asset: AssetCode;
  /** Quantité détenue. */
  quantity: Dec;
  /** Coût d'acquisition des quantités encore détenues. */
  openCost: Dec;
  /** PMP des positions ouvertes (null si quantité nulle). */
  averageOpenPrice: Dec | null;
  /** Quantité et coût cumulés de toutes les entrées depuis l'origine. */
  totalAcquiredQuantity: Dec;
  totalAcquiredCost: Dec;
  /** PMP historique : toutes les entrées depuis l'origine (null si aucune). */
  historicalAveragePrice: Dec | null;
  /** Résultat réalisé de suivi (ventes, paiements, échanges valorisés). */
  realizedPnl: Dec;
  /**
   * Prix d'équilibre : prix de vente unitaire de la position restante pour
   * lequel le résultat total sur cet actif (réalisé + latent) est nul.
   * null si quantité nulle ; 0 si l'actif a déjà dégagé plus que son coût.
   */
  breakEvenPrice: Dec | null;
  /** Avec un prix courant fourni : valeur et latent. */
  currentPrice?: Dec;
  currentValue?: Dec;
  unrealizedPnl?: Dec;
}

export type PortfolioWarningCode =
  | 'INSUFFICIENT_BALANCE'
  | 'INVALID_TRANSACTION'
  | 'MARGIN_IGNORED'
  | 'UNVALUED_FEE';

export interface PortfolioWarning {
  code: PortfolioWarningCode;
  transactionId: string;
  message: string;
}

export interface PortfolioResult {
  positions: PositionSummary[];
  totals: {
    openCost: Dec;
    realizedPnl: Dec;
    /** Présents seulement si un prix est connu pour chaque actif détenu. */
    /** Valeur et latent des positions qui ont un prix (les autres sont listées dans `unpriced`). */
    currentValue?: Dec;
    unrealizedPnl?: Dec;
    /** Actifs détenus sans prix courant : exclus de la valeur et du latent. */
    unpriced: AssetCode[];
  };
  warnings: PortfolioWarning[];
}

export interface PortfolioOptions {
  /** Prix unitaires courants en euros, par actif. */
  prices?: Record<AssetCode, string>;
  /** Arrête le calcul juste AVANT cette transaction (exclue). */
  stopBeforeId?: string;
}

interface State {
  qty: Dec;
  cost: Dec;
  acquiredQty: Dec;
  acquiredCost: Dec;
  realized: Dec;
}

const emptyState = (): State => ({
  qty: ZERO,
  cost: ZERO,
  acquiredQty: ZERO,
  acquiredCost: ZERO,
  realized: ZERO,
});

class Book {
  readonly states = new Map<AssetCode, State>();
  readonly warnings: PortfolioWarning[] = [];

  get(asset: AssetCode): State {
    let state = this.states.get(asset);
    if (!state) {
      state = emptyState();
      this.states.set(asset, state);
    }
    return state;
  }

  /** Ajoute une quantité et son coût. `acquisition` : compte dans le PMP historique. */
  add(asset: AssetCode, qty: Dec, cost: Dec, acquisition: boolean): void {
    const s = this.get(asset);
    s.qty = s.qty.plus(qty);
    s.cost = s.cost.plus(cost);
    if (acquisition) {
      s.acquiredQty = s.acquiredQty.plus(qty);
      s.acquiredCost = s.acquiredCost.plus(cost);
    }
  }

  /**
   * Retire une quantité et renvoie le coût correspondant (coût moyen courant).
   * Si la quantité détenue est insuffisante (historique incomplet), retire ce
   * qui existe et signale l'écart.
   */
  remove(asset: AssetCode, qty: Dec, txId: string, keepCost = false): Dec {
    const s = this.get(asset);
    let taken = qty;
    if (qty.gt(s.qty)) {
      this.warnings.push({
        code: 'INSUFFICIENT_BALANCE',
        transactionId: txId,
        message: `Solde ${asset} insuffisant : ${qty.toString()} demandé, ${s.qty.toString()} détenu. Historique incomplet ? Ajoutez les achats antérieurs.`,
      });
      taken = s.qty;
    }
    if (taken.lte(0)) return ZERO;
    const cost = keepCost ? ZERO : s.cost.times(taken).dividedBy(s.qty);
    s.qty = s.qty.minus(taken);
    s.cost = s.cost.minus(cost);
    if (s.qty.isZero()) s.cost = ZERO; // pas de coût résiduel sans quantité
    return cost;
  }

  realize(asset: AssetCode, amount: Dec): void {
    const s = this.get(asset);
    s.realized = s.realized.plus(amount);
  }
}

/**
 * Applique les frais d'une transaction.
 * Renvoie le coût en euros à imputer à l'opération (frais EUR, ou coût des
 * crypto utilisées pour payer les frais). Les frais dans l'actif reçu sont
 * traités par l'appelant (réduction de quantité).
 */
function applyFee(book: Book, tx: Transaction, receivedAsset?: AssetCode): Dec {
  const fee = tx.fee;
  if (!fee) return ZERO;
  const qty = dec(fee.quantity);
  if (qty.isZero()) return ZERO;
  if (fee.asset === EUR) return tx.type === 'transfer' ? ZERO : qty;
  if (fee.asset === receivedAsset) return ZERO;
  return book.remove(fee.asset, qty, tx.id, tx.type === 'transfer');
}

function receivedNet(tx: Transaction): Dec {
  const gross = dec(tx.in!.quantity);
  if (tx.fee && tx.fee.asset === tx.in!.asset) return gross.minus(dec(tx.fee.quantity));
  return gross;
}

function applyTransaction(book: Book, tx: Transaction): void {
  switch (tx.type) {
    case 'buy': {
      const feeCost = applyFee(book, tx, tx.in!.asset);
      book.add(tx.in!.asset, receivedNet(tx), dec(tx.eur!).plus(feeCost), true);
      return;
    }
    case 'sell':
    case 'payment': {
      const asset = tx.out!.asset;
      const costOut = book.remove(asset, dec(tx.out!.quantity), tx.id);
      const feeCost = applyFee(book, tx);
      book.realize(asset, dec(tx.eur!).minus(feeCost).minus(costOut));
      return;
    }
    case 'swap': {
      const outAsset = tx.out!.asset;
      const inAsset = tx.in!.asset;
      const costOut = book.remove(outAsset, dec(tx.out!.quantity), tx.id);
      const feeCost = applyFee(book, tx, inAsset);
      let inCost: Dec;
      if (tx.eur !== undefined) {
        // Échange valorisé : résultat de suivi sur l'actif cédé, coût de marché sur l'actif reçu.
        const value = dec(tx.eur);
        book.realize(outAsset, value.minus(costOut));
        inCost = value.plus(feeCost);
      } else {
        // Sans valeur de marché : report du coût (aucun résultat constaté).
        inCost = costOut.plus(feeCost);
      }
      book.add(inAsset, receivedNet(tx), inCost, true);
      return;
    }
    case 'reward':
    case 'airdrop': {
      applyFee(book, tx, tx.in!.asset);
      book.add(tx.in!.asset, receivedNet(tx), tx.eur !== undefined ? dec(tx.eur) : ZERO, true);
      return;
    }
    case 'gift': {
      // Sortie du portefeuille sans contrepartie : quantité et coût retirés, aucun résultat.
      book.remove(tx.out!.asset, dec(tx.out!.quantity), tx.id);
      applyFee(book, tx);
      return;
    }
    case 'transfer': {
      if (!tx.moved && tx.fee && tx.fee.asset !== EUR) {
        // Frais sans déplacement (frais de marge payés en BNB…) : une dépense,
        // pas un transfert. Coût retiré au prorata et constaté en perte (D-033),
        // sinon le PMP de l'actif gonfle à chaque prélèvement.
        const cost = book.remove(tx.fee.asset, dec(tx.fee.quantity), tx.id);
        book.realize(tx.fee.asset, cost.negated());
        return;
      }
      applyFee(book, tx);
      return;
    }
    case 'margin':
      if (tx.out) {
        // Sortie via la marge (vendu ou liquidé sur marge) : quantité et coût retirés, sans résultat (D-052).
        book.remove(tx.out.asset, dec(tx.out.quantity), tx.id);
        return;
      }
      book.warnings.push({
        code: 'MARGIN_IGNORED',
        transactionId: tx.id,
        message: 'Opération sur marge ignorée : à traiter manuellement (D-006).',
      });
      return;
  }
}

/** Calcule les positions à partir de la liste des transactions. */
export function computePortfolio(transactions: readonly Transaction[], options: PortfolioOptions = {}): PortfolioResult {
  const book = new Book();

  for (const tx of sortTransactions(transactions)) {
    if (options.stopBeforeId !== undefined && tx.id === options.stopBeforeId) break;
    const issues = validateTransaction(tx);
    if (issues.length > 0) {
      book.warnings.push({
        code: 'INVALID_TRANSACTION',
        transactionId: tx.id,
        message: `Transaction ignorée : ${issues.map((i) => i.message).join(' ')}`,
      });
      continue;
    }
    if (tx.fee && tx.fee.asset !== EUR && tx.fee.eur === undefined && tx.fee.asset !== tx.in?.asset && dec(tx.fee.quantity).gt(0)) {
      // Pas bloquant pour le suivi (le coût de l'actif utilisé est reporté),
      // mais utile au calcul fiscal des frais de cession.
      if (tx.type === 'sell' || tx.type === 'payment') {
        book.warnings.push({
          code: 'UNVALUED_FEE',
          transactionId: tx.id,
          message: `Frais payés en ${tx.fee.asset} sans contre-valeur en euros : ils ne seront pas déduits du prix de cession fiscal.`,
        });
      }
    }
    applyTransaction(book, tx);
  }

  const prices = options.prices ?? {};
  const positions: PositionSummary[] = [...book.states.entries()]
    .map(([asset, s]) => summarize(asset, s, prices[asset]))
    .sort((a, b) => a.asset.localeCompare(b.asset));

  const openCost = positions.reduce((sum, p) => sum.plus(p.openCost), ZERO);
  const realizedPnl = positions.reduce((sum, p) => sum.plus(p.realizedPnl), ZERO);
  const held = positions.filter((p) => p.quantity.gt(0));
  const priced = held.filter((p) => p.currentValue !== undefined);
  const totals: PortfolioResult['totals'] = { openCost, realizedPnl, unpriced: held.filter((p) => p.currentValue === undefined).map((p) => p.asset) };
  if (priced.length > 0) {
    // Valeur partielle : un actif sans prix ne bloque pas les autres (D-051).
    totals.currentValue = priced.reduce((sum, p) => sum.plus(p.currentValue!), ZERO);
    totals.unrealizedPnl = priced.reduce((sum, p) => sum.plus(p.unrealizedPnl!), ZERO);
  }

  return { positions, totals, warnings: book.warnings };
}

function summarize(asset: AssetCode, s: State, price: string | undefined): PositionSummary {
  const hasQty = s.qty.gt(0);
  let breakEvenPrice: Dec | null = null;
  if (hasQty) {
    const raw = s.cost.minus(s.realized).dividedBy(s.qty);
    breakEvenPrice = raw.isNegative() ? ZERO : raw;
  }
  const summary: PositionSummary = {
    asset,
    quantity: s.qty,
    openCost: s.cost,
    averageOpenPrice: hasQty ? s.cost.dividedBy(s.qty) : null,
    totalAcquiredQuantity: s.acquiredQty,
    totalAcquiredCost: s.acquiredCost,
    historicalAveragePrice: s.acquiredQty.gt(0) ? s.acquiredCost.dividedBy(s.acquiredQty) : null,
    realizedPnl: s.realized,
    breakEvenPrice,
  };
  if (price !== undefined && price !== '') {
    const p = dec(price);
    summary.currentPrice = p;
    summary.currentValue = s.qty.times(p);
    summary.unrealizedPnl = summary.currentValue.minus(s.cost);
  }
  return summary;
}

/** Quantités détenues juste avant une transaction donnée. */
export function holdingsBefore(transactions: readonly Transaction[], transactionId: string): Map<AssetCode, Dec> {
  const { positions } = computePortfolio(transactions, { stopBeforeId: transactionId });
  return new Map(positions.filter((p) => p.quantity.gt(0)).map((p) => [p.asset, p.quantity]));
}

/**
 * Estime la valeur globale d'un portefeuille à partir de prix unitaires
 * fournis par l'utilisateur. Signale les actifs sans prix.
 */
export function estimatePortfolioValue(
  holdings: Map<AssetCode, Dec>,
  prices: Record<AssetCode, string>,
): { value: Dec; missingPrices: AssetCode[] } {
  let value = ZERO;
  const missingPrices: AssetCode[] = [];
  for (const [asset, qty] of holdings) {
    const price = prices[asset];
    if (price === undefined || price === '') missingPrices.push(asset);
    else value = value.plus(qty.times(dec(price)));
  }
  return { value, missingPrices: missingPrices.sort() };
}
