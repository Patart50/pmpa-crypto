<script lang="ts">
  import { app } from '../state/app.svelte';
  import { TRANSACTION_LABELS, TRANSACTION_TYPES, validateTransaction, type Transaction, type TransactionType } from '../core/transactions';
  import { dateFr, eur, qty } from './format';
  import { ui } from './ui.svelte';
  import EmptyState from './EmptyState.svelte';

  let typeFilter = $state<TransactionType | ''>('');
  let assetFilter = $state('');

  const assets = $derived(
    [...new Set(app.transactions.flatMap((t) => [t.in?.asset, t.out?.asset].filter((a): a is string => !!a)))].sort(),
  );

  const rows = $derived(
    app.newestFirst.filter(
      (t) => (typeFilter === '' || t.type === typeFilter) && (assetFilter === '' || t.in?.asset === assetFilter || t.out?.asset === assetFilter),
    ),
  );

  const portfolioIssues = $derived(new Set(app.portfolio.warnings.map((w) => w.transactionId)));

  function status(tx: Transaction): string | null {
    if (validateTransaction(tx).length > 0) return 'Transaction incomplète : ouvrez-la pour corriger.';
    if ((tx.type === 'sell' || tx.type === 'payment') && !tx.portfolioValueEur) return 'Valeur du portefeuille à renseigner pour le calcul fiscal.';
    if (tx.type === 'margin') return 'Opération sur marge : non prise en compte.';
    if (portfolioIssues.has(tx.id)) return 'Solde insuffisant à cette date : historique incomplet ?';
    return null;
  }

  function movement(tx: Transaction): string {
    const parts: string[] = [];
    if (tx.out) parts.push(`−${qty(tx.out.quantity)} ${tx.out.asset}`);
    if (tx.in) parts.push(`+${qty(tx.in.quantity)} ${tx.in.asset}`);
    if (tx.type === 'transfer' && tx.moved) parts.push(`${qty(tx.moved.quantity)} ${tx.moved.asset}`);
    return parts.join('  →  ') || '—';
  }

  async function remove(tx: Transaction) {
    if (!confirm(`Supprimer cette transaction (${TRANSACTION_LABELS[tx.type].toLowerCase()} du ${dateFr(tx.date, false)}) ?`)) return;
    await app.remove(tx.id);
    ui.notify('Transaction supprimée.');
  }

  const creatable = TRANSACTION_TYPES.filter((t) => t !== 'margin');
</script>

{#if app.transactions.length === 0}
  <EmptyState />
{:else}
  <section class="bar">
    <div class="filters">
      <label class="field">
        <span>Type</span>
        <select bind:value={typeFilter}>
          <option value="">Tous les types</option>
          {#each TRANSACTION_TYPES as t}<option value={t}>{TRANSACTION_LABELS[t]}</option>{/each}
        </select>
      </label>
      <label class="field">
        <span>Actif</span>
        <select bind:value={assetFilter}>
          <option value="">Tous les actifs</option>
          {#each assets as a}<option value={a}>{a}</option>{/each}
        </select>
      </label>
    </div>
    <div class="add">
      <button class="btn btn-primary" type="button" onclick={() => ui.create()}>Ajouter une transaction</button>
    </div>
  </section>

  <p class="muted count">
    {rows.length} transaction{rows.length > 1 ? 's' : ''}{rows.length !== app.transactions.length ? ` sur ${app.transactions.length}` : ''}
  </p>

  <div class="panel">
    <table class="tx-table">
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Opération</th>
          <th scope="col">Mouvement</th>
          <th scope="col">Montant</th>
          <th scope="col">Frais</th>
          <th scope="col"><span class="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as tx (tx.id)}
          {@const problem = status(tx)}
          <tr class:flagged={problem !== null}>
            <td class="date num">{dateFr(tx.date)}</td>
            <td>
              <span class={`type type-${tx.type}`}>{TRANSACTION_LABELS[tx.type]}</span>
              {#if tx.platform}<span class="platform muted">{tx.platform}</span>{/if}
              {#if problem}<span class="problem">{problem}</span>{/if}
            </td>
            <td class="num move">{movement(tx)}</td>
            <td class="num amount" data-label="Montant">{tx.eur ? eur(tx.eur) : '—'}</td>
            <td class="num muted fees" data-label="Frais">
              {#if tx.fee && Number(tx.fee.quantity) > 0}
                {tx.fee.asset === 'EUR' ? eur(tx.fee.quantity) : `${qty(tx.fee.quantity)} ${tx.fee.asset}`}
              {:else}—{/if}
            </td>
            <td class="row-actions">
              <button class="btn btn-quiet btn-small" type="button" onclick={() => ui.edit(tx.id)}>Modifier</button>
              <button class="btn btn-quiet btn-small btn-danger" type="button" onclick={() => remove(tx)}>Supprimer</button>
            </td>
          </tr>
        {:else}
          <tr><td colspan="6" class="muted">Aucune transaction ne correspond à ces filtres.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>

  <p class="muted hint">
    Types disponibles : {creatable.map((t) => TRANSACTION_LABELS[t].toLowerCase()).join(', ')}. L'import CSV des plateformes arrive bientôt.
  </p>
{/if}

<style>
  .bar {
    display: flex;
    justify-content: space-between;
    align-items: end;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .filters {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .filters .field {
    width: 13rem;
  }
  .count {
    font-size: 0.85rem;
    margin-bottom: -0.6rem;
  }
  .panel {
    overflow-x: auto;
  }
  tbody tr:last-child > * {
    border-bottom: 0;
  }
  .date {
    white-space: nowrap;
    color: var(--muted);
    font-size: 0.88rem;
  }
  td:nth-child(2) {
    text-align: left;
    min-width: 13rem;
  }
  .type {
    font-weight: 600;
    display: block;
  }
  .type-sell,
  .type-payment {
    color: var(--accent);
  }
  .type-margin {
    color: var(--muted);
  }
  .platform {
    font-size: 0.8rem;
  }
  .problem {
    display: block;
    font-size: 0.8rem;
    color: var(--warn);
  }
  tr.flagged td:first-child {
    box-shadow: inset 3px 0 0 var(--warn);
  }
  .move {
    white-space: pre;
    font-size: 0.9rem;
  }
  .row-actions {
    white-space: nowrap;
    width: 1%;
  }
  .hint {
    font-size: 0.82rem;
  }

  @media (max-width: 760px) {
    .filters,
    .filters .field,
    .add,
    .add .btn {
      width: 100%;
    }
    .add .btn {
      justify-content: center;
    }
    .tx-table thead {
      display: none;
    }
    .tx-table,
    .tx-table tbody,
    .tx-table tr,
    .tx-table td {
      display: block;
    }
    .tx-table tr {
      padding: 0.6rem 0.25rem;
      border-bottom: 1px solid var(--rule);
    }
    .tx-table td {
      border: 0;
      text-align: left;
      padding: 0.1rem 0.75rem;
    }
    .move {
      white-space: normal;
    }
    .amount::before,
    .fees::before {
      content: attr(data-label) ' : ';
      color: var(--muted);
      font-size: 0.85rem;
    }
    .row-actions {
      width: auto;
      padding-top: 0.35rem !important;
    }
    tr.flagged td:first-child {
      box-shadow: none;
    }
    tr.flagged {
      box-shadow: inset 3px 0 0 var(--warn);
    }
  }
</style>
