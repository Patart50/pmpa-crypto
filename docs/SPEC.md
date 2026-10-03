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

## 5. Import Binance (J4) — analyse des exports réels

Le seul export nécessaire est **« Historique des transactions »** (journal comptable). Les exports « dépôts », « retraits fiat », « dépôts fiat » sont redondants avec lui.

Format observé (export localisé en français) :

```
Identifiant utilisateur,Durée,Compte,Opération,Jeton,Change,Remarque
```

Équivalent anglais attendu : `User_ID,UTC_Time,Account,Operation,Coin,Change,Remark`.

Constats :
- **Aucun prix** : seulement des variations de solde par jeton.
- Un ordre se reconstitue en **regroupant les lignes de même horodatage et même compte** (`Transaction Buy` / `Spend` / `Fee`, ou `Sold` / `Revenue` / `Fee`). Un ordre exécuté en plusieurs fois peut produire 100 lignes dans la même seconde.
- Le fuseau horaire de l'export figure dans le nom du fichier (ex. `…UTC2…`) et doit être demandé ou détecté : il fixe l'année des cessions proches du 31 décembre.
- L'export est limité en durée : il faut **fusionner plusieurs fichiers** et dédoublonner.
- L'identifiant utilisateur est une donnée personnelle : il est ignoré à l'import et ne doit jamais apparaître dans les jeux de test.

Opérations rencontrées et traitement prévu :

| Opération | Traitement |
|---|---|
| `Deposit` / `Withdraw` (EUR) , `Fiat Withdraw` | Mouvement d'euros, sans effet fiscal |
| `Transaction Buy/Spend/Sold/Revenue/Fee` (Spot) | Achat, vente ou échange selon les jetons du groupe |
| `BNB Fee Deduction` | Frais payés en BNB, rattachés à l'ordre du même horodatage |
| `Binance Convert` | Échange (ou achat/vente si EUR) |
| `Small Assets Exchange BNB` | Échange de petits soldes |
| `Simple Earn Flexible Interest` | Récompense (traitement fiscal : D-008) |
| `Simple Earn Flexible Subscription/Redemption`, `Inter-Wallet Transfer`, `Transfer Between Spot and Funding` | Transfert interne, ignoré |
| `Deposit` / `Withdraw` (crypto) | Transfert : l'utilisateur précise s'il s'agit de son propre wallet |
| `Isolated/Cross Margin …` (emprunts, remboursements, liquidations, ordres) | **Non qualifié en v1.0** : importé et signalé « à traiter manuellement » (D-006) |

Plateformes suivantes (licence MiCA) : Coinbase et Kraken (J4), puis Crypto.com, Bybit EU, OKX (v1.1).

## 6. Hors périmètre v1.0

Connexion API aux plateformes, comptes, multi-utilisateurs, graphiques complexes, prédictions, marge et dérivés, option barème progressif, DeFi multi-chaînes.
