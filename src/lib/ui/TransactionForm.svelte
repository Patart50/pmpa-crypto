<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { app } from '../state/app.svelte';
  import { holdingsBefore } from '../core/portfolio';
  import { TRANSACTION_LABELS, TRANSACTION_TYPES, type Transaction, type TransactionType } from '../core/transactions';
  import { buildTransaction, draftFrom, emptyDraft, FIELDS, type Draft, type DraftErrors } from './draft';
  import { ui } from './ui.svelte';
  import ValueEstimator from './ValueEstimator.svelte';

  interface Props {
    initial?: Transaction;
    preset?: TransactionType;
    onclose: () => void;
  }
  let { initial, preset, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // Le formulaire est monté pour une transaction donnée : valeurs initiales figées.
  const start = untrack(() => ({ initial, preset }));
  let draft = $state<Draft>(start.initial ? draftFrom(start.initial) : emptyDraft(start.preset ?? 'buy'));
  let errors = $state<DraftErrors>({});
  let showEstimator = $state(false);
  let saving = $state(false);

  const isEdit = start.initial !== undefined;
  const types = TRANSACTION_TYPES.filter((t) => t !== 'margin' || start.initial?.type === 'margin');
  const shows = (key: keyof Draft) => FIELDS[draft.type].includes(key);

  const knownAssets = $derived(
    [...new Set(app.transactions.flatMap((t) => [t.in?.asset, t.out?.asset, t.fee?.asset].filter((a): a is string => !!a)))].sort(),
  );

  const eurLabel = $derived(
    {
      buy: 'Montant payé, hors frais',
      sell: 'Montant reçu, avant frais',
      swap: "Valeur de l'échange en euros (facultatif)",
      payment: 'Valeur du bien ou service payé',
      gift: 'Valeur en euros (facultatif, pour mémoire)',
      reward: 'Valeur à la réception (facultatif)',
      transfer: '',
      margin: '',
    }[draft.type],
  );

  const holdings = $derived.by(() => {
    if (!showEstimator) return new Map();
    const probeId = '__estimation__';
    const others = app.transactions.filter((t) => t.id !== draft.id);
    return holdingsBefore([...others, { id: probeId, date: draft.date, type: 'transfer' }], probeId);
  });

  onMount(() => {
    dialog.showModal();
  });

  function close() {
    dialog.close();
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const built = buildTransaction($state.snapshot(draft));
    errors = built.errors;
    if (!built.tx) {
      const first = dialog.querySelector<HTMLElement>('[aria-invalid="true"]');
      first?.focus();
      return;
    }
    saving = true;
    const { id, ...rest } = built.tx;
    await app.save(id ? built.tx : rest);
    saving = false;
    ui.notify(isEdit ? 'Transaction modifiée.' : 'Transaction ajoutée.');
    close();
  }

  function useEstimate(value: string) {
    draft.portfolioValue = value.replace('.', ',');
    showEstimator = false;
  }
</script>

<dialog bind:this={dialog} onclose={onclose} aria-labelledby="tx-form-title">
  <form onsubmit={submit} novalidate>
    <header>
      <h2 id="tx-form-title">{isEdit ? 'Modifier la transaction' : 'Nouvelle transaction'}</h2>
      <button class="btn btn-quiet" type="button" onclick={close} aria-label="Fermer">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"
          ><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg
        >
      </button>
    </header>

    <div class="body">
      <fieldset class="types">
        <legend>Opération</legend>
        <div class="type-grid">
          {#each types as t}
            <label class="type-option" class:selected={draft.type === t}>
              <input type="radio" name="type" value={t} bind:group={draft.type} />
              {TRANSACTION_LABELS[t]}
            </label>
          {/each}
        </div>
      </fieldset>

      {#if draft.type === 'margin'}
        <p class="notice"><span>Les opérations sur marge ne sont pas prises en compte dans les calculs. Elles sont conservées pour mémoire.</span></p>
      {/if}

      <label class="field">
        <span>Date et heure</span>
        <input type="datetime-local" bind:value={draft.date} aria-invalid={!!errors.date} required />
        {#if errors.date}<small class="error">{errors.date}</small>{/if}
      </label>

      {#if shows('outAsset')}
        <div class="pair">
          <label class="field">
            <span>{draft.type === 'swap' ? 'Actif cédé' : draft.type === 'payment' ? 'Actif utilisé' : draft.type === 'gift' ? 'Actif donné ou sorti' : 'Actif vendu'}</span>
            <input list="assets" autocapitalize="characters" placeholder="BTC" bind:value={draft.outAsset} aria-invalid={!!errors.outAsset} />
            {#if errors.outAsset}<small class="error">{errors.outAsset}</small>{/if}
          </label>
          <label class="field">
            <span>Quantité</span>
            <input inputmode="decimal" placeholder="0,01" bind:value={draft.outQty} aria-invalid={!!errors.outQty} />
            {#if errors.outQty}<small class="error">{errors.outQty}</small>{/if}
          </label>
        </div>
      {/if}

      {#if shows('inAsset')}
        <div class="pair">
          <label class="field">
            <span>{draft.type === 'reward' ? 'Actif reçu en récompense' : draft.type === 'swap' ? 'Actif reçu' : 'Actif acheté'}</span>
            <input list="assets" autocapitalize="characters" placeholder="ETH" bind:value={draft.inAsset} aria-invalid={!!errors.inAsset} />
            {#if errors.inAsset}<small class="error">{errors.inAsset}</small>{/if}
          </label>
          <label class="field">
            <span>Quantité reçue</span>
            <input inputmode="decimal" placeholder="0,5" bind:value={draft.inQty} aria-invalid={!!errors.inQty} />
            {#if errors.inQty}<small class="error">{errors.inQty}</small>{/if}
          </label>
        </div>
      {/if}

      {#if shows('movedAsset')}
        <div class="pair">
          <label class="field">
            <span>Actif transféré (facultatif)</span>
            <input list="assets" autocapitalize="characters" bind:value={draft.movedAsset} aria-invalid={!!errors.movedAsset} />
            {#if errors.movedAsset}<small class="error">{errors.movedAsset}</small>{/if}
          </label>
          <label class="field">
            <span>Quantité</span>
            <input inputmode="decimal" bind:value={draft.movedQty} aria-invalid={!!errors.movedQty} />
            {#if errors.movedQty}<small class="error">{errors.movedQty}</small>{/if}
          </label>
        </div>
        <p class="hint">Un transfert entre vos propres comptes ou wallets n'a aucun effet fiscal. Seuls les frais réseau réduisent votre solde.</p>
      {/if}

      {#if shows('eur')}
        <label class="field">
          <span>{eurLabel}</span>
          <div class="suffix">
            <input inputmode="decimal" placeholder="0,00" bind:value={draft.eur} aria-invalid={!!errors.eur} />
            <span aria-hidden="true">€</span>
          </div>
          {#if errors.eur}<small class="error">{errors.eur}</small>{:else if draft.type === 'gift'}<small
              >Envoi à un proche, perte d'accès, piratage : l'actif quitte votre portefeuille sans être vendu, donc sans plus-value.</small
            >{:else if draft.type === 'swap'}<small
              >Sans valeur, le coût de l'actif cédé est reporté sur l'actif reçu. Un échange n'est jamais imposable.</small
            >{/if}
        </label>
      {/if}

      {#if shows('fiscalCost')}
        <label class="field">
          <span>Prix d'acquisition fiscal</span>
          <div class="suffix">
            <input inputmode="decimal" placeholder="0,00" bind:value={draft.fiscalCost} aria-invalid={!!errors.fiscalCost} />
            <span aria-hidden="true">€</span>
          </div>
          {#if errors.fiscalCost}<small class="error">{errors.fiscalCost}</small>{:else}<small
              >0 € par défaut : la récompense n'augmente pas votre prix d'acquisition déclaré.</small
            >{/if}
        </label>
      {/if}

      {#if shows('portfolioValue')}
        <div class="field">
          <label for="pv">Valeur totale de votre portefeuille crypto juste avant cette cession</label>
          <div class="suffix">
            <input id="pv" inputmode="decimal" placeholder="0,00" bind:value={draft.portfolioValue} aria-invalid={!!errors.portfolioValue} />
            <span aria-hidden="true">€</span>
          </div>
          {#if errors.portfolioValue}
            <small class="error">{errors.portfolioValue}</small>
          {:else}
            <small>Tous vos actifs numériques, toutes plateformes et wallets confondus. Requis pour le calcul de la plus-value.</small>
          {/if}
          <button class="btn btn-small estimate-btn" type="button" onclick={() => (showEstimator = !showEstimator)} aria-expanded={showEstimator}>
            {showEstimator ? "Masquer l'aide au calcul" : 'Calculer à partir des prix du jour de la cession'}
          </button>
          {#if showEstimator}
            <ValueEstimator {holdings} date={draft.date} onuse={useEstimate} />
          {/if}
        </div>
      {/if}

      {#if draft.type !== 'margin'}
        <fieldset class="fees">
          <legend>Frais (facultatif)</legend>
          <div class="fee-grid">
            <label class="field">
              <span>Payés en</span>
              <input list="fee-assets" autocapitalize="characters" bind:value={draft.feeAsset} aria-invalid={!!errors.feeAsset} />
            </label>
            <label class="field">
              <span>Montant</span>
              <input inputmode="decimal" placeholder="0" bind:value={draft.feeQty} aria-invalid={!!errors.feeQty} />
              {#if errors.feeQty}<small class="error">{errors.feeQty}</small>{/if}
            </label>
            {#if draft.feeAsset.trim().toUpperCase() !== 'EUR' && draft.feeAsset.trim() !== ''}
              <label class="field">
                <span>Contre-valeur €</span>
                <input inputmode="decimal" placeholder="facultatif" bind:value={draft.feeEur} aria-invalid={!!errors.feeEur} />
                {#if errors.feeEur}<small class="error">{errors.feeEur}</small>{/if}
              </label>
            {/if}
          </div>
        </fieldset>
      {/if}

      <div class="pair">
        <label class="field">
          <span>Plateforme (facultatif)</span>
          <input bind:value={draft.platform} placeholder="Kraken, Ledger…" />
        </label>
        <label class="field">
          <span>Note (facultatif)</span>
          <input bind:value={draft.note} />
        </label>
      </div>
    </div>

    <footer>
      <button class="btn" type="button" onclick={close}>Annuler</button>
      <button class="btn btn-primary" type="submit" disabled={saving}>{isEdit ? 'Enregistrer les modifications' : 'Ajouter la transaction'}</button>
    </footer>
  </form>

  <datalist id="assets">
    {#each knownAssets.filter((a) => a !== 'EUR') as a}<option value={a}></option>{/each}
  </datalist>
  <datalist id="fee-assets">
    <option value="EUR"></option>
    {#each knownAssets.filter((a) => a !== 'EUR') as a}<option value={a}></option>{/each}
  </datalist>
</dialog>

<style>
  dialog {
    border: 0;
    padding: 0;
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--ink);
    width: min(40rem, calc(100vw - 1.5rem));
    max-height: calc(100dvh - 1.5rem);
    box-shadow: var(--shadow-pop);
  }
  dialog::backdrop {
    background: rgb(15 21 33 / 0.45);
  }
  form {
    display: flex;
    flex-direction: column;
    max-height: calc(100dvh - 1.5rem);
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
    padding: 1rem 1.15rem 1.25rem;
    display: grid;
    gap: 1rem;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
  }
  legend {
    font-size: 0.85rem;
    font-weight: 550;
    margin-bottom: 0.4rem;
    padding: 0;
  }
  .type-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: 0.35rem;
  }
  .type-option {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    font-size: 0.88rem;
    cursor: pointer;
  }
  .type-option input {
    width: auto;
    accent-color: var(--accent);
    margin: 0;
  }
  .type-option.selected {
    border-color: var(--accent);
    background: var(--accent-soft);
    font-weight: 600;
  }
  .type-option:has(input:focus-visible) {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }
  .field > label {
    font-size: 0.85rem;
    font-weight: 550;
  }
  .suffix {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .suffix span {
    color: var(--muted);
  }
  .hint {
    font-size: 0.82rem;
    color: var(--muted);
    margin-top: -0.5rem;
  }
  .estimate-btn {
    justify-self: start;
    margin-top: 0.2rem;
  }
  .fee-grid {
    display: grid;
    grid-template-columns: 7rem 1fr 1fr;
    gap: 0.75rem;
  }
  @media (max-width: 560px) {
    .pair,
    .fee-grid {
      grid-template-columns: 1fr;
    }
    dialog {
      width: 100vw;
      max-width: 100vw;
      max-height: 100dvh;
      height: 100dvh;
      border-radius: 0;
      margin: 0;
    }
    form {
      max-height: 100dvh;
      height: 100%;
    }
    .body {
      flex: 1;
    }
  }
</style>
