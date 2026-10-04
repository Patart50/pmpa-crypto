# Spécification — pmpa-crypto v1.0

Document vivant. Toute modification de règle fiscale doit citer sa source et être reportée dans [DECISIONS.md](DECISIONS.md).

## 1. Objectif

Un outil web **100 % local**, en français, qui calcule :

1. le **prix moyen pondéré (PMP)** de chaque actif, utile pour le suivi et le prix d'équilibre (break-even) ;
2. les **plus-values imposables** selon la méthode fiscale française des actifs numériques (art. 150 VH bis du CGI), avec le détail prêt à reporter sur le formulaire 2086.

Aucune donnée ne quitte le navigateur. Pas de compte, pas de serveur.

Ces deux calculs sont **distincts et ne doivent jamais être confondus dans l'interface** :

| | PMP « suivi » | Calcul fiscal |
|---|---|---|
| Périmètre | Par actif (BTC, ETH…) | **Tout le portefeuille**, tous actifs confondus |
| Échange crypto → crypto | Modifie le PMP des deux actifs | **Ignoré** (pas de fait générateur) |
| Usage | Prix moyen, break-even, PV latente | Déclaration 2086 |

## 2. Règles fiscales (sources)

Sources : [BOI-RPPM-PVBMC-30-20](https://bofip.impots.gouv.fr/bofip/11968-PGP.html) (assiette), [BOI-RPPM-PVBMC-30-10](https://bofip.impots.gouv.fr/bofip/11978-PGP) (champ, exonération, taux), notice du formulaire 2086.

### 2.1 Faits générateurs

Seules sont imposables les **cessions à titre onéreux** :
- crypto → euros (ou autre monnaie ayant cours légal) ;
- crypto → bien ou service (paiement) ;
- échange crypto → crypto **avec soulte**.

Un échange crypto → crypto **sans soulte** (stablecoins compris) n'est pas un fait générateur.

### 2.2 Formule

```
PV = (C − F) − A × C / V
```

| Symbole | Définition | Ligne 2086 |
|---|---|---|
| V | Valeur globale de **tous** les actifs numériques détenus juste avant la cession (toutes plateformes, wallets) | 212 |
| C | Prix de cession (somme perçue ou valeur de la contrepartie, soulte reçue incluse) | 213 |
| F | Frais de cession (plateforme, réseau), déduits du **premier terme seulement** | 214 |
| A | Prix total d'acquisition net = somme des acquisitions − fractions de capital initial antérieures | 220 − 221 (− 222) = 223 |

Fraction de capital initial d'une cession : `A × C / V`. Elle est retranchée de A pour les cessions suivantes.

### 2.3 Prix total d'acquisition

Somme de :
- montants payés en euros pour les achats ;
- valeur des biens ou services remis en échange ;
- soultes versées ;
- valeur retenue pour les acquisitions à titre gratuit (donation, succession) ou, à défaut, valeur réelle à l'entrée dans le patrimoine.

### 2.4 Année d'imposition

- Les plus et moins-values de l'année se compensent.
- **Moins-value nette : ni imposable, ni reportable** sur les années suivantes.
- **Exonération** si la somme des **prix de cession bruts** de l'année n'excède pas **305 €** (305 € pile = exonéré).

### 2.5 Taux

PFU : 12,8 % d'impôt sur le revenu + prélèvements sociaux. Les taux sont tabulés par année et surchargeables (voir D-007). L'option pour le barème progressif n'est pas simulée en v1.0.

## 3. Architecture

```
src/lib/core/      Logique pure, sans dépendance navigateur, testée à 100 %
  money.ts         Arithmétique décimale exacte (decimal.js)
  fiscal.ts        Moteur 150 VH bis (événements fiscaux → résultats annuels)
  transactions.ts  Modèle de transaction et validation
  portfolio.ts     Suivi par actif : PMP, coût, réalisé, break-even, latent
  ledger.ts        Transactions → événements fiscaux
src/lib/import/    (J4) Parseurs CSV par plateforme
src/lib/storage/   IndexedDB + export/import JSON versionné
src/               (J3) Interface Svelte
```

Règles :
- **Jamais de `number` pour un montant.** Tout passe par `dec()`.
- Le moteur fiscal reçoit des **événements déjà qualifiés** (acquisition / cession). La qualification des transactions brutes est une couche séparée, testée séparément.
- Les dates sont des chaînes ISO **dans le fuseau de l'utilisateur** (Europe/Paris par défaut) : l'année fiscale se lit directement dans la chaîne.

## 4. Modèle de transaction et suivi (J2)

Code : `src/lib/core/transactions.ts`, `portfolio.ts`, `ledger.ts`. Montants et quantités stockés en **chaînes décimales**.

| Type | Sortie | Entrée | `eur` | Effet fiscal |
|---|---|---|---|---|
| `buy` | — | crypto | euros payés (hors frais) | acquisition (+ frais en euros, D-009) |
| `sell` | crypto | — | euros reçus (avant frais) | cession imposable |
| `swap` | crypto | crypto | valeur de marché (facultatif) | aucun |
| `payment` | crypto | — | valeur du bien ou service | cession imposable |
| `reward` | — | crypto | valeur à la réception (facultatif) | acquisition à 0 € par défaut (D-008) |
| `transfer` | — | — | — | aucun |
| `margin` | — | — | — | non qualifié, signalé (D-006) |

Frais : `{ asset, quantity, eur? }`, payables en EUR, dans l'actif reçu, l'actif cédé ou un autre actif (BNB).

**Suivi par actif** (`computePortfolio`) : quantité, coût des positions ouvertes, **PMP ouvert**, **PMP historique** (toutes les entrées depuis l'origine), résultat réalisé de suivi, **prix d'équilibre** = (coût ouvert − réalisé) / quantité, valeur et latent si un prix courant est fourni. Méthode du coût moyen pondéré ; conventions de frais et d'échanges en D-014.

**Valeur du portefeuille avant une cession** : saisie par l'utilisateur (`portfolioValueEur`), ou estimée par `holdingsBefore` + `estimatePortfolioValue` à partir de prix qu'il fournit. Une cession sans valeur est **exclue du calcul et signalée**, et son année marquée incomplète.

**Historique incomplet** : une sortie supérieure au solde détenu est plafonnée et signalée (`INSUFFICIENT_BALANCE`).

**Stockage** (`src/lib/storage/`) : IndexedDB dans le navigateur ; sauvegarde JSON versionnée (`schemaVersion`) avec validation stricte à l'import et migrations (D-016).

## 4 bis. Interface (J3)

Trois écrans, navigation par ancre (`#portefeuille`, `#transactions`, `#fiscalite`) :
- **Portefeuille** : synthèse (coût, valeur, latent, réalisé), une ligne par actif avec prix moyen ouvert et historique, coût, prix d'équilibre, prix du jour saisi à la main ou récupéré sur Binance (opt-in, D-030), bouton « Solder » ; poussière (< 1 €) et positions soldées repliées (D-031).
- **Transactions** : liste filtrable (type, actif), formulaire unique qui s'adapte au type, signalement des transactions incomplètes. Plateforme et note tiennent sur une ligne ; texte complet au survol, au focus ou au toucher. Un clic sur une ligne ou sur son type ouvre la transaction (suppression dans le formulaire) ; affichage en cartes sous 1 000 px. Changer de type conserve l'actif et la quantité ; la quantité reçue d'un échange et le montant en euros des autres opérations peuvent être calculés via Binance (D-032, D-036).
- **Fiscalité** : cessions exclues faute de valeur de portefeuille (avec bouton « Renseigner »), synthèse par année (seuil 305 €, base imposable, taux modifiable, impôt estimé, cases 3AN/3BN), détail au format des lignes du formulaire 2086 (une colonne par cession ; cartes sur mobile).
- **Aide au calcul de la valeur du portefeuille** : positions détenues juste avant la cession × prix saisis par l'utilisateur.
- Sauvegarde (export/import JSON, effacement), thème auto/clair/sombre, exemple fictif, fonctionnement hors ligne (service worker généré au build).

## 5. Import CSV (J4)

Code : `src/lib/import/`. Tout est lu dans le navigateur ; aucun fichier n'est envoyé.

**Reconnaissance** (`detectFile`) : journal Binance (en-têtes français ou anglais) → import automatique ; export pmpa-crypto → réimport sans perte ; tout autre CSV → écran d'association des colonnes.

**Lecteur CSV** : RFC 4180, séparateur détecté (`,` `;` tabulation), BOM retiré ; 100 000 lignes en moins d'une seconde.

**Dédoublonnage** : identifiant stable par transaction, calculé à partir des lignes d'origine. Réimporter le même fichier ou des périodes qui se chevauchent n'ajoute rien. Un import peut être annulé juste après.

### 5.1 Binance — « Historique des transactions »

Seul ce journal est nécessaire (les exports dépôts/retraits sont redondants). Il ne contient **aucun prix**, seulement des variations de solde.

| Opérations Binance | Résultat |
|---|---|
| `Transaction Buy/Spend/Sold/Revenue/Fee`, `BNB Fee Deduction` (Spot, Strategy) | Regroupées par seconde et compte : achat (EUR → crypto), vente (crypto → EUR) ou échange ; frais rattachés |
| `Binance Convert` | Deux lignes de signes opposés à ≤ 5 s → achat, vente ou échange |
| `Small Assets Exchange BNB` | Une paire par remarque (« ACE to USDC ») → échange |
| Intérêts Earn, récompenses, airdrops, Launchpool, HODLer, Megadrop, bons, remises, Crypto Box | Récompense, agrégée par jour, actif et type |
| `Deposit` / `Withdraw` crypto | Transfert (sans effet fiscal) |
| `Deposit` / `Fiat Withdraw` en EUR | Ignorés (mouvements d'euros) |
| Souscriptions/rachats Earn et Launchpool, transferts entre comptes Binance | Ignorés (internes) |
| `Buy Crypto With Fiat` | Achat à compléter (montant payé absent de l'export) |
| `Transfer` + remarque Binance Pay | Achat ou paiement à compléter (valeur en euros à saisir) |
| `BNB Fee Deduction` sans échange dans la même seconde (frais de marge) | Un transfert par jour qui réduit le solde de BNB |
| Comptes Isolated/Cross Margin, Futures, liquidations | Ignorés et comptés (D-006, D-018) |
| Toute autre opération | Listée comme « non reconnue » dans le résumé |
| Fin d'historique | Actif suivi au-delà du solde réel du compte (+ retraits vers d'autres wallets) → « sortie sans contrepartie » d'ajustement datée du dernier mouvement de l'actif, sans effet fiscal (D-029, D-034) |

Fuseau horaire : lu dans le nom du fichier (`…UTC2…`), modifiable ; dates converties à l'heure de Paris (changement d'heure compris).

### 5.2 CSV quelconque

L'utilisateur associe ses colonnes aux champs (date, type, actif et quantité reçus, actif et quantité cédés, montant en euros, frais, valeur du portefeuille, plateforme, note), avec une proposition automatique à partir des en-têtes français ou anglais. Il choisit le format des dates (ISO, JJ/MM, MM/JJ, Unix), le séparateur décimal, le fuseau, et associe chaque valeur de sa colonne « type » à un type de transaction ou à « ignorer ». Sans colonne type, le type est déduit (deux actifs → échange ; EUR cédé → achat ; EUR reçu → vente). Aperçu des premières lignes avant analyse.

### 5.3 Export CSV

Colonnes : `date, type, in_asset, in_quantity, out_asset, out_quantity, eur, fee_asset, fee_quantity, fee_eur, portfolio_value_eur, fiscal_cost_eur, moved_asset, moved_quantity, platform, note, id`. Réimportable sans perte.

### 5.4 Journal de référence

`docs/exemples/binance-synthetique-UTC0.csv` et `RESULTATS-ATTENDUS.md` (D-035) : import de contrôle avec résultats attendus.

### 5.5 Autres plateformes

Plateformes licenciées MiCA visées : Coinbase, Kraken, Crypto.com, Bybit EU, OKX. En attendant des exemples réels, elles passent par l'association de colonnes. Un modèle d'issue GitHub (« Nouveau format d'export ») recueille la structure de leurs fichiers, sans données personnelles.

## 6. Hors périmètre v1.0

Connexion API aux plateformes, comptes, multi-utilisateurs, graphiques complexes, prédictions, marge et dérivés, option barème progressif, DeFi multi-chaînes.
