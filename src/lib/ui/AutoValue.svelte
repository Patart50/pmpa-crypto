<script lang="ts">
  /**
   * Calcul automatique de la valeur globale du portefeuille avant chaque
   * cession : positions connues × prix Binance à la minute de la cession.
   */
  import { app } from '../state/app.svelte';
  import { prices } from '../state/prices';
  import { holdingsBefore } from '../core/portfolio';
  import { valueHoldings, PriceFetchError, type Valuation } from '../prices/binance';
  import type { Transaction } from '../core/transactions';
  import { dateFr, eur, qty, unitPrice } from './format';
  import { ui } from './ui.svelte';

  interface Props {
    /** Cessions à valoriser (sans valeur de portefeuille). */
    targets: Transaction[];
  }
  let { targets }: Props = $props();

  type Row = { tx: Transaction; status: 'pending' | 'running' | 'done' | 'partial' | 'error'; valuation?: Valuation; message?: string; snapshot: boolean };

  let rows = $state<Row[]>([]);
  let running = $state(false);
  let error = $state<string | null>(null);
  let progress = $state({ done: 0, total: 0 });

  const allowed = $derived(app.settings.allowPriceFetch === true);
  const withSnapshot = $derived(targets.filter((t) => t.holdings).length);

  async function accept() {
    await app.updateSettings({ allowPriceFetch: true });
    run();
  }

  async function acceptPartial(row: Row) {
    if (!row.valuation) return;
    await app.updateMany([{ ...$state.snapshot(row.tx), portfolioValueEur: row.valuation.value.toDecimalPlaces(2).toString() }]);
    row.status = 'done';
    row.message = `Validée sans ${row.valuation.missing.join(', ')}.`;
  }

  async function acceptAllPartial() {
    const partial = rows.filter((r) => r.status === 'partial' && r.valuation && r.valuation.value.gt(0));
    await app.track('Valider les valeurs partielles', async () => {
      for (const r of partial) await acceptPartial(r);
    });
    ui.notify(`${partial.length} valeur${partial.length > 1 ? 's' : ''} validée${partial.length > 1 ? 's' : ''} sans les actifs introuvables.`, { undo: true });
  }

  const partialCount = $derived(rows.filter((r) => r.status === 'partial' && r.valuation && r.valuation.value.gt(0)).length);

  async function run() {
    running = true;
    error = null;
    rows = targets.map((tx) => ({ tx, status: 'pending', snapshot: !!tx.holdings }));
    progress = { done: 0, total: rows.length };
    const updates: Transaction[] = [];
    for (const row of rows) {
      row.status = 'running';
      try {
        const holdings = row.tx.holdings ?? holdingsBefore(app.transactions, row.tx.id);
        const valuation = await valueHoldings(holdings, row.tx.date, prices);
        row.valuation = valuation;
        if (valuation.missing.length === 0 && valuation.value.gt(0)) {
          row.status = 'done';
          updates.push({ ...$state.snapshot(row.tx), portfolioValueEur: valuation.value.toDecimalPlaces(2).toString() });
        } else {
          row.status = 'partial';
          row.message = valuation.value.lte(0) ? 'Aucune position connue avant cette date.' : `Prix introuvable : ${valuation.missing.join(', ')}`;
        }
      } catch (e) {
        row.status = 'error';
        error = e instanceof PriceFetchError ? e.message : String(e);
        break;
      }
      progress.done++;
    }
    if (updates.length > 0) await app.track('Calculer les valeurs de portefeuille', () => app.updateMany(updates));
    running = false;
    if (updates.length > 0) ui.notify(`${updates.length} valeur${updates.length > 1 ? 's' : ''} de portefeuille renseignée${updates.length > 1 ? 's' : ''}.`, { undo: true });
  }
</script>

<div class="auto">
  {#if !allowed}
    <div class="consent">
      <p>
        <strong>Calcul automatique avec les prix Binance.</strong> Pour chaque cession, l'outil reprend les quantités que vous déteniez juste
        avant{withSnapshot > 0 ? ' (reconstituées depuis votre export Binance, marge incluse)' : ''} et les multiplie par le cours de chaque crypto à
        la minute de la vente.
      </p>
      <p class="muted">
        C'est la seule fonction qui contacte Internet : seuls des noms de paires (ex. SOLUSDT) et des heures sont envoyés à l'API publique de
        Binance. Aucune quantité, aucun montant.
      </p>
      <button class="btn btn-primary" type="button" onclick={accept} disabled={running}>Autoriser et calculer</button>
    </div>
  {:else if rows.length === 0}
    <button class="btn btn-primary" type="button" onclick={run} disabled={running}>
      Calculer automatiquement ({targets.length} cession{targets.length > 1 ? 's' : ''})
    </button>
  {/if}

  {#if rows.length > 0}
    <p class="muted small">{running ? `Calcul en cours : ${progress.done} sur ${progress.total}…` : 'Calcul terminé.'}</p>
    {#if error}<p class="loss small">{error} Réessayez plus tard ou saisissez la valeur à la main.</p>{/if}
    <ul class="results">
      {#each rows as row (row.tx.id)}
        <li class={row.status}>
          <div class="line">
            <span>{dateFr(row.tx.date)} · {row.tx.out?.asset}</span>
            <span class="num">
              {#if row.status === 'done'}{eur(row.valuation!.value)}{:else if row.status === 'running'}…{:else if row.status === 'partial'}À compléter{:else if row.status === 'error'}Erreur{:else}—{/if}
            </span>
          </div>
          {#if row.message}<small>{row.message}</small>{/if}
          {#if row.status === 'partial' && row.valuation && row.valuation.value.gt(0)}
            <button class="btn btn-small partial-btn" type="button" onclick={() => app.track('Valider une valeur partielle', () => acceptPartial(row))}>
              Utiliser {eur(row.valuation.value)} sans {row.valuation.missing.join(', ')}
            </button>
          {/if}
          {#if row.valuation && row.valuation.lines.length > 0}
            <details>
              <summary>Détail ({row.valuation.lines.length} actifs{row.snapshot ? ', marge incluse' : ''})</summary>
              <table>
                <tbody>
                  {#each row.valuation.lines as l}
                    <tr>
                      <th scope="row">{l.asset}</th>
                      <td class="num">{qty(l.quantity)}</td>
                      <td class="num">{l.price ? unitPrice(l.price) : '—'}</td>
                      <td class="num">{l.value ? eur(l.value) : 'prix introuvable'}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </details>
          {/if}
        </li>
      {/each}
    </ul>
    {#if !running && partialCount > 1}
      <button class="btn btn-small" type="button" onclick={acceptAllPartial}>
        Valider les {partialCount} valeurs sans les actifs introuvables
      </button>
    {/if}
    {#if !running}
      <p class="muted small">
        Un actif sans prix sur Binance (jeton retiré de la cote, poussière) est souvent négligeable : ouvrez le détail pour en juger avant de
        valider sans lui.
      </p>
      <p class="muted small">
        Ces valeurs ne comptent que les cryptos présentes sur Binance. Si vous déteniez aussi des cryptos ailleurs (wallet, autre plateforme),
        ajoutez leur valeur en modifiant la cession.
      </p>
    {/if}
  {/if}
</div>

<style>
  .auto {
    display: grid;
    gap: 0.6rem;
  }
  .consent {
    display: grid;
    gap: 0.5rem;
    padding: 0.85rem;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .consent .btn,
  .auto > .btn {
    justify-self: start;
  }
  .small {
    font-size: 0.85rem;
  }
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
  }
  .results li {
    padding: 0.45rem 0.6rem;
    border-radius: var(--radius);
    background: var(--surface);
    border: 1px solid var(--rule);
    display: grid;
    gap: 0.2rem;
  }
  .results li.done .num {
    color: var(--gain);
    font-weight: 650;
  }
  .results li.partial .num,
  .results li.partial small,
  .results li.error .num {
    color: var(--warn);
  }
  .partial-btn {
    justify-self: start;
  }
  .line {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
  }
  details summary {
    cursor: pointer;
    font-size: 0.82rem;
    color: var(--muted);
  }
  details table {
    font-size: 0.82rem;
    margin-top: 0.3rem;
  }
  details th,
  details td {
    padding: 0.2rem 0.4rem;
  }
</style>
