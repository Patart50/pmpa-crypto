<script lang="ts">
  import { app } from '../state/app.svelte';
  import { TRANSACTION_LABELS, TRANSACTION_TYPES, validateTransaction, type Transaction, type TransactionType } from '../core/transactions';
  import { dateFr, eur, qty } from './format';
  import { ui } from './ui.svelte';
  import EmptyState from './EmptyState.svelte';
  import { transactionsToCsv } from '../import/generic';
  import { DUST_NOTE } from '../import/binance';
  import type { BatchSummary } from '../core/batches';

  const PAGE = 200;
  let typeFilter = $state<TransactionType | ''>('');
  let assetFilter = $state('');
  let onlyFlagged = $state(false);
  let batchFilter = $state('');
  /** Seulement les sorties qui dépassent le solde connu (historique incomplet). */
  let onlyBalance = $state(ui.txFilter === 'balance');
  ui.txFilter = null;
  let limit = $state(PAGE);

  const assets = $derived(
    [...new Set(app.transactions.flatMap((t) => [t.in?.asset, t.out?.asset].filter((a): a is string => !!a)))].sort(),
  );

  const portfolioIssues = $derived(new Set(app.portfolio.warnings.map((w) => w.transactionId)));
  const balanceIssues = $derived(new Set(app.portfolio.warnings.filter((w) => w.code === 'INSUFFICIENT_BALANCE').map((w) => w.transactionId)));

  const rows = $derived(
    app.newestFirst.filter(
      (t) =>
        (typeFilter === '' || t.type === typeFilter) &&
        (assetFilter === '' || t.in?.asset === assetFilter || t.out?.asset === assetFilter || t.moved?.asset === assetFilter || t.fee?.asset === assetFilter) &&
        (!onlyFlagged || status(t) !== null) &&
        (batchFilter === '' || batchIds.has(t.id)) &&
        (!onlyBalance || balanceIssues.has(t.id)),
    ),
  );
  const visible = $derived(rows.slice(0, limit));
  const batchIds = $derived(new Set(app.batches.find((b) => b.id === batchFilter)?.ids ?? []));
  const imported = $derived(app.batches.filter((b) => b.id !== 'manual'));

  async function removeBatch(b: BatchSummary) {
    const lines = [
      `Supprimer l'import ${b.platform} (${b.files.join(', ')}) ?`,
      '',
      `${b.count.toLocaleString('fr-FR')} transaction${b.count > 1 ? 's' : ''} seront supprimées.`,
    ];
    if (b.edited > 0) lines.push(`Dont ${b.edited} que vous avez modifiée${b.edited > 1 ? 's' : ''} à la main.`);
    lines.push('', 'Les autres imports et vos saisies à la main ne sont pas touchés.');
    if (!confirm(lines.join('\n'))) return;
    await app.track(`Supprimer l'import ${b.platform}`, () => app.removeBatch(b));
    if (batchFilter === b.id) batchFilter = '';
    ui.notify(`Import ${b.platform} supprimé : ${b.count.toLocaleString('fr-FR')} transactions retirées.`, { undo: true });
  }
  const flaggedCount = $derived(onlyFlagged ? rows.length : app.transactions.filter((t) => status(t) !== null).length);

  $effect(() => {
    // Revenir à la première page quand les filtres changent.
    void typeFilter;
    void assetFilter;
    void onlyFlagged;
    void batchFilter;
    void onlyBalance;
    limit = PAGE;
  });

  function exportCsv() {
    const csv = transactionsToCsv(app.newestFirst.slice().reverse());
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    const d = new Date();
    a.href = url;
    a.download = `pmpa-crypto-transactions-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    ui.notify('Transactions exportées en CSV.');
  }

  /** Problème qui demande une action (compte dans « À vérifier »). */
  function status(tx: Transaction): string | null {
    if (validateTransaction(tx).length > 0) return 'Transaction incomplète : ouvrez-la pour corriger.';
    if ((tx.type === 'sell' || tx.type === 'payment') && !tx.portfolioValueEur)
      return 'Valeur du portefeuille à renseigner (calcul automatique dans l’onglet Fiscalité).';
    return null;
  }

  /** Information sans action nécessaire. */
  function info(tx: Transaction): string | null {
    if (tx.type === 'margin') return tx.out ? 'Sortie via la marge : retirée du portefeuille, sans effet fiscal.' : 'Opération sur marge : non prise en compte.';
    if (portfolioIssues.has(tx.id) && !tx.note?.startsWith(DUST_NOTE))
      return 'Solde insuffisant à cette date (fonds revenus de la marge ou achats antérieurs manquants) : sans effet sur le calcul fiscal.';
    return null;
  }

  function movement(tx: Transaction): string {
    const parts: string[] = [];
    if (tx.out) parts.push(`−${qty(tx.out.quantity)} ${tx.out.asset}`);
    if (tx.in) parts.push(`+${qty(tx.in.quantity)} ${tx.in.asset}`);
    if (tx.type === 'transfer' && tx.moved) parts.push(`${qty(tx.moved.quantity)} ${tx.moved.asset}`);
    return parts.join('  →  ') || '—';
  }

  /** Un clic n'importe où sur la ligne ouvre la transaction (hors boutons et note dépliable). */
  function openFromRow(event: MouseEvent, tx: Transaction) {
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, select, [tabindex]')) return;
    if (window.getSelection()?.toString()) return;
    ui.edit(tx.id);
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
      {#if app.batches.length > 1}
        <label class="field">
          <span>Origine</span>
          <select bind:value={batchFilter}>
            <option value="">Toutes</option>
            {#each app.batches as b (b.id)}<option value={b.id}>{b.platform}{b.files.length ? ` — ${b.files.join(', ')}` : ''}</option>{/each}
          </select>
        </label>
      {/if}
      {#if balanceIssues.size > 0 || onlyBalance}
        <label class="flag-toggle">
          <input type="checkbox" bind:checked={onlyBalance} />
          Solde insuffisant ({balanceIssues.size.toLocaleString('fr-FR')})
        </label>
      {/if}
      {#if flaggedCount > 0 || onlyFlagged}
        <label class="flag-toggle">
          <input type="checkbox" bind:checked={onlyFlagged} />
          À vérifier ({flaggedCount.toLocaleString('fr-FR')})
        </label>
      {/if}
    </div>
    <div class="add">
      <button class="btn" type="button" onclick={() => (ui.importing = true)}>Importer</button>
      <button class="btn" type="button" onclick={exportCsv}>Exporter en CSV</button>
      <button class="btn btn-primary" type="button" onclick={() => ui.create()}>Ajouter une transaction</button>
    </div>
  </section>

  {#if imported.length > 0}
    <details class="imports">
      <summary>Imports ({imported.length})</summary>
      <ul>
        {#each app.batches as b (b.id)}
          <li>
            <div class="imp-main">
              <strong>{b.platform}</strong>
              <span class="muted">
                {b.files.join(', ')}{b.importedAt ? ` · importé le ${new Date(b.importedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
              </span>
            </div>
            <span class="num imp-count">
              {b.count.toLocaleString('fr-FR')} transaction{b.count > 1 ? 's' : ''}{b.edited > 0 ? ` · ${b.edited} modifiée${b.edited > 1 ? 's' : ''}` : ''}
            </span>
            <span class="imp-actions">
              <button class="btn btn-quiet btn-small" type="button" onclick={() => (batchFilter = b.id)}>Voir</button>
              {#if b.id !== 'manual'}
                <button class="btn btn-quiet btn-small btn-danger" type="button" onclick={() => removeBatch(b)}>Supprimer</button>
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    </details>
  {/if}

  <p class="muted count">
    {rows.length.toLocaleString('fr-FR')} transaction{rows.length > 1 ? 's' : ''}{rows.length !== app.transactions.length
      ? ` sur ${app.transactions.length.toLocaleString('fr-FR')}`
      : ''}
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
        </tr>
      </thead>
      <tbody>
        {#each visible as tx (tx.id)}
          {@const problem = status(tx)}
          <!-- Clavier : bouton « Modifier » de la ligne. -->
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
          <tr class:flagged={problem !== null} class="editable" onclick={(e) => openFromRow(e, tx)}>
            <td class="date num">{dateFr(tx.date)}</td>
            <td>
              <button class={`type type-${tx.type}`} type="button" title="Modifier cette transaction" onclick={() => ui.edit(tx.id)}>{TRANSACTION_LABELS[tx.type]}</button>
              {#if tx.platform || tx.note}
                {@const detail = [tx.platform, tx.note].filter(Boolean).join(' · ')}
                <!-- Note sur une ligne ; texte complet au survol, au focus clavier ou au toucher. -->
                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                <span class="platform muted" title={tx.note ? detail : undefined} tabindex={tx.note ? 0 : undefined}>{detail}</span>
              {/if}
              {#if problem}<span class="problem">{problem}</span>{:else}{@const hint = info(tx)}{#if hint}<!-- svelte-ignore a11y_no_noninteractive_tabindex --><span class="info" title={hint} tabindex="0">{hint}</span>{/if}{/if}
            </td>
            <td class="num move">{movement(tx)}</td>
            <td class="num amount" data-label="Montant">{tx.eur ? eur(tx.eur) : '—'}</td>
            <td class="num muted fees" data-label="Frais">
              {#if tx.fee && Number(tx.fee.quantity) > 0}
                {tx.fee.asset === 'EUR' ? eur(tx.fee.quantity) : `${qty(tx.fee.quantity)} ${tx.fee.asset}`}
              {:else}—{/if}
            </td>

          </tr>
        {:else}
          <tr><td colspan="5" class="muted">Aucune transaction ne correspond à ces filtres.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if rows.length > limit}
    <div class="more">
      <button class="btn" type="button" onclick={() => (limit += PAGE)}>
        Afficher {Math.min(PAGE, rows.length - limit)} de plus
      </button>
      <span class="muted">{limit.toLocaleString('fr-FR')} affichées sur {rows.length.toLocaleString('fr-FR')}</span>
    </div>
  {/if}

  <p class="muted hint">Types disponibles : {creatable.map((t) => TRANSACTION_LABELS[t].toLowerCase()).join(', ')}.</p>
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
  .filters {
    align-items: end;
  }
  .filters .field {
    width: 13rem;
  }
  .flag-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.9rem;
    font-weight: 550;
    color: var(--warn);
    padding-bottom: 0.5rem;
    cursor: pointer;
  }
  .flag-toggle input {
    width: auto;
    accent-color: var(--warn);
  }
  .add {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .more {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    font-size: 0.88rem;
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
    font: inherit;
    font-weight: 600;
    display: block;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .type:hover {
    text-decoration: underline;
  }
  .type:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .type-sell,
  .type-payment {
    color: var(--accent);
  }
  .type-margin {
    color: var(--muted);
  }
  .imports summary {
    cursor: pointer;
    color: var(--muted);
    font-weight: 550;
    padding-block: 0.2rem;
  }
  .imports ul {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  .imports li {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 0.4rem 1rem;
    padding: 0.55rem 0.9rem;
    border-top: 1px solid var(--rule);
  }
  .imports li:first-child {
    border-top: 0;
  }
  .imp-main {
    display: grid;
    min-width: 0;
  }
  .imp-main .muted {
    font-size: 0.82rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .imp-count {
    font-size: 0.88rem;
    color: var(--muted);
  }
  .imp-actions {
    display: flex;
    gap: 0.2rem;
  }
  @media (max-width: 640px) {
    .imports li {
      grid-template-columns: 1fr auto;
    }
    .imp-count {
      grid-column: 1;
    }
  }
  .platform {
    display: block;
    max-width: min(22rem, 30vw);
    font-size: 0.8rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: default;
  }
  .info {
    max-width: min(22rem, 30vw);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .info:focus,
  .platform[tabindex]:focus {
    white-space: normal;
    overflow: visible;
    outline: none;
    color: var(--ink);
  }
  .info:focus-visible,
  .platform[tabindex]:focus-visible {
    outline: 2px solid var(--focus, currentColor);
    outline-offset: 2px;
  }
  .info {
    display: block;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .problem {
    display: block;
    font-size: 0.8rem;
    color: var(--warn);
  }
  tr.editable {
    cursor: pointer;
  }
  tr.editable:hover > * {
    background: var(--hover, color-mix(in srgb, var(--ink) 4%, transparent));
  }
  tr.flagged td:first-child {
    box-shadow: inset 3px 0 0 var(--warn);
  }
  .move {
    white-space: pre;
    font-size: 0.9rem;
  }
  .hint {
    font-size: 0.82rem;
  }

  @media (max-width: 1000px) {
    .filters,
    .filters .field,
    .add {
      width: 100%;
    }
    .add .btn {
      flex: 1;
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
    .platform,
    .info {
      max-width: 100%;
    }
    .amount::before,
    .fees::before {
      content: attr(data-label) ' : ';
      color: var(--muted);
      font-size: 0.85rem;
    }
    tr.flagged td:first-child {
      box-shadow: none;
    }
    tr.flagged {
      box-shadow: inset 3px 0 0 var(--warn);
    }
  }
</style>
