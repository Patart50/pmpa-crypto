<script lang="ts">
  import { app } from '../state/app.svelte';
  import { ui } from './ui.svelte';

  let menu: HTMLDetailsElement;
  let fileInput: HTMLInputElement;
  let importErrors = $state<string[]>([]);

  function closeMenu() {
    menu.open = false;
  }

  function exportFile() {
    const { fileName, content } = app.exportBackup();
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    closeMenu();
    ui.notify('Sauvegarde exportée.');
  }

  function chooseFile() {
    closeMenu();
    fileInput.click();
  }

  async function onFile(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    fileInput.value = '';
    if (!file) return;
    if (app.transactions.length > 0 && !confirm('Importer cette sauvegarde remplacera toutes vos données actuelles. Continuer ?')) return;
    const text = await file.text();
    const outcome = await app.track('Importer une sauvegarde', () => app.importBackup(text));
    if (outcome.ok) {
      importErrors = [];
      ui.notify(
        outcome.issueCount > 0
          ? `${outcome.count} transactions importées, dont ${outcome.issueCount} à corriger.`
          : `${outcome.count} transactions importées.`,
        { undo: true },
      );
    } else {
      importErrors = outcome.errors;
    }
  }

  async function clearAll() {
    closeMenu();
    if (!confirm('Effacer toutes les transactions et réglages de cet appareil ? Pensez à exporter une sauvegarde avant.')) return;
    await app.track('Tout effacer', () => app.clearAll());
    ui.notify('Données effacées.', { undo: true });
  }

  async function undoLast() {
    closeMenu();
    const label = await app.undo();
    ui.notify(label ? `Annulé : ${label}.` : 'Rien à annuler.');
  }
</script>

<details class="menu" bind:this={menu}>
  <summary class="btn btn-quiet">Sauvegarde</summary>
  <div class="menu-pop" role="menu">
    {#if app.history.length > 0}
      <button type="button" role="menuitem" onclick={undoLast}>
        Annuler : {app.history[app.history.length - 1].label}
        <small>{app.history.length} action{app.history.length > 1 ? 's' : ''} annulable{app.history.length > 1 ? 's' : ''} · Ctrl+Z · perdu au rechargement</small>
      </button>
    {/if}
    <button type="button" role="menuitem" onclick={exportFile} disabled={app.transactions.length === 0}>
      Exporter une sauvegarde
      <small>Fichier JSON à garder en lieu sûr</small>
    </button>
    <button type="button" role="menuitem" onclick={chooseFile}>
      Importer une sauvegarde
      <small>Remplace les données de cet appareil</small>
    </button>
    <button type="button" role="menuitem" class="danger" onclick={clearAll} disabled={app.transactions.length === 0}>
      Tout effacer
    </button>
  </div>
</details>
<input bind:this={fileInput} type="file" accept="application/json,.json" class="sr-only" tabindex="-1" onchange={onFile} />

{#if importErrors.length > 0}
  <div class="import-errors" role="alert">
    <p><strong>Import impossible.</strong> Aucune donnée n'a été modifiée.</p>
    <ul>
      {#each importErrors.slice(0, 6) as error}<li>{error}</li>{/each}
    </ul>
    {#if importErrors.length > 6}<p class="muted">… et {importErrors.length - 6} autres erreurs.</p>{/if}
    <button class="btn btn-small" type="button" onclick={() => (importErrors = [])}>Fermer</button>
  </div>
{/if}

<style>
  .menu {
    position: relative;
  }
  .menu summary {
    list-style: none;
  }
  .menu summary::-webkit-details-marker {
    display: none;
  }
  .menu summary::after {
    content: '';
    width: 0.4rem;
    height: 0.4rem;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: translateY(-2px) rotate(45deg);
    margin-left: 0.2rem;
  }
  .menu-pop {
    position: absolute;
    right: 0;
    top: calc(100% + 0.35rem);
    z-index: 20;
    width: 17rem;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
    padding: 0.35rem;
    display: grid;
  }
  .menu-pop button {
    display: grid;
    text-align: left;
    gap: 0.1rem;
    font: inherit;
    font-weight: 550;
    background: none;
    border: 0;
    color: var(--ink);
    padding: 0.55rem 0.65rem;
    border-radius: var(--radius);
    cursor: pointer;
  }
  .menu-pop button:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .menu-pop button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .menu-pop small {
    font-weight: 400;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .menu-pop .danger {
    color: var(--loss);
    border-top: 1px solid var(--rule);
    border-radius: 0 0 var(--radius) var(--radius);
    margin-top: 0.25rem;
  }
  .import-errors {
    position: fixed;
    top: 1rem;
    right: 1rem;
    left: 1rem;
    margin-inline: auto;
    max-width: 30rem;
    z-index: 40;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-left: 3px solid var(--loss);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
    padding: 1rem;
    display: grid;
    gap: 0.5rem;
    font-size: 0.9rem;
  }
  .import-errors ul {
    margin: 0;
    padding-left: 1.1rem;
  }
  .import-errors .btn {
    justify-self: start;
  }
</style>
