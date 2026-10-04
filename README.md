# pmpa-crypto

Calculateur de **prix moyen pondéré** et de **plus-values crypto selon la méthode fiscale française** (article 150 VH bis du CGI). Gratuit, libre, 100 % local : vos données ne quittent pas votre navigateur.

**👉 Utiliser l'outil : https://patart50.github.io/pmpa-crypto/**

> Outil d'aide au calcul, pas un conseil fiscal. Vérifiez vos déclarations.

## Pourquoi cet outil

- **Le calcul fiscal français est global.** La plus-value se calcule sur l'ensemble de votre portefeuille d'actifs numériques, pas actif par actif. Seules les ventes contre euros et les paiements en crypto sont imposables ; les échanges entre cryptos ne le sont pas.
- **Vos données restent chez vous.** Pas de compte, pas de serveur, pas de mesure d'audience. L'outil fonctionne hors ligne une fois chargé.
- **Vérifiable.** Le moteur est testé sur les exemples officiels du BOFiP, et chaque choix d'interprétation est publié dans le [journal des décisions](docs/DECISIONS.md).

## Ce qu'il fait

- **Portefeuille** : quantité, prix moyen des positions ouvertes et historique, coût, prix d'équilibre, plus-value latente ; prix du jour saisis ou récupérés sur Binance.
- **Transactions** : achats, ventes, échanges, paiements, récompenses, airdrops, dons, transferts, sorties via la marge ; import, export CSV, lots d'import supprimables séparément, annulation des dernières actions.
- **Fiscalité** : plus-value de chaque cession, seuil d'exonération de 305 €, impôt estimé (prélèvement forfaitaire), et récapitulatif prêt à reporter :
  - formulaire **2086** en euros entiers, une colonne par cession ;
  - cases **3AN** ou **3BN** de la **2042 C** ;
  - rappel du formulaire **3916-bis** pour les comptes à l'étranger ;
  - export CSV et impression ou PDF.

## Démarrer

1. Ouvrez l'outil. Rien à installer.
2. Importez vos historiques (onglet **Transactions → Importer**), ou saisissez vos opérations à la main.
3. Onglet **Fiscalité** : cliquez sur « Calculer automatiquement » pour la valeur de votre portefeuille avant chaque vente.
4. Reportez le récapitulatif sur votre déclaration.
5. **Exportez une sauvegarde** (menu Sauvegarde) : effacer les données du navigateur efface vos transactions.

## Importer vos historiques

| Plateforme | Export à télécharger | Remarques |
|---|---|---|
| **Binance** | Portefeuille → Historique des transactions → Exporter | Sélectionnez **tous vos exports en une fois**, depuis votre premier achat : l'outil reconstitue vos positions exactes avant chaque vente, marge comprise. |
| **Coinbase** | Relevés → Historique des transactions, format CSV | Montants en dollars convertis en euros au cours de la minute. |
| **Kraken** | Documents → Exports → « Ledgers » (grand livre), CSV | Écrit d'après la documentation de Kraken, pas encore vérifié sur un vrai historique. L'export « Trades » ne suffit pas. |
| **Autre** | Tout CSV | Vous indiquez quelle colonne correspond à quoi. |

Votre plateforme manque ou s'importe mal ? [Envoyez un exemple anonymisé de son export](https://github.com/Patart50/pmpa-crypto/issues/new?template=nouveau-format.yml) : en-têtes et quelques lignes, sans identifiants, adresses de wallet ni montants réels.

Pour vérifier l'outil, importez un des journaux fictifs de [`docs/exemples/`](docs/exemples/) et comparez avec les [résultats attendus](docs/exemples/RESULTATS-ATTENDUS.md).

## Ce qui est envoyé sur Internet

Rien, sauf si vous l'autorisez : pour les prix (valeur du portefeuille avant chaque vente, prix du jour, conversion des dollars), l'outil interroge l'API publique de Binance. Il n'envoie que des noms de paires et des heures, jamais vos quantités ni vos montants. Binance voit votre adresse IP.

## Limites connues

- **Marge et dérivés** : non qualifiés fiscalement, non calculés. Les positions sorties via la marge sont retirées du suivi sans effet fiscal.
- **Valeur du portefeuille** : calculée à partir des positions connues. Les cryptos détenues ailleurs (wallet personnel, plateforme non importée) sont à ajouter à la main.
- **Dollars** : convertis au cours EUR/USDT, l'USD étant assimilé à l'USDT.
- **Non pris en charge** : échanges avec soulte, option pour le barème progressif, minage et activités professionnelles, NFT.
- Le détail est sur la page « À propos et limites » de l'outil.

## Auteur et soutien

Créé et maintenu par **Arnaud** ([@Patart50](https://github.com/Patart50)). L'outil est gratuit, sans publicité ni compte, et le restera.

Pour soutenir le projet :

- [GitHub Sponsors](https://github.com/sponsors/Patart50) (carte bancaire, ponctuel ou mensuel)
- Bitcoin, réseau Bitcoin uniquement : `bc1qd5j0yrrxp6wrk5ds0xne97hdrz5fvxjl8q22p4`
- ETH ou USDC, réseau Base uniquement : `0x7e4b6bad06813506b724b5ea3cc9545a7b97eba4`

## Développement

```bash
npm install
npm run dev      # serveur local
npm test         # tests
npm run check    # vérification des types
npm run build    # build de production
```

Svelte 5, TypeScript, Vite, Vitest, decimal.js, IndexedDB, service worker. Documentation : [spécification](docs/SPEC.md) · [journal des décisions](docs/DECISIONS.md) · [notes de version](CHANGELOG.md).

## Licence

[AGPL-3.0](LICENSE)
