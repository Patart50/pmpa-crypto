<script lang="ts">
  /** Page « À propos et limites » : ce que fait l'outil, ce qu'il envoie, sa méthode et ses limites connues. */
  const version = __APP_VERSION__;
  import { AUTHOR, SPONSORS_URL } from '../support';
  import Support from './Support.svelte';
  const repo = 'https://github.com/Patart50/pmpa-crypto';
</script>

<article class="about">
  <header>
    <h1>À propos et limites</h1>
    <p class="muted">pmpa-crypto {version} · logiciel libre (AGPL-3.0)</p>
  </header>

  <section>
    <h2>Ce que fait l'outil</h2>
    <ul>
      <li>Il suit chaque crypto que vous détenez : quantité, prix moyen pondéré des positions ouvertes et historique, coût, prix d'équilibre, plus-value latente.</li>
      <li>
        Il calcule vos plus-values imposables selon la méthode française (article 150 VH bis du CGI) : un calcul <strong>global</strong> sur tout le
        portefeuille, déclenché seulement par les ventes contre euros et les paiements en crypto. Les échanges entre cryptos ne sont pas imposables.
      </li>
      <li>Il prépare votre déclaration : formulaire 2086 en euros entiers, cases 3AN ou 3BN de la 2042 C, rappel du formulaire 3916-bis.</li>
      <li>Il importe les historiques Binance, Coinbase et Kraken, et tout autre CSV par association de colonnes.</li>
    </ul>
  </section>

  <section>
    <h2>Vos données</h2>
    <ul>
      <li>Tout est calculé et stocké dans ce navigateur, sur cet appareil. Pas de compte, pas de serveur, pas de mesure d'audience. L'outil marche hors ligne une fois chargé.</li>
      <li>
        <strong>Une seule exception, avec votre accord :</strong> pour les prix (valeur du portefeuille avant chaque vente, prix du jour, montants à
        calculer, conversion des dollars en euros), l'outil interroge l'API publique de Binance. Il n'envoie que des noms de paires (« BTCEUR ») et des
        heures, jamais vos quantités ni vos montants. Binance voit votre adresse IP.
      </li>
      <li>Exportez régulièrement une sauvegarde (menu Sauvegarde) : effacer les données du navigateur efface vos transactions.</li>
    </ul>
  </section>

  <section>
    <h2>Méthode de calcul</h2>
    <p>
      Pour chaque cession : plus-value = prix de cession − frais − prix total d'acquisition × prix de cession ÷ valeur globale du portefeuille. Le prix
      total d'acquisition est la somme de vos achats en euros, diminuée des fractions déjà utilisées par les cessions précédentes. Le moteur est vérifié
      sur les exemples officiels du BOFiP. Les détails et chaque choix d'interprétation sont publiés dans le
      <a href={`${repo}/blob/main/docs/DECISIONS.md`} target="_blank" rel="noopener">journal des décisions</a>.
    </p>
  </section>

  <section>
    <h2>Limites connues</h2>
    <ul>
      <li><strong>Marge et dérivés</strong> : non qualifiés fiscalement, ils ne sont pas calculés. Les positions sorties via la marge sont retirées du suivi sans effet fiscal.</li>
      <li><strong>Valeur du portefeuille</strong> : calculée à partir des positions connues. Les cryptos détenues ailleurs (wallet personnel, plateforme non importée) doivent être ajoutées à la main.</li>
      <li><strong>Dollars</strong> : convertis en euros au cours EUR/USDT de Binance, l'USD étant assimilé à l'USDT (écart de l'ordre de 0,1 %).</li>
      <li><strong>Arrondis du 2086</strong> : chaque montant saisi est arrondi à l'euro ; le résultat peut différer de quelques euros du calcul exact au centime.</li>
      <li><strong>Seuil de 305 €</strong> : apprécié sur les prix de cession bruts ; un cas limite est signalé quand le formulaire, qui part des prix nets de frais, pourrait conclure autrement.</li>
      <li><strong>Non pris en charge</strong> : échanges avec soulte, option pour le barème progressif, minage et activités professionnelles, NFT.</li>
      <li><strong>Kraken</strong> : import écrit d'après la documentation, pas encore vérifié sur un historique réel.</li>
    </ul>
  </section>

  <section>
    <h2>Avertissement</h2>
    <p>
      Outil d'aide au calcul, pas un conseil fiscal. Vous restez responsable de votre déclaration : vérifiez les montants, et faites-vous accompagner
      en cas de doute ou de situation complexe.
    </p>
  </section>

  <section>
    <h2>Contribuer</h2>
    <p>
      Une plateforme manque ou s'importe mal ? <a href={`${repo}/issues/new?template=nouveau-format.yml`} target="_blank" rel="noopener"
        >Envoyez un exemple anonymisé de son export</a
      >. Une erreur de calcul ou une question : <a href={`${repo}/issues`} target="_blank" rel="noopener">ouvrez une discussion</a>.
    </p>
  </section>

  <p><a href="#portefeuille">← Retour au portefeuille</a></p>
  <section>
    <h2>Auteur et soutien</h2>
    <p>
      Créé et maintenu par <a href={AUTHOR.url} target="_blank" rel="noopener">{AUTHOR.name} ({AUTHOR.handle})</a>, sur son temps libre. L'outil
      est gratuit et le restera. Pour le soutenir : <a href={SPONSORS_URL} target="_blank" rel="noopener">GitHub Sponsors</a>, ou en crypto,
      <Support />.
    </p>
  </section>
</article>

<style>
  .about {
    display: grid;
    gap: 1.4rem;
    max-width: 46rem;
  }
  header {
    display: grid;
    gap: 0.3rem;
  }
  h1 {
    font-size: clamp(1.6rem, 3.5vw, 2.1rem);
  }
  h2 {
    font-size: 1.2rem;
    margin-bottom: 0.4rem;
  }
  ul {
    margin: 0;
    padding-left: 1.2rem;
    display: grid;
    gap: 0.45rem;
  }
  p {
    margin: 0;
  }
</style>
