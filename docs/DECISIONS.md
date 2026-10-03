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

## D-014 ✅ Suivi par actif : coût moyen pondéré, frais et échanges
- Une sortie retire le coût au prorata (coût moyen courant × quantité) : une vente ne modifie pas le PMP ouvert.
- Frais en EUR : ajoutés au coût de l'actif reçu, ou déduits du produit d'une vente.
- Frais dans l'actif reçu : quantité reçue diminuée, coût inchangé.
- Frais dans l'actif cédé ou un autre actif (BNB) : quantité retirée de cet actif, son coût reporté sur l'opération.
- Frais réseau d'un transfert : quantité retirée, coût conservé (le PMP augmente).
- Échange crypto → crypto : avec valeur de marché saisie, résultat de suivi sur l'actif cédé et coût de marché sur l'actif reçu ; sans valeur, report du coût.
Ce suivi est indépendant du calcul fiscal, qui ignore les échanges.

## D-015 ✅ Frais payés en crypto sur une opération non imposable
Payer des frais en crypto (BNB…) lors d'un achat ou d'un échange n'est traité ni comme une cession imposable, ni comme un ajout au prix total d'acquisition (cet actif y figure déjà). Les frais de **cession** payés en crypto sont déduits du prix de cession s'ils ont une contre-valeur en euros, sinon un avertissement est affiché. Simplification assumée : montants marginaux, pratique courante des outils du marché.

## D-016 ✅ Stockage IndexedDB + sauvegarde JSON versionnée
IndexedDB plutôt que localStorage (capacité, écritures atomiques). La sauvegarde JSON porte `app` et `schemaVersion` ; une sauvegarde d'une version plus récente est refusée, une plus ancienne est migrée. Import en deux niveaux : erreurs de structure → rien n'est importé ; incohérences métier → importées et signalées pour correction.

## D-017 ✅ Aucune ressource tierce, hors ligne sans dépendance
Polices auto-hébergées (`@fontsource`), aucun appel à un CDN, à Google Fonts ou à une API. Le service worker est généré par un petit plugin Vite maison (pré-cache des fichiers du build, polices latines seulement) plutôt que par une bibliothèque : moins de surface, comportement lisible. Chemins relatifs (`base: './'`) pour un déploiement à la racine comme sous `/pmpa-crypto/`.

## D-018 ✅ Lignes de marge non stockées
Précise D-006 : à l'import, les lignes des comptes de marge et de dérivés ne créent aucune transaction (elles se comptent par milliers et n'apportent rien au calcul). Elles sont comptées et affichées dans le résumé d'import. Conséquence assumée : les soldes déplacés vers ou depuis la marge ne sont pas suivis.

## D-019 ✅ Identifiants d'import stables
Chaque transaction importée reçoit un identifiant dérivé de ses lignes d'origine (double hachage FNV-1a). Réimporter un fichier ou des exports qui se chevauchent n'ajoute aucun doublon.

## D-020 ✅ Récompenses agrégées par jour
Les versements Earn quotidiens (souvent plusieurs par jour) sont regroupés par jour, actif et type d'opération. Sans effet sur le calcul (prix d'acquisition nul, D-008), beaucoup plus lisible.

## D-021 ✅ Frais sans échange associé
Un prélèvement de frais sans échange dans la même seconde (cas des frais BNB de la marge payés depuis le compte Spot) devient un transfert par jour qui réduit le solde de l'actif, sans effet fiscal.

## D-022 ✅ Montant en euros absent : importé et signalé
Achat par carte et Binance Pay n'ont pas de contrepartie en euros dans le journal. Ils sont importés comme transactions incomplètes, signalées dans la liste (filtre « À vérifier »), plutôt qu'écartés ou devinés.

## D-023 ✅ Coinbase, Kraken : association de colonnes en attendant des exemples réels
Pas de parseur dédié écrit sans fichiers réels : le risque d'erreur silencieuse est trop grand. Ces plateformes passent par l'association de colonnes ; un parseur dédié sera ajouté à partir des structures recueillies via le modèle d'issue.

## D-024 ⚠️ Don ou sortie sans contrepartie
Nouveau type « Don ou sortie sans contrepartie » (envoi à un proche, perte d'accès, piratage) : l'actif quitte le portefeuille, sa quantité et son coût sont retirés du suivi, sans résultat. Fiscalement, un don n'est pas une cession à titre onéreux : aucune plus-value. Le prix total d'acquisition n'est pas réduit, l'article 150 VH bis ne prévoyant cette réduction que pour les cessions à titre onéreux. Lecture à confirmer. Un envoi qui rembourse une dette ou paie un bien reste une cession (type « Paiement »).

## D-025 ✅ Soldes insuffisants dus à la marge : signalés, sans effet fiscal
Le calcul fiscal ne dépend que des achats en euros, des cessions et de la valeur du portefeuille saisie. Un solde insuffisant (fonds revenus de la marge, historique incomplet) fausse le prix moyen de suivi d'un actif, pas la plus-value imposable. Le message le dit. Les conversions de petits soldes ne sont plus signalées. L'aide au calcul de la valeur du portefeuille accepte une ligne « Autres » pour la marge, l'Earn bloqué et les autres wallets. Les lignes de marge en euros sont signalées à l'import, car elles peuvent contenir des ventes imposables.
