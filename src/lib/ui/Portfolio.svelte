<script lang="ts">
  import { app } from '../state/app.svelte';
  import { eur, eurSigned, parseInput, qty, tone, unitPrice } from './format';
  import { nowLocal } from './draft';
  import { ui } from './ui.svelte';
  import { tick } from 'svelte';
  import EmptyState from './EmptyState.svelte';
  import type { PositionSummary } from '../core/portfolio';
  import { prices } from '../state/prices';
  import { PriceFetchError } from '../prices/binance';

  const result = $derived(app.portfolio);
  const held = $derived(result.positions.filter((p) => p.quantity.gt(0)));
  /** Poussière : valeur (ou, sans prix, coût) inférieure à 1 €. Repliée pour ne pas encombrer. */
  const isDust = (p: PositionSummary) => (p.currentValue ?? p.openCost).lt(1);
  const open = $derived(held.filter((p) => !isDust(p)));
  const dust = $derived(held.filter(isDust));
  const closed = $derived(result.positions.filter((p) => p.quantity.isZero()));
  const balanceWarnings = $derived(result.warnings.filter((w) => w.code === 'INSUFFICIENT_BALANCE'));
  const marginCount = $derived(result.warnings.filter((w) => w.code === 'MARGIN_IGNORED').length);
  const priced = $derived(held.filter((p) => p.currentPrice !== undefined).length);
  const unpriced = $derived(result.totals.unpriced);

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
      const { quotes, missing } = await prices.currentPricesEur(held.map((p) => p.asset));
      const values: Record<string, string> = {};
      for (const [asset, quote] of quotes) {
        // Précision lisible : 2 décimales au-delà de 100 €, 4 au-delà de 1 €, 6 chiffres significatifs en dessous.
        const p = quote.price;
        values[asset] = (p.gte(100) ? p.toDecimalPlaces(2) : p.gte(1) ? p.toDecimalPlaces(4) : p.toSignificantDigits(6)).toString();
      }
      await app.track('Récupérer les prix du jour', () => app.setPrices(values));
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

  /** Raisons proposées pour solder une position (D-052). */
  const REASONS = {
    margin: { label: 'Vendu ou liquidé sur marge', note: 'Sortie via la marge (position soldée à la main)', type: 'margin' },
    dust: { label: 'Poussière ou jeton sans valeur', note: 'Poussière ou jeton sans valeur (position soldée à la main)', type: 'margin' },
    gift: { label: 'Perdu ou donné', note: 'Perdu ou donné (position soldée à la main)', type: 'gift' },
  } as const;
  type Reason = keyof typeof REASONS;

  let writeOffDialog = $state<HTMLDialogElement>();
  let writeOffTarget = $state<PositionSummary | null>(null);
  let reason = $state<Reason>('margin');

  function writeOff(p: PositionSummary) {
    writeOffTarget = p;
    reason = 'margin';
    writeOffDialog?.showModal();
  }

  /** Retire la position du suivi par une sortie datée de maintenant, sans effet fiscal. */
  async function confirmWriteOff() {
    const p = writeOffTarget;
    if (!p) return;
    const r = REASONS[reason];
    await app.track(`Solder ${p.asset}`, () =>
      app.save({ date: nowLocal(), type: r.type, out: { asset: p.asset, quantity: p.quantity.toString() }, note: r.note }),
    );
    writeOffDialog?.close();
    ui.notify(`${p.asset} retiré du suivi.`, { undo: true });
  }

  let dustOpen = $state(false);
  /** Amène au champ de prix d'un actif (ou à sa ligne dans la poussière). */
  async function goToAsset(asset: string) {
    if (dust.some((p) => p.asset === asset)) dustOpen = true;
    await tick();
    const target = document.getElementById(`pos-${asset}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (target?.querySelector('input, button') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  function showBalanceIssues() {
    ui.txFilter = 'balance';
    location.hash = '#transactions';
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
      {#if unpriced.length > 0 && held.length > 0}
        <small>
          {priced > 0 ? `${priced} actif${priced > 1 ? 's' : ''} sur ${held.length}. ` : ''}Sans prix :
          {#each unpriced as a, i (a)}<button class="link" type="button" onclick={() => goToAsset(a)}>{a}</button>{i < unpriced.length - 1 ? ', ' : ''}{/each}
        </small>
      {/if}
    </div>
    <div class="stat">
      <span class="label">Plus-value latente</span>
      <span class={`value num ${tone(result.totals.unrealizedPnl)}`}>
        {result.totals.unrealizedPnl ? eurSigned(result.totals.unrealizedPnl) : '—'}
      </span>
      {#if unpriced.length > 0 && result.totals.unrealizedPnl}<small>Sur les actifs avec prix</small>{/if}
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
        <button class="link" type="button" onclick={showBalanceIssues}>Voir ces {balanceWarnings.length} transactions</button>
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

    {#if held.length > 0}
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
      <p class="muted">{dust.length > 0 ? 'Aucune position de plus de 1 €.' : 'Aucune position ouverte.'}</p>
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
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {#each open as p (p.asset)}
              <tr id={`pos-${p.asset}`}>
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
                <td class="row-actions">
                  <button class="btn btn-quiet btn-small" type="button" title="Retirer cette position du suivi, sans effet fiscal" onclick={() => writeOff(p)}>
                    Solder
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    {#if dust.length > 0}
      <details class="closed" bind:open={dustOpen}>
        <summary>Poussière, moins de 1 € ({dust.length})</summary>
        <div class="panel">
          <table>
            <thead>
              <tr>
                <th scope="col">Actif</th>
                <th scope="col">Quantité</th>
                <th scope="col">Coût</th>
                <th scope="col">Valeur</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {#each dust as p (p.asset)}
                <tr id={`pos-${p.asset}`}>
                  <th scope="row" class="asset">{p.asset}</th>
                  <td class="num">{qty(p.quantity)}</td>
                  <td class="num">{eur(p.openCost)}</td>
                  <td class="num">{p.currentValue ? eur(p.currentValue) : '—'}</td>
                  <td class="row-actions">
                    <button class="btn btn-quiet btn-small" type="button" title="Retirer cette position du suivi, sans effet fiscal" onclick={() => writeOff(p)}>
                      Solder
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </details>
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

<dialog bind:this={writeOffDialog} class="writeoff" aria-labelledby="wo-title">
  {#if writeOffTarget}
    <form method="dialog" onsubmit={(e) => (e.preventDefault(), confirmWriteOff())}>
      <h2 id="wo-title">Solder {qty(writeOffTarget.quantity)} {writeOffTarget.asset}</h2>
      <p class="muted">La position est retirée du portefeuille aujourd'hui, sans effet fiscal. Pourquoi n'est-elle plus détenue ?</p>
      <fieldset>
        <legend class="sr-only">Raison</legend>
        {#each Object.entries(REASONS) as [key, r] (key)}
          <label class="reason">
            <input type="radio" name="reason" value={key} bind:group={reason} />
            <span>{r.label}</span>
          </label>
        {/each}
      </fieldset>
      <p class="muted small">Vendue ou dépensée contre des euros ou un bien ? Ajoutez plutôt cette vente : elle est imposable.</p>
      <div class="wo-actions">
        <button class="btn" type="button" onclick={() => writeOffDialog?.close()}>Annuler</button>
        <button class="btn btn-primary" type="submit">Solder</button>
      </div>
    </form>
  {/if}
</dialog>

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
  .row-actions {
    width: 1%;
    white-space: nowrap;
    text-align: right;
  }
  .link {
    font: inherit;
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
  }
  .writeoff {
    border: 0;
    padding: 0;
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--ink);
    width: min(28rem, calc(100vw - 1.5rem));
  }
  .writeoff::backdrop {
    background: rgb(0 0 0 / 0.45);
  }
  .writeoff form {
    display: grid;
    gap: 0.75rem;
    padding: 1.1rem 1.2rem;
  }
  .writeoff h2 {
    font-size: 1.2rem;
  }
  .writeoff p {
    margin: 0;
    font-size: 0.9rem;
  }
  .writeoff .small {
    font-size: 0.82rem;
  }
  .writeoff fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
  }
  .reason {
    display: flex;
    gap: 0.55rem;
    align-items: center;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    cursor: pointer;
  }
  .reason:has(input:checked) {
    border-color: var(--accent);
    background: var(--surface-2);
  }
  .reason input {
    width: auto;
    margin: 0;
  }
  .wo-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
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

  @media (max-width: 1000px) {
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
