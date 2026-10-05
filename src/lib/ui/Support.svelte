<script lang="ts">
  /**
   * Bouton discret « Soutenir le projet » et sa fenêtre : GitHub Sponsors et
   * adresses crypto avec QR codes générés dans le navigateur (aucun appel réseau).
   */
  import QRCode from 'qrcode';
  import { DONATION_ADDRESSES, SPONSORS_URL } from '../support';

  let dialog: HTMLDialogElement;
  let qrs = $state<Record<string, string>>({});
  let copied = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function open() {
    dialog.showModal();
    if (Object.keys(qrs).length === 0) {
      const entries = await Promise.all(
        DONATION_ADDRESSES.map(async (a) => [a.id, await QRCode.toString(a.qr, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })] as const),
      );
      qrs = Object.fromEntries(entries);
    }
  }

  async function copy(id: string, address: string, event: MouseEvent) {
    try {
      await navigator.clipboard.writeText(address);
      copied = id;
    } catch {
      // Repli : sélectionner l'adresse pour une copie manuelle.
      const code = (event.currentTarget as HTMLElement).closest('.addr')?.querySelector('code');
      if (code) getSelection()?.selectAllChildren(code);
    }
    clearTimeout(timer);
    timer = setTimeout(() => (copied = null), 2000);
  }
</script>

<!-- Aucun espace entre le bouton et la fenêtre : le lien s'insère dans une phrase sans espace parasite. -->
<button class="support-link" type="button" onclick={open}>Soutenir le projet</button><dialog bind:this={dialog} aria-labelledby="support-title">
  <header>
    <h2 id="support-title">Soutenir le projet</h2>
    <button class="btn btn-quiet" type="button" onclick={() => dialog.close()} aria-label="Fermer">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"
        ><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg
      >
    </button>
  </header>
  <div class="body">
    <p>
      L'outil est gratuit, sans publicité ni compte, et le restera. S'il vous fait gagner du temps sur votre déclaration, un soutien aide à le
      maintenir et à suivre les évolutions fiscales.
    </p>

    <a class="sponsor" href={SPONSORS_URL} target="_blank" rel="noopener">
      <strong>GitHub Sponsors</strong>
      <span class="muted">Par carte bancaire, ponctuel ou mensuel</span>
    </a>

    <h3>En crypto</h3>
    <div class="addresses">
      {#each DONATION_ADDRESSES as a (a.id)}
        <section class="addr">
          <div class="qr" aria-hidden="true">
            {#if qrs[a.id]}{@html qrs[a.id]}{/if}
          </div>
          <div class="details">
            <h4>{a.label}</h4>
            <p class="networks">{a.networks}</p>
            <code>{a.address}</code>
            <button class="btn btn-small" type="button" onclick={(e) => copy(a.id, a.address, e)}>
              {copied === a.id ? 'Adresse copiée' : 'Copier l’adresse'}
            </button>
            <p class="warning">{a.warning}</p>
          </div>
        </section>
      {/each}
    </div>
    <p class="muted small">Vérifiez toujours les premiers et derniers caractères de l'adresse collée avant d'envoyer. Merci !</p>
  </div>
</dialog>

<style>
  .support-link {
    font: inherit;
    font-size: inherit;
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
  }
  dialog {
    border: 0;
    padding: 0;
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--ink);
    width: min(36rem, calc(100vw - 1.5rem));
    max-height: calc(100dvh - 1.5rem);
    box-shadow: var(--shadow-pop);
  }
  dialog::backdrop {
    background: rgb(15 21 33 / 0.45);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.9rem 1.15rem;
    border-bottom: 1px solid var(--rule);
  }
  header h2 {
    font-size: 1.25rem;
  }
  .body {
    padding: 1rem 1.15rem 1.25rem;
    display: grid;
    gap: 0.9rem;
    font-size: 0.92rem;
  }
  .sponsor {
    display: grid;
    gap: 0.1rem;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    color: var(--ink);
    text-decoration: none;
  }
  .sponsor:hover {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .sponsor strong {
    color: var(--accent);
  }
  .sponsor span {
    font-size: 0.85rem;
  }
  h3 {
    font-size: 1.02rem;
    margin-bottom: -0.3rem;
  }
  .addresses {
    display: grid;
    gap: 0.75rem;
  }
  .addr {
    display: grid;
    grid-template-columns: 7.5rem minmax(0, 1fr);
    gap: 0.9rem;
    align-items: start;
    padding: 0.75rem;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
  }
  /* QR toujours noir sur blanc, lisible par les wallets dans les deux thèmes. */
  .qr {
    width: 7.5rem;
    aspect-ratio: 1;
    background: #ffffff;
    border-radius: 4px;
  }
  .qr :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .details {
    display: grid;
    gap: 0.3rem;
    min-width: 0;
  }
  h4 {
    margin: 0;
    font-size: 0.98rem;
    font-weight: 650;
  }
  .networks {
    font-size: 0.82rem;
    color: var(--muted);
  }
  code {
    font-size: 0.82rem;
    overflow-wrap: anywhere;
    background: var(--surface-2);
    padding: 0.35rem 0.45rem;
    border-radius: 4px;
    user-select: all;
  }
  .details .btn {
    justify-self: start;
  }
  .warning {
    font-size: 0.78rem;
    color: var(--warn);
  }
  .small {
    font-size: 0.82rem;
  }
  @media (max-width: 480px) {
    .addr {
      grid-template-columns: 1fr;
    }
    .qr {
      width: 9rem;
      justify-self: center;
    }
  }
</style>
