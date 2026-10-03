<script lang="ts">
  /**
   * Aide au calcul de la valeur globale du portefeuille avant une cession :
   * l'utilisateur saisit le prix de chaque actif détenu à cette date.
   */
  import { estimatePortfolioValue } from '../core/portfolio';
  import type { Dec } from '../core/money';
  import { eur, parseInput, qty } from './format';

  interface Props {
    holdings: Map<string, Dec>;
    date: string;
    onuse: (value: string) => void;
  }
  let { holdings, date, onuse }: Props = $props();

  let prices = $state<Record<string, string>>({});

  const parsed = $derived(
    Object.fromEntries(
      Object.entries(prices)
        .map(([asset, raw]) => [asset, parseInput(raw)] as const)
        .filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string'),
    ),
  );
  const estimate = $derived(estimatePortfolioValue(holdings, parsed));
  const entries = $derived([...holdings.entries()].sort(([a], [b]) => a.localeCompare(b)));
</script>

<div class="estimator">
  {#if entries.length === 0}
    <p class="muted">Aucun actif détenu avant cette date d'après vos transactions.</p>
  {:else}
    <p class="intro">
      Prix unitaire de chaque actif le {date.slice(0, 10).split('-').reverse().join('/')}, en euros. Le résultat ne couvre que les actifs
      saisis dans l'outil : ajoutez ceux détenus ailleurs (autres plateformes, wallets) au total.
    </p>
    <div class="rows">
      {#each entries as [asset, quantity] (asset)}
        <label class="row">
          <span class="asset">{asset}</span>
          <span class="q num muted">{qty(quantity)} ×</span>
          <input inputmode="decimal" placeholder="Prix €" bind:value={prices[asset]} aria-label={`Prix de ${asset} en euros`} />
        </label>
      {/each}
    </div>
    <div class="total">
      <span>
        Total : <strong class="num">{eur(estimate.value)}</strong>
        {#if estimate.missingPrices.length > 0}
          <span class="muted">(prix manquant : {estimate.missingPrices.join(', ')})</span>
        {/if}
      </span>
      <button
        class="btn btn-small"
        type="button"
        disabled={estimate.missingPrices.length > 0 || estimate.value.lte(0)}
        onclick={() => onuse(estimate.value.toDecimalPlaces(2).toString())}
      >
        Utiliser ce total
      </button>
    </div>
  {/if}
</div>

<style>
  .estimator {
    display: grid;
    gap: 0.6rem;
    padding: 0.8rem;
    border-radius: var(--radius);
    background: var(--surface-2);
    border: 1px solid var(--rule);
    font-size: 0.9rem;
  }
  .intro {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .rows {
    display: grid;
    gap: 0.35rem;
  }
  .row {
    display: grid;
    grid-template-columns: 4.5rem 1fr 8rem;
    align-items: center;
    gap: 0.5rem;
  }
  .asset {
    font-weight: 650;
  }
  .q {
    text-align: right;
  }
  .row input {
    text-align: right;
    padding: 0.3rem 0.45rem;
  }
  .total {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
</style>
