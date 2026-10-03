<script lang="ts">
  import { app } from '../state/app.svelte';
  import { eur, eurSigned, parseInput, qty, tone, unitPrice } from './format';
  import { ui } from './ui.svelte';
  import EmptyState from './EmptyState.svelte';
  import type { PositionSummary } from '../core/portfolio';
  import { prices } from '../state/prices';
  import { PriceFetchError } from '../prices/binance';

  const result = $derived(app.portfolio);
  const open = $derived(result.positions.filter((p) => p.quantity.gt(0)));
  const closed = $derived(result.positions.filter((p) => p.quantity.isZero()));
  const balanceWarnings = $derived(result.warnings.filter((w) => w.code === 'INSUFFICIENT_BALANCE'));
  const marginCount = $derived(result.warnings.filter((w) => w.code === 'MARGIN_IGNORED').length);
  const priced = $derived(open.filter((p) => p.currentPrice !== undefined).length);

  let invalidPrice = $state<string | null>(null);

  function onPrice(asset: string, raw: string) {
    const parsed = parseInput(raw);
    if (parsed === null || (parsed !== undefined && Number(parsed) < 0)) {
      invalidPrice = asset;
      return;
    }
    invalidPrice = null;
    app.setPrice(asset, parsed);
  }

  const allowed = $derived(app.settings.allowPriceFetch === true);
  let asking = $state(false);
  let fetching = $state(false);
  let fetchInfo = $state<{ at: Date; count: number; missing: string[] } | null>(null);
  let fetchError = $state<string | null>(null);

  async function fetchPrices() {
    if (!allowed) {
      asking = true;
      return;
    }
    fetching = true;
    fetchError = null;
    try {
      const { quotes, missing } = await prices.currentPricesEur(open.map((p) => p.asset));
      const values: Record<string, string> = {};
      for (const [asset, quote] of quotes) {
        // Précision lisible : 2 décimales au-delà de 100 €, 4 au-delà de 1 €, 6 chiffres significatifs en dessous.
        const p = quote.price;
        values[asset] = (p.gte(100) ? p.toDecimalPlaces(2) : p.gte(1) ? p.toDecimalPlaces(4) : p.toSignificantDigits(6)).toString();
      }
      await app.setPrices(values);
      fetchInfo = { at: new Date(), count: quotes.size, missing };
    } catch (e) {
      fetchError = e instanceof PriceFetchError ? e.message : String(e);
    } finally {
      fetching = false;
    }
  }

  async function acceptAndFetch() {
    await app.updateSettings({ allowPriceFetch: true });
    asking = false;
    await fetchPrices();
  }

  const priceValue = (p: PositionSummary) => (app.settings.prices?.[p.asset] ?? '').replace('.', ',');
</script>

{#if app.transactions.length === 0}
  <EmptyState />
{:else}
  <section class="summary panel" aria-label="Synthèse">
    <div class="stat">
      <span class="label">Coût des positions</span>
      <span class="value num">{eur(result.totals.openCost)}</span>
    </div>
    <div class="stat">
      <span class="label">Valeur actuelle</span>
      <span class="value num">{result.totals.currentValue ? eur(result.totals.currentValue) : '—'}</span>
      {#if !result.totals.currentValue && open.length > 0}
        <small>Prix saisis : {priced} sur {open.length}</small>
      {/if}
    </div>
    <div class="stat">
      <span class="label">Plus-value latente</span>
      <span class={`value num ${tone(result.totals.unrealizedPnl)}`}>
        {result.totals.unrealizedPnl ? eurSigned(result.totals.unrealizedPnl) : '—'}
      </span>
    </div>
    <div class="stat">
      <span class="label">Résultat réalisé</span>
      <span class={`value num ${tone(result.totals.realizedPnl)}`}>{eurSigned(result.totals.realizedPnl)}</span>
      <small>Suivi, hors calcul fiscal</small>
    </div>
  </section>

  {#if balanceWarnings.length > 0}
    <p class="notice" role="status">
      <span>
        <strong>Historique incomplet.</strong>
        {balanceWarnings.length === 1 ? 'Une sortie dépasse' : `${balanceWarnings.length} sorties dépassent`} le solde connu. Ajoutez les achats
        antérieurs pour des prix moyens justes.
        <a href="#transactions">Voir les transactions</a>
      </span>
    </p>
  {/if}
  {#if marginCount > 0}
    <p class="notice" role="status">
      <span><strong>{marginCount} opérations sur marge</strong> ne sont pas prises en compte : elles sont à traiter manuellement.</span>
    </p>
  {/if}

  <section class="positions">
    <div class="head">
      <h2>Positions</h2>
      <p class="muted">Saisissez le prix du jour, ou récupérez-le sur Binance, pour voir la valeur et la plus-value latente.</p>
    </div>

    {#if open.length > 0}
      <div class="fetch">
        {#if asking}
          <div class="consent">
            <p>
              <strong>Récupérer les prix du jour sur Binance.</strong> L'outil demande à l'API publique de Binance la liste des cours actuels. Rien
              d'autre n'est envoyé : ni quantité, ni montant, ni identifiant. Binance voit votre adresse IP.
            </p>
            <div class="row">
              <button class="btn btn-primary" type="button" onclick={acceptAndFetch}>Autoriser et récupérer</button>
              <button class="btn btn-quiet" type="button" onclick={() => (asking = false)}>Annuler</button>
            </div>
          </div>
        {:else}
          <div class="row">
            <button class="btn" type="button" onclick={fetchPrices} disabled={fetching}>
              {fetching ? 'Récupération…' : 'Prix du jour via Binance'}
            </button>
            {#if fetchInfo}
              <span class="muted" role="status">
                {fetchInfo.count} prix mis à jour à {fetchInfo.at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}{fetchInfo.missing.length >
                0
                  ? ` · introuvables : ${fetchInfo.missing.join(', ')}`
                  : ''}
              </span>
            {/if}
          </div>
          {#if fetchError}<p class="error" role="alert">{fetchError}</p>{/if}
        {/if}
      </div>
    {/if}

    {#if open.length === 0}
      <p class="muted">Aucune position ouverte.</p>
    {:else}
      <div class="panel">
        <table class="pos-table">
          <thead>
            <tr>
              <th scope="col">Actif</th>
              <th scope="col">Quantité</th>
              <th scope="col" title="Prix moyen pondéré des quantités encore détenues">Prix moyen</th>
              <th scope="col" title="Prix moyen de toutes les entrées depuis l'origine">Prix moyen historique</th>
              <th scope="col">Coût</th>
              <th scope="col" title="Prix de vente pour un résultat total nul sur cet actif">Prix d'équilibre</th>
              <th scope="col">Prix actuel</th>
              <th scope="col">Valeur</th>
              <th scope="col">Latent</th>
            </tr>
          </thead>
          <tbody>
            {#each open as p (p.asset)}
              <tr>
                <th scope="row" class="asset">{p.asset}</th>
                <td data-label="Quantité" class="num">{qty(p.quantity)}</td>
                <td data-label="Prix moyen" class="num">{unitPrice(p.averageOpenPrice)}</td>
                <td data-label="Prix moyen historique" class="num muted">{unitPrice(p.historicalAveragePrice)}</td>
                <td data-label="Coût" class="num">{eur(p.openCost)}</td>
                <td data-label="Prix d'équilibre" class="num">{unitPrice(p.breakEvenPrice)}</td>
                <td data-label="Prix actuel" class="price-cell">
                  <label class="price">
                    <span class="sr-only">Prix actuel de {p.asset} en euros</span>
                    <input
                      inputmode="decimal"
                      placeholder="—"
                      value={priceValue(p)}
                      aria-invalid={invalidPrice === p.asset}
                      onchange={(e) => onPrice(p.asset, e.currentTarget.value)}
                    />
                    <span aria-hidden="true">€</span>
                  </label>
                </td>
                <td data-label="Valeur" class="num">{p.currentValue ? eur(p.currentValue) : '—'}</td>
                <td data-label="Latent" class={`num ${tone(p.unrealizedPnl)}`}>{p.unrealizedPnl ? eurSigned(p.unrealizedPnl) : '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    {#if closed.length > 0}
      <details class="closed">
        <summary>Positions soldées ({closed.length})</summary>
        <div class="panel">
          <table>
            <thead>
              <tr>
                <th scope="col">Actif</th>
                <th scope="col">Quantité totale acquise</th>
                <th scope="col">Prix moyen historique</th>
                <th scope="col">Résultat réalisé</th>
              </tr>
            </thead>
            <tbody>
              {#each closed as p (p.asset)}
                <tr>
                  <th scope="row" class="asset">{p.asset}</th>
                  <td class="num">{qty(p.totalAcquiredQuantity)}</td>
                  <td class="num">{unitPrice(p.historicalAveragePrice)}</td>
                  <td class={`num ${tone(p.realizedPnl)}`}>{eurSigned(p.realizedPnl)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </details>
    {/if}
  </section>

  <div class="actions">
    <button class="btn btn-primary" type="button" onclick={() => ui.create('buy')}>Ajouter un achat</button>
    <button class="btn" type="button" onclick={() => ui.create('sell')}>Ajouter une vente</button>
  </div>
{/if}

<style>
  .summary {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
  }
  .stat {
    display: grid;
    align-content: start;
    gap: 0.15rem;
    padding: 1rem 1.15rem;
    border-left: 1px solid var(--rule);
  }
  .stat:first-child {
    border-left: 0;
  }
  .label {
    font-size: 0.82rem;
    color: var(--muted);
  }
  .value {
    font-size: 1.35rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .stat small {
    font-size: 0.78rem;
    color: var(--muted);
  }
  .positions {
    display: grid;
    gap: 0.8rem;
  }
  .head {
    display: grid;
    gap: 0.2rem;
  }
  .head h2 {
    font-size: 1.3rem;
  }
  .head p {
    font-size: 0.88rem;
  }
  .panel {
    overflow: hidden;
  }
  tbody tr:last-child > * {
    border-bottom: 0;
  }
  .asset {
    font-weight: 650;
    text-align: left;
    color: var(--ink);
    font-size: 0.95rem;
  }
  .price-cell {
    width: 9rem;
  }
  .price {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .price input {
    text-align: right;
    padding: 0.3rem 0.45rem;
  }
  .price span[aria-hidden] {
    color: var(--muted);
  }
  .fetch .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.8rem;
  }
  .fetch .row .muted {
    font-size: 0.85rem;
  }
  .consent {
    display: grid;
    gap: 0.6rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--rule);
    border-radius: var(--radius, 8px);
    font-size: 0.9rem;
  }
  .error {
    color: var(--loss, #b42318);
    font-size: 0.88rem;
    margin-top: 0.4rem;
  }
  .closed summary {
    cursor: pointer;
    color: var(--muted);
    font-weight: 550;
    padding-block: 0.3rem;
  }
  .closed .panel {
    margin-top: 0.6rem;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  @media (max-width: 860px) {
    .summary {
      grid-template-columns: repeat(2, 1fr);
    }
    .stat:nth-child(3) {
      border-left: 0;
    }
    .stat:nth-child(n + 3) {
      border-top: 1px solid var(--rule);
    }
    .pos-table thead {
      display: none;
    }
    .pos-table,
    .pos-table tbody,
    .pos-table tr {
      display: block;
    }
    .pos-table tr {
      display: grid;
      grid-template-columns: 1fr 1fr;
      border-bottom: 1px solid var(--rule);
      padding: 0.4rem 0;
    }
    .pos-table tbody tr:last-child {
      border-bottom: 0;
    }
    .pos-table th.asset {
      grid-column: 1 / -1;
      border: 0;
      padding-bottom: 0.2rem;
      font-size: 1.05rem;
    }
    .pos-table td {
      display: grid;
      text-align: left;
      border: 0;
      padding: 0.3rem 0.75rem;
    }
    .pos-table td::before {
      content: attr(data-label);
      font-size: 0.75rem;
      color: var(--muted);
    }
    .price-cell {
      width: auto;
    }
  }
</style>
