<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../../state/app.svelte';
  import { detectFile, type DetectedFile } from '../../import';
  import { parseBinanceLedger } from '../../import/binance';
  import { parseGeneric, pmpaOptions } from '../../import/generic';
  import type { ImportReport } from '../../import/common';
  import { TRANSACTION_LABELS, validateTransaction, type Transaction, type TransactionType } from '../../core/transactions';
  import { dateFr } from '../format';
  import { ui } from '../ui.svelte';
  import GenericMapper from './GenericMapper.svelte';
  import OffsetSelect from './OffsetSelect.svelte';

  interface Props {
    onclose: () => void;
  }
  let { onclose }: Props = $props();

  type Entry = { file: DetectedFile; report?: ImportReport; offset: number | null };

  let dialog: HTMLDialogElement;
  let step = $state<'pick' | 'configure' | 'review' | 'done'>('pick');
  let entries = $state<Entry[]>([]);
  let reading = $state(false);
  let dragOver = $state(false);
  let importing = $state(false);
  let result = $state<{ added: Transaction[]; duplicates: number } | null>(null);

  onMount(() => dialog.showModal());

  function close() {
    dialog.close();
  }

  function analyse(entry: Entry): ImportReport | undefined {
    const f = entry.file;
    if (f.kind === 'binance') return parseBinanceLedger(f.table, { fileName: f.fileName, offsetMinutes: entry.offset ?? 0 });
    if (f.kind === 'pmpa') return parseGeneric(f.table, pmpaOptions(f.table, f.fileName));
    return undefined;
  }

  async function readFiles(list: FileList | File[] | null) {
    if (!list || list.length === 0) return;
    reading = true;
    const next: Entry[] = [];
    for (const file of Array.from(list)) {
      const detected = detectFile(await file.text(), file.name);
      const entry: Entry = { file: detected, offset: detected.kind === 'binance' ? (detected.offsetMinutes ?? 0) : null };
      entry.report = analyse(entry);
      next.push(entry);
    }
    entries = next;
    reading = false;
    step = pendingIndex() >= 0 ? 'configure' : 'review';
  }

  const pendingIndex = () => entries.findIndex((e) => e.file.kind === 'generic' && !e.report);
  const current = $derived(step === 'configure' ? entries[pendingIndex()] : undefined);

  function onMapped(report: ImportReport) {
    const i = pendingIndex();
    entries[i].report = report;
    step = pendingIndex() >= 0 ? 'configure' : 'review';
  }

  function skipCurrent() {
    const i = pendingIndex();
    entries[i].file = { kind: 'error', fileName: entries[i].file.fileName, message: 'Import annulé pour ce fichier.' };
    step = pendingIndex() >= 0 ? 'configure' : entries.some((e) => e.report) ? 'review' : 'pick';
  }

  function setOffset(index: number, offset: number | null) {
    if (entries[index].offset === offset) return;
    entries[index].offset = offset;
    entries[index].report = analyse(entries[index]);
  }

  const allTx = $derived(entries.flatMap((e) => e.report?.transactions ?? []));
  const existingIds = $derived(new Set(app.transactions.map((t) => t.id)));
  const fresh = $derived.by(() => {
    const seen = new Set<string>();
    return allTx.filter((t) => {
      if (existingIds.has(t.id) || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  });
  const duplicates = $derived(allTx.length - fresh.length);
  const toComplete = $derived(fresh.filter((t) => validateTransaction(t).length > 0).length);
  const cessionsWithoutValue = $derived(fresh.filter((t) => (t.type === 'sell' || t.type === 'payment') && !t.portfolioValueEur).length);

  const countByType = (txs: Transaction[]) => {
    const counts = new Map<TransactionType, number>();
    for (const t of txs) counts.set(t.type, (counts.get(t.type) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  };

  async function confirmImport() {
    importing = true;
    result = await app.addMany(fresh);
    importing = false;
    step = 'done';
  }

  async function undo() {
    if (!result) return;
    await app.removeMany(result.added.map((t) => t.id));
    ui.notify(`Import annulé : ${result.added.length} transactions retirées.`);
    close();
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    dragOver = false;
    readFiles(event.dataTransfer?.files ?? null);
  }
</script>

<dialog bind:this={dialog} {onclose} aria-labelledby="import-title">
  <header>
    <h2 id="import-title">Importer des transactions</h2>
    <button class="btn btn-quiet" type="button" onclick={close} aria-label="Fermer">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"
        ><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg
      >
    </button>
  </header>

  <div class="body">
    {#if step === 'pick'}
      <label
        class="drop"
        class:over={dragOver}
        ondragover={(e) => {
          e.preventDefault();
          dragOver = true;
        }}
        ondragleave={() => (dragOver = false)}
        ondrop={onDrop}
      >
        <input type="file" accept=".csv,text/csv" multiple class="sr-only" onchange={(e) => readFiles(e.currentTarget.files)} />
        <strong>{reading ? 'Lecture en cours…' : 'Choisir un ou plusieurs fichiers CSV'}</strong>
        <span class="muted">ou glissez-les ici. Ils sont lus dans ce navigateur, rien n'est envoyé.</span>
      </label>

      <div class="formats">
        <h3>Formats acceptés</h3>
        <dl>
          <div>
            <dt>Binance</dt>
            <dd>
              Export « Historique des transactions » : Portefeuille → Historique des transactions → Exporter. Plusieurs périodes peuvent être
              importées ensemble, les doublons sont écartés.
            </dd>
          </div>
          <div>
            <dt>Export pmpa-crypto</dt>
            <dd>Le CSV produit par le bouton « Exporter en CSV » de cet outil.</dd>
          </div>
          <div>
            <dt>Tout autre CSV</dt>
            <dd>Vous indiquez quelle colonne correspond à quoi : date, type, actifs, quantités, montant en euros, frais.</dd>
          </div>
        </dl>
        <p class="muted small">
          Votre plateforme n'est pas reconnue ? Aidez-nous à l'ajouter en
          <a href="https://github.com/Patart50/pmpa-crypto/issues/new?template=nouveau-format.yml" target="_blank" rel="noopener"
            >décrivant son format</a
          >, sans vos données personnelles.
        </p>
      </div>
    {:else if step === 'configure' && current && current.file.kind === 'generic'}
      {#key current.file.fileName}
        <GenericMapper table={current.file.table} fileName={current.file.fileName} onreport={onMapped} oncancel={skipCurrent} />
      {/key}
    {:else if step === 'review'}
      <div class="review">
        {#each entries as entry, i (entry.file.fileName + i)}
          <section class="file panel">
            <div class="file-head">
              <h3>{entry.file.fileName}</h3>
              {#if entry.report}<span class="muted">{entry.report.format}</span>{/if}
            </div>
            {#if entry.file.kind === 'error'}
              <p class="loss">{entry.file.message}</p>
            {:else if entry.report}
              {@const r = entry.report}
              <p class="muted small">
                {r.lineCount.toLocaleString('fr-FR')} lignes lues{#if r.period}, du {dateFr(r.period.from, false)} au {dateFr(r.period.to, false)}{/if}
              </p>
              {#if entry.file.kind === 'binance'}
                <div class="offset">
                  <OffsetSelect
                    allowParis={false}
                    label="Fuseau horaire de l'export"
                    hint={entry.file.offsetMinutes === null
                      ? 'Non indiqué dans le nom du fichier : vérifiez le fuseau choisi lors de l’export.'
                      : 'Lu dans le nom du fichier. Les dates sont converties à l’heure de Paris.'}
                    bind:value={() => entry.offset, (v) => setOffset(i, v)}
                  />
                </div>
              {/if}
              <ul class="types">
                {#each countByType(r.transactions) as [type, n]}<li><span class="num">{n.toLocaleString('fr-FR')}</span> {TRANSACTION_LABELS[type]}</li>{/each}
                {#if r.transactions.length === 0}<li class="muted">Aucune transaction reconnue.</li>{/if}
              </ul>
              {#if r.ignored.length > 0}
                <details>
                  <summary>{r.ignored.reduce((s, g) => s + g.lines, 0).toLocaleString('fr-FR')} lignes non importées</summary>
                  <ul class="ignored">
                    {#each r.ignored as g}
                      <li class:unknown={g.category === 'unknown' || g.category === 'ambiguous' || g.category === 'invalid'}>
                        <span class="num">{g.lines.toLocaleString('fr-FR')}</span>
                        <span>{g.label}{#if g.examples.length > 0}<small class="muted"> — ex. {g.examples.join(', ')}</small>{/if}</span>
                      </li>
                    {/each}
                  </ul>
                </details>
              {/if}
              {#each r.notes as note}<p class="note small">{note}</p>{/each}
            {/if}
          </section>
        {/each}

        <div class="totals">
          <p>
            <strong class="num">{fresh.length.toLocaleString('fr-FR')}</strong> nouvelle{fresh.length > 1 ? 's' : ''} transaction{fresh.length > 1 ? 's' : ''}
            {#if duplicates > 0}<span class="muted"> · {duplicates.toLocaleString('fr-FR')} déjà présente{duplicates > 1 ? 's' : ''}, écartée{duplicates > 1 ? 's' : ''}</span>{/if}
          </p>
          {#if toComplete > 0}<p class="small warn">{toComplete} à compléter après l'import (montant en euros manquant).</p>{/if}
          {#if cessionsWithoutValue > 0}
            <p class="small warn">
              {cessionsWithoutValue} vente{cessionsWithoutValue > 1 ? 's' : ''} contre euros : il faudra renseigner la valeur du portefeuille dans
              l'onglet Fiscalité.
            </p>
          {/if}
        </div>
      </div>
    {:else if step === 'done' && result}
      <div class="done">
        <h3>{result.added.length.toLocaleString('fr-FR')} transactions importées</h3>
        {#if result.duplicates > 0}<p class="muted">{result.duplicates} doublons écartés.</p>{/if}
        <p>Vérifiez les transactions signalées dans la liste, puis les cessions à compléter dans l'onglet Fiscalité.</p>
      </div>
    {/if}
  </div>

  {#if step === 'review'}
    <footer>
      <button class="btn" type="button" onclick={() => ((entries = []), (step = 'pick'))}>Choisir d'autres fichiers</button>
      <button class="btn btn-primary" type="button" disabled={fresh.length === 0 || importing} onclick={confirmImport}>
        {importing ? 'Import en cours…' : `Importer ${fresh.length.toLocaleString('fr-FR')} transaction${fresh.length > 1 ? 's' : ''}`}
      </button>
    </footer>
  {:else if step === 'done'}
    <footer>
      <button class="btn btn-danger" type="button" onclick={undo}>Annuler cet import</button>
      <a class="btn btn-primary" href="#transactions" onclick={close}>Voir les transactions</a>
    </footer>
  {/if}
</dialog>

<style>
  dialog {
    border: 0;
    padding: 0;
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--ink);
    width: min(48rem, calc(100vw - 1.5rem));
    max-height: calc(100dvh - 1.5rem);
    box-shadow: var(--shadow-pop);
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
  }
  dialog::backdrop {
    background: rgb(15 21 33 / 0.45);
  }
  header,
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.9rem 1.15rem;
  }
  header {
    border-bottom: 1px solid var(--rule);
  }
  header h2 {
    font-size: 1.25rem;
  }
  footer {
    border-top: 1px solid var(--rule);
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .body {
    overflow-y: auto;
    padding: 1.1rem 1.15rem 1.25rem;
    display: grid;
    gap: 1.25rem;
    min-height: 0;
  }
  .drop {
    display: grid;
    justify-items: center;
    gap: 0.35rem;
    text-align: center;
    padding: 2rem 1rem;
    border: 2px dashed var(--rule-strong);
    border-radius: var(--radius-lg);
    cursor: pointer;
    background: var(--surface-2);
  }
  .drop:hover,
  .drop.over,
  .drop:focus-within {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .drop strong {
    color: var(--accent);
    font-size: 1.02rem;
  }
  h3 {
    font-size: 1.02rem;
  }
  .formats {
    display: grid;
    gap: 0.6rem;
  }
  dl {
    margin: 0;
    display: grid;
    gap: 0.55rem;
  }
  dt {
    font-weight: 650;
  }
  dd {
    margin: 0.1rem 0 0;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .small {
    font-size: 0.85rem;
  }
  .review {
    display: grid;
    gap: 0.9rem;
  }
  .file {
    padding: 0.85rem 1rem;
    display: grid;
    gap: 0.5rem;
  }
  .file-head {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    align-items: baseline;
  }
  .file-head h3 {
    font-family: var(--font-ui);
    font-size: 0.92rem;
    font-weight: 650;
    overflow-wrap: anywhere;
  }
  .file-head span {
    font-size: 0.82rem;
  }
  .offset {
    max-width: 22rem;
  }
  .types,
  .ignored {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.2rem;
  }
  .types {
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 0.3rem 1rem;
  }
  .types li,
  .ignored li {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .types .num,
  .ignored .num {
    font-weight: 650;
    min-width: 2.8rem;
    text-align: right;
    flex: none;
  }
  .ignored li {
    font-size: 0.88rem;
  }
  .ignored li.unknown {
    color: var(--warn);
  }
  details summary {
    cursor: pointer;
    color: var(--muted);
    font-size: 0.9rem;
  }
  details[open] summary {
    margin-bottom: 0.4rem;
  }
  .note,
  .warn {
    color: var(--warn);
  }
  .totals {
    display: grid;
    gap: 0.25rem;
    padding-top: 0.25rem;
  }
  .totals strong {
    font-size: 1.2rem;
  }
  .done {
    display: grid;
    gap: 0.5rem;
    padding-block: 1rem;
  }
  .done h3 {
    font-size: 1.35rem;
  }
  a.btn {
    text-decoration: none;
  }
  @media (max-width: 560px) {
    dialog {
      width: 100vw;
      max-width: 100vw;
      height: 100dvh;
      max-height: 100dvh;
      border-radius: 0;
      margin: 0;
    }
    .body {
      flex: 1;
    }
  }
</style>
