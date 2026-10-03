# Journal Binance synthétique — résultats attendus

Fichier : [`binance-synthetique-UTC0.csv`](binance-synthetique-UTC0.csv). Données fictives, au format exact de l'export Binance « Historique des transactions » (colonnes `Identifiant utilisateur, Durée, Compte, Opération, Jeton, Change, Remarque`, heures en UTC).

Chaque valeur ci-dessous est calculée à la main et vérifiée par le test `src/lib/import/binance-synthetique.test.ts`. Pour comparer : **Tout effacer**, importer ce fichier seul, puis contrôler chaque écran.

## Ce que contient le journal

| Heure UTC | Opération Binance | Cas testé |
|---|---|---|
| 2025-01-10 09:00 | Deposit EUR | Mouvement d'euros, ignoré |
| 2025-01-10 09:05 | Achat BTC, frais en BTC | Achat, frais dans l'actif reçu |
| 2025-01-10 09:10 | Achat USDC, frais en USDC | Achat |
| 2025-01-10 09:15 | Binance Convert EUR → BNB (1 s d'écart) | Convert apparié |
| 2025-01-12 | Airdrop ACE | Récompense à coût nul |
| 2025-01-15 | USDC → SOL, frais en BNB | Échange, frais dans un autre actif |
| 2025-01-16 | 2 intérêts Earn USDC | Agrégés en une récompense par jour |
| 2025-01-17 / 20 | Souscription / rachat Earn | Internes, ignorés |
| 2025-02-01 | SOL envoyé en marge, vendu en marge, USDC rapatrié | Marge ignorée, soldes suivis ; SOL ajusté en fin d'historique |
| 2025-02-02 | 2 déductions BNB sans échange | Frais de marge : un « transfert » par jour |
| 2025-03-01 | Conversion de petits soldes ACE → BNB | Échange « poussière » |
| 2025-06-15 | Vente BTC → EUR, frais en EUR | **Cession imposable 2025** |
| 2025-08-01 | Binance Pay envoyé | Paiement à compléter |
| 2025-09-10 | Retrait BTC vers un wallet | Transfert, BTC toujours détenu |
| 2025-10-01 | Asset Recovery | Opération non reconnue |
| 2026-02-10 | Vente USDC → EUR | **Cession imposable 2026** |
| 2026-03-05 | Achat ETH par carte | Achat à compléter |
| 2026-04-01 | Fiat Withdraw | Mouvement d'euros, ignoré |
| 2026-04-02 | Ligne Cross Margin en EUR | Marge en euros, signalée |

## 1. Résumé d'import

- **14 transactions** (13 reconstituées + 1 ajustement SOL).
- Ignorées : marge et dérivés **5**, transferts internes **4**, euros **2**, non reconnue **1** (Asset Recovery).
- Trois messages : 2 transactions à compléter ; 1 actif absent en fin d'historique (SOL) ; 1 ligne de marge en euros.

## 2. Transactions (heure de Paris)

| Date | Type | Mouvement | Montant | Frais |
|---|---|---|---|---|
| 10/01/2025 10:05 | Achat | +0,025 BTC | 2 000 € | 0,000025 BTC |
| 10/01/2025 10:10 | Achat | +1 100 USDC | 1 000 € | 1,1 USDC |
| 10/01/2025 10:15 | Achat | +0,5 BNB | 300 € | — |
| 12/01/2025 23:59 | Récompense | +20 ACE | — | — |
| 15/01/2025 11:00 | Échange | −500 USDC → +2,5 SOL | — | 0,001 BNB |
| 16/01/2025 23:59 | Récompense | +0,2 USDC (2 versements) | — | — |
| 01/02/2025 23:59 | Don ou sortie (ajustement) | −2,5 SOL | — | — |
| 02/02/2025 23:59 | Transfert (frais de marge) | — | — | 0,005 BNB |
| 01/03/2025 13:00 | Échange (petits soldes) | −20 ACE → +0,004 BNB | — | — |
| 15/06/2025 16:00 | Vente | −0,01 BTC | 900 € | 0,90 € |
| 01/08/2025 11:00 | Paiement **à vérifier** | −50 USDC | — | — |
| 10/09/2025 11:00 | Transfert (retrait) | 0,005 BTC | — | — |
| 10/02/2026 11:00 | Vente | −400 USDC | 370 € | 0,37 € |
| 05/03/2026 10:00 | Achat **à vérifier** | +0,1 ETH | — | — |

Filtre « À vérifier » : **4** (les 2 transactions à compléter + les 2 ventes sans valeur de portefeuille).

Positions détenues juste avant chaque cession (bouton « Calculer automatiquement ») :

| Cession | BNB | BTC | USDC |
|---|---|---|---|
| Vente BTC 15/06/2025 | 0,498 | 0,024975 | 1 199,1 |
| Paiement 01/08/2025 | 0,498 | 0,014975 | 1 199,1 |
| Vente USDC 10/02/2026 | 0,498 | 0,009975 | 1 150,1 |

USDC 1 199,1 = 1 100 − 1,1 − 500 + 0,2 (intérêts) + 600 (vente de SOL en marge). Limite connue (D-027) : les 0,005 BTC retirés vers un wallet n'y figurent pas, à ajouter à la main.

## 3. Portefeuille

| Actif | Quantité | Prix moyen | Prix moyen historique | Coût | Prix d'équilibre | Réalisé |
|---|---|---|---|---|---|---|
| BTC | 0,014975 | 80 080,08 € | 80 080,08 € | 1 199,20 € | 73 515,86 € | +98,30 € |
| BNB | 0,498 | 595,18 € | 595,24 € | 296,40 € | 601,20 € | −3,00 € |
| USDC | 199,1 | 0,9097 € | 0,9098 € | 181,12 € | 0,8808 € | +5,75 € |

Positions soldées : ACE et SOL. Coût des positions : **1 676,72 €**. Résultat réalisé : **+101,05 €**.

Détail des calculs :
- **BTC** : 0,025 − 0,000025 de frais = 0,024975 pour 2 000 €. Vente de 0,01 : coût sorti 800,80 €, produit net 899,10 €, réalisé +98,30 €.
- **BNB** : 0,5 pour 300 € ; 0,001 payé en frais (0,60 € reporté sur SOL) ; 0,005 de frais de marge, coût sorti 3,00 € constaté en perte ; +0,004 reçu de la poussière ACE à coût nul.
- **USDC** : 1 098,9 pour 1 000 €. L'échange vers SOL sort 455,00 € de coût. +0,2 d'intérêts à 0 €. La vente de 400 sort 363,88 € pour 369,63 € nets, réalisé +5,75 €. Le paiement Binance Pay, sans valeur, est ignoré tant qu'il n'est pas complété. Le suivi (199,1) est inférieur au solde réel (750,1) à cause des 600 USDC venus de la marge : c'est normal et non ajusté.

## 4. Fiscalité

En saisissant les valeurs de portefeuille **3 000 €** (vente du 15/06/2025) et **1 500 €** (vente du 10/02/2026), valeurs fictives choisies pour vérifier la formule :

| Ligne 2086 | 2025 | 2026 |
|---|---|---|
| 212 Valeur du portefeuille | 3 000 | 1 500 |
| 213 Prix de cession | 900,00 | 370,00 |
| 214 Frais | 0,90 | 0,37 |
| 223 Prix total d'acquisition net | 3 300,00 | 2 310,00 |
| Fraction de capital (A × C / V) | 990,00 | 569,80 |
| **Plus ou moins-value** | **−90,90** | **−200,17** |

- A 2025 = 2 000 + 1 000 + 300 (achats en euros). A 2026 = 3 300 − 990.
- Les deux années dépassent 305 € de cessions : pas d'exonération, mais moins-value nette (non reportable).
- Avec « Calculer automatiquement », les valeurs viennent des vrais cours Binance de ces dates : les résultats changent, la méthode reste la même.
