# Journal des décisions

Chaque décision est numérotée et ne se réécrit pas : on en ajoute une nouvelle qui remplace l'ancienne. Statut : ✅ actée · ⚠️ à vérifier · 🔁 remplacée.

## D-001 ✅ Licence AGPL-3.0
Empêche qu'un service en ligne fermé reprenne le moteur sans publier ses modifications.

## D-002 ✅ 100 % client-side, aucune donnée envoyée
Pas de backend. Tout appel réseau (prix live, prix historiques) sera **opt-in, désactivé par défaut**, et signalé : il révèle l'IP et les actifs suivis.

## D-003 ✅ Stack : Svelte 5 + Vite + TypeScript + Vitest
Bundle léger, site statique déployable sur GitHub Pages.

## D-004 ✅ Arithmétique décimale exacte (decimal.js)
Aucun montant en `number`. Précision 50 chiffres, arrondi au centime pour l'affichage, à l'euro pour les montants déclarés et l'impôt.

## D-005 ✅ Calcul fiscal global multi-actifs dès la v1.0
La méthode du 150 VH bis porte sur l'ensemble du portefeuille. Un calcul par actif serait faux dès deux actifs détenus. Le multi-actifs n'est donc pas reportable en v1.2.

## D-006 ✅ Marge et emprunts non qualifiés en v1.0
Le traitement fiscal des opérations sur marge (emprunts, liquidations forcées) n'est pas tranché clairement par la doctrine. Ces lignes sont importées et signalées « à traiter manuellement » plutôt qu'interprétées à tort.

## D-007 🔁 Taux du PFU par année (remplacée par D-013)
Table par défaut : 30 % jusqu'en 2024, **31,4 %** à partir de 2025 (prélèvements sociaux portés de 17,2 % à 18,6 % par la LFSS 2026). Les sources consultées divergent sur la **première année de cession** concernée pour les actifs numériques (2025 ou 2026). Valeur surchargeable dans l'outil. **À confirmer avant la v1.0.**

## D-008 ✅ Récompenses (Earn, staking)
Doctrine incertaine (BNC à la réception ou acquisition à coût nul). Proposition v1.0 : entrée au portefeuille avec un prix d'acquisition **nul par défaut**, modifiable par l'utilisateur. Validé par le mainteneur.

## D-009 ✅ Frais d'acquisition
Le BOFiP retient le « prix effectivement acquitté ». Choix v1.0 : les frais payés lors d'un achat sont **inclus** dans le prix d'acquisition (montant total décaissé). Validé par le mainteneur.

## D-010 ✅ Seuil de 305 € sur les prix bruts
Comparaison de la somme des prix de cession **bruts** (avant frais) de l'année au seuil ; 305 € pile = exonéré (« n'excède pas »). Le seuil s'apprécie par foyer fiscal : l'outil suppose un seul déclarant en v1.0.

## D-011 ✅ Échange avec soulte
Modélisé par le moteur comme une cession (prix = actifs reçus + soulte) suivie d'une acquisition des actifs reçus à leur valeur. Équivalent au § 120 du BOFiP (vérifié par test). Saisie dédiée reportée après la v1.0.

## D-012 ✅ Données réelles hors du dépôt
Les exports fournis par les utilisateurs ne sont jamais commités. Les jeux de test sont synthétiques et anonymisés.

## D-013 ✅ Taux du PFU : 31,4 % à partir des cessions de 2026
Les cessions d'actifs numériques réalisées en 2025 restent au taux de **30 %** (12,8 % + 17,2 %). Le taux de **31,4 %** (12,8 % + 18,6 %) s'applique aux cessions réalisées à partir du **1er janvier 2026**. Contrairement aux valeurs mobilières, pas de rétroactivité sur 2025 pour les actifs numériques. Sources : [simulons.fr](https://www.simulons.fr/blog/fiscalite-crypto-2026/), [fibo-crypto.fr](https://fibo-crypto.fr/blog/guide-fiscalite-cryptomonnaies/). Taux surchargeable dans l'outil.
