<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from './lib/state/app.svelte';
  import Portfolio from './lib/ui/Portfolio.svelte';
  import Transactions from './lib/ui/Transactions.svelte';
  import Fiscal from './lib/ui/Fiscal.svelte';
  import BackupMenu from './lib/ui/BackupMenu.svelte';
  import ThemeToggle from './lib/ui/ThemeToggle.svelte';
  import TransactionForm from './lib/ui/TransactionForm.svelte';
  import { ui } from './lib/ui/ui.svelte';

  const views = [
    { id: 'portefeuille', label: 'Portefeuille' },
    { id: 'transactions', label: 'Transactions' },
    { id: 'fiscalite', label: 'Fiscalité' },
  ] as const;
  type ViewId = (typeof views)[number]['id'];

  const readHash = (): ViewId => {
    const id = location.hash.replace('#', '');
    return (views.find((v) => v.id === id)?.id ?? 'portefeuille') as ViewId;
  };

  let view = $state<ViewId>(readHash());

  onMount(() => {
    app.init();
    const onHash = () => (view = readHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  });

  $effect(() => {
    const theme = app.settings.theme ?? 'auto';
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  });

  const txCount = $derived(app.transactions.length);
  const fiscalAlerts = $derived(app.fiscal.ok ? app.fiscal.result.issues.filter((i) => i.code === 'MISSING_PORTFOLIO_VALUE').length : 0);
</script>

<header class="top">
  <div class="top-inner">
    <a class="brand" href="#portefeuille" aria-label="pmpa-crypto, accueil">
      <span class="brand-name">pmpa-crypto</span>
      <span class="brand-tag">Prix moyen et plus-values crypto, méthode fiscale française</span>
    </a>
    <div class="top-actions">
      <span class="local" title="Aucune donnée n'est envoyée sur Internet">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"
          ><path
            d="M8 1.5 2.5 3.8v3.7c0 3.2 2.3 6 5.5 7 3.2-1 5.5-3.8 5.5-7V3.8L8 1.5Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linejoin="round"
          /></svg
        >
        {app.memoryOnly ? 'Non sauvegardé' : 'Sur cet appareil'}
      </span>
      <BackupMenu />
      <ThemeToggle />
    </div>
  </div>
  <nav class="tabs" aria-label="Sections">
    {#each views as v}
      <a href={`#${v.id}`} aria-current={view === v.id ? 'page' : undefined}>
        {v.label}
        {#if v.id === 'transactions' && txCount > 0}<span class="count num">{txCount}</span>{/if}
        {#if v.id === 'fiscalite' && fiscalAlerts > 0}<span class="count alert num" title="Cessions à compléter">{fiscalAlerts}</span>{/if}
      </a>
    {/each}
  </nav>
</header>

<main>
  {#if app.memoryOnly}
    <p class="notice" role="status">
      <strong>Stockage indisponible.</strong>
      Ce navigateur bloque le stockage local (navigation privée ?). Vos saisies seront perdues à la fermeture de l'onglet : exportez une
      sauvegarde avant de partir.
    </p>
  {/if}

  {#if !app.ready}
    <p class="muted loading">Chargement de vos données…</p>
  {:else if view === 'portefeuille'}
    <Portfolio />
  {:else if view === 'transactions'}
    <Transactions />
  {:else}
    <Fiscal />
  {/if}
</main>

<footer class="foot">
  <p>
    Outil d'aide au calcul, pas un conseil fiscal. Vérifiez vos déclarations. Code source libre (AGPL-3.0) sur
    <a href="https://github.com/Patart50/pmpa-crypto" rel="noopener" target="_blank">GitHub</a>.
  </p>
</footer>

{#if ui.editing !== null}
  <TransactionForm initial={ui.editing === 'new' ? undefined : app.find(ui.editing)} preset={ui.preset} onclose={() => ui.close()} />
{/if}

{#if ui.toast}
  <div class="toast" role="status" aria-live="polite">{ui.toast}</div>
{/if}

<style>
  .top {
    background: var(--surface);
    border-bottom: 1px solid var(--rule);
  }
  .top-inner,
  .tabs,
  main,
  .foot {
    max-width: 74rem;
    margin: 0 auto;
    padding-inline: 1rem;
  }
  .top-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding-block: 0.9rem 0.6rem;
    flex-wrap: wrap;
  }
  .brand {
    display: grid;
    text-decoration: none;
    color: var(--ink);
  }
  .brand-name {
    font-family: var(--font-doc);
    font-size: 1.45rem;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .brand-tag {
    font-size: 0.82rem;
    color: var(--muted);
  }
  .top-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .local {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.82rem;
    color: var(--gain);
    padding-inline: 0.4rem;
  }
  .tabs {
    display: flex;
    gap: 0.25rem;
    overflow-x: auto;
  }
  .tabs a {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.55rem 0.8rem 0.65rem;
    color: var(--muted);
    text-decoration: none;
    font-weight: 550;
    border-bottom: 2px solid transparent;
    white-space: nowrap;
  }
  .tabs a:hover {
    color: var(--ink);
  }
  .tabs a[aria-current='page'] {
    color: var(--ink);
    border-bottom-color: var(--accent);
  }
  .count {
    font-size: 0.75rem;
    min-width: 1.4rem;
    text-align: center;
    padding: 0 0.35rem;
    border-radius: 999px;
    background: var(--surface-2);
    border: 1px solid var(--rule);
    color: var(--muted);
  }
  .count.alert {
    background: var(--warn-bg);
    border-color: transparent;
    color: var(--warn);
  }
  main {
    padding-block: 1.75rem 3rem;
    display: grid;
    gap: 1.25rem;
  }
  .loading {
    padding-block: 3rem;
  }
  .foot {
    padding-block: 0 2.5rem;
    font-size: 0.82rem;
    color: var(--muted);
  }
  .foot p {
    border-top: 1px solid var(--rule);
    padding-top: 1.5rem;
  }
  .toast {
    position: fixed;
    left: 50%;
    bottom: 1.25rem;
    transform: translateX(-50%);
    background: var(--ink);
    color: var(--paper);
    padding: 0.6rem 1rem;
    border-radius: var(--radius);
    box-shadow: var(--shadow-pop);
    font-size: 0.92rem;
    z-index: 50;
    max-width: calc(100vw - 2rem);
  }
  @media (max-width: 640px) {
    .brand-tag {
      display: none;
    }
    .local {
      display: none;
    }
  }
</style>
