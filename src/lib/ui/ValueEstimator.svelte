<script lang="ts">
  /**
   * Aide au calcul de la valeur globale du portefeuille avant une cession :
   * l'utilisateur saisit le prix de chaque actif détenu à cette date.
   */
  import { estimatePortfolioValue } from '../core/portfolio';
  import { dec, type Dec } from '../core/money';
  import { app } from '../state/app.svelte';
  import { prices as priceSource } from '../state/prices';
  import { valueHoldings, PriceFetchError } from '../prices/binance';
  import { eur, parseInput, qty } from './format';

  interface Props {
    holdings: Map<string, Dec>;
    /** Positions reconstituées à l'import (prioritaires sur les positions suivies). */
    snapshot?: Record<string, string>;
    date: string;
    onuse: (value: string) => void;
  }
  let { holdings: tracked, snapshot, date, onuse }: Props = $props();
  const holdings = $derived(snapshot ? new Map(Object.entries(snapshot).map(([a, q]) => [a, dec(q)] as const)) : tracked);
  let fetching = $state(false);
  let fetchError = $state<string | null>(null);

  async function fetchPrices() {
    if (!app.settings.allowPriceFetch) await app.updateSettings({ allowPriceFetch: true });
    fetching = true;
    fetchError = null;
    try {
      const v = await valueHoldings(holdings, date, priceSource);
      for (const line of v.lines) if (line.price) prices[line.asset] = line.price.toDecimalPlaces(8).toString().replace('.', ',');
      if (v.missing.length > 0) fetchError = `Prix introuvable sur Binance pour : ${v.missing.join(', ')}. Saisissez-les à la main.`;
    } catch (e) {
      fetchError = e instanceof PriceFetchError ? e.message : String(e);
    }
    fetching = false;
  }

  let prices = $state<Record<string, string>>({});
  let other = $state('');
  const otherValue = $derived(parseInput(other));

  const parsed = $derived(
    Object.fromEntries(
      Object.entries(prices)
        .map(([asset, raw]) => [asset, parseInput(raw)] as const)
        .filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string'),
    ),
  );
  const base = $derived(estimatePortfolioValue(holdings, parsed));
  const estimate = $derived({
    ...base,
    value: typeof otherValue === 'string' ? base.value.plus(otherValue) : base.value,
  });
  const entries = $derived([...holdings.entries()].sort(([a], [b]) => a.localeCompare(b)));
</script>

<div class="estimator">
  {#if entries.length === 0}
    <p class="muted">Aucun actif détenu avant cette date d'après vos transactions saisies.</p>
  {/if}
    {#if snapshot}
      <p class="intro"><strong>Positions reconstituées depuis votre export Binance</strong>, marge incluse, dette déduite.</p>
    {/if}
    {#if entries.length > 0}
      <div class="fetch">
        <button class="btn btn-small" type="button" onclick={fetchPrices} disabled={fetching}>
          {fetching ? 'Récupération…' : 'Récupérer les prix Binance de ce moment'}
        </button>
        <small class="muted">Envoie seulement des noms de paires et l'heure à Binance.</small>
      </div>
      {#if fetchError}<p class="warn-text">{fetchError}</p>{/if}
    {/if}
    <p class="intro">
      Prix unitaire de chaque actif le {date.slice(0, 10).split('-').reverse().join('/')}, en euros. Ajoutez sur la ligne « Autres » la valeur
      de ce que l'outil ne suit pas : marge, Earn bloqué, autres plateformes et wallets.
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
    <label class="row other">
      <span class="asset">Autres</span>
      <span class="q muted">Marge, Earn, autres wallets</span>
      <input inputmode="decimal" placeholder="0 €" bind:value={other} aria-label="Valeur des actifs non suivis par l'outil, en euros" aria-invalid={otherValue === null} />
    </label>
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
  .fetch {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .fetch small {
    font-size: 0.78rem;
  }
  .warn-text {
    color: var(--warn);
    font-size: 0.85rem;
  }
  .other {
    padding-top: 0.35rem;
    border-top: 1px dashed var(--rule-strong);
  }
  .other .q {
    font-size: 0.8rem;
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
