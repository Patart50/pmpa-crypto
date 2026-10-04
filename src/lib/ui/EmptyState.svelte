<script lang="ts">
  import { app } from '../state/app.svelte';
  import { ui } from './ui.svelte';

  async function loadSample() {
    await app.loadSample();
    ui.notify('Exemple chargé. Effacez-le depuis le menu Sauvegarde quand vous voulez.');
  }
</script>

<section class="empty">
  <h1>Votre registre est vide</h1>
  <p>
    Saisissez vos achats et ventes de crypto : l'outil calcule votre prix moyen par actif et vos plus-values imposables selon la méthode
    française (article 150 VH bis), en tenant compte de tout votre portefeuille.
  </p>
  <p class="muted">Tout reste dans ce navigateur. Aucun compte, aucun envoi de données.</p>
  <div class="actions">
    <button class="btn btn-primary" type="button" onclick={() => ui.create('buy')}>Ajouter un premier achat</button>
    <button class="btn" type="button" onclick={() => (ui.importing = true)}>Importer un fichier CSV</button>
    <button class="btn btn-quiet" type="button" onclick={loadSample}>Voir un exemple</button>
  </div>
  <p class="muted small">
    Import des historiques Binance, Coinbase et Kraken, et de tout fichier CSV. Vous avez une sauvegarde de l'outil ? Importez-la depuis le menu Sauvegarde, en haut à
    droite.
  </p>
</section>

<style>
  .empty {
    display: grid;
    gap: 0.85rem;
    max-width: 38rem;
    padding-block: 2rem 1rem;
  }
  h1 {
    font-size: clamp(1.7rem, 4vw, 2.3rem);
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.4rem;
  }
  .small {
    font-size: 0.85rem;
  }
</style>
