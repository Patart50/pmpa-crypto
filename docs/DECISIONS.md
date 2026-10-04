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

## D-026 ✅ Prix historiques à la minute via l'API publique Binance (opt-in)
La valeur globale du portefeuille à chaque cession se calcule automatiquement : positions détenues juste avant × cours de clôture de la bougie d'une minute contenant l'heure de la cession. Paires essayées dans l'ordre : `XEUR`, `XUSDT ÷ EURUSDT`, `XUSDC × USDCUSDT ÷ EURUSDT`, `XBTC × BTCEUR`. Hôtes : `data-api.binance.vision`, puis `api.binance.com`. Seule fonction qui contacte Internet : déclenchée par l'utilisateur après un consentement explicite (mémorisé), elle n'envoie que des noms de paires et des heures. Un actif sans prix bloque la valeur, sauf validation explicite « sans cet actif » (poussière, jeton retiré de la cote). CoinGecko et CryptoCompare écartés : granularité horaire ou journalière sur l'historique, clé d'API.

## D-027 ✅ Positions reconstituées depuis le journal Binance
À l'import, chaque cession reçoit les quantités détenues juste avant sur tout le compte Binance : Spot, Earn, Funding et marge, dette de marge déduite (emprunts et remboursements exclus), déplacements internes neutres. Les soldes négatifs (historique incomplet) sont ramenés à zéro. Limites : intérêts d'emprunt non déduits ; cryptos détenues hors Binance à ajouter à la main. Tous les exports Binance sélectionnés sont fusionnés en un journal en UTC (doublons écartés, fuseaux propres à chaque fichier) : les identifiants ne dépendent plus du fuseau d'export.

## D-028 ✅ Prix Binance : ne demander que des paires existantes
Binance répond à une paire inexistante (ex. `ACEEUR`) sans en-tête CORS : le navigateur bloque la réponse et la présente comme une panne réseau, ce qui interrompait tout le calcul. L'outil charge désormais une fois la liste des paires (`/api/v3/ticker/price`) et n'interroge que celles-ci. Une bougie illisible n'interrompt plus le calcul : l'actif est signalé sans prix. Limite : une paire retirée de la cote n'est plus dans la liste, l'actif reste à valider sans prix ou à saisir.

## D-029 ✅ Rapprochement des soldes Binance en fin d'historique
Les virements vers la marge étant ignorés (D-018), un actif vendu sur marge restait « détenu » dans le suivi par actif. À l'import, le solde réel de chaque actif sur tout le compte Binance en fin d'historique (D-027) est comparé à la quantité suivie, retraits vers d'autres wallets ajoutés (ces quantités restent détenues ailleurs). L'excédent sort du suivi par une « sortie sans contrepartie » datée du dernier jour, notée « Ajustement », sans effet fiscal (pas de cession à titre onéreux ; le calcul fiscal ne dépend que des achats, des cessions en euros et de la valeur du portefeuille). Le cas inverse (solde réel supérieur au suivi) n'est pas ajusté : le coût d'acquisition serait inconnu. Chaque import Binance remplace les ajustements du précédent ; il suppose l'historique complet. Limite : seul l'état final est corrigé, le prix moyen intermédiaire reste approximatif (D-025).

## D-030 ✅ Prix du jour via Binance (opt-in)
Étend D-026 aux prix actuels de l'écran Portefeuille : une seule requête (`/api/v3/ticker/price`, déjà utilisée pour la liste des paires), mêmes chemins de conversion en euros, même consentement mémorisé. Rien d'autre n'est envoyé. Les prix restent modifiables à la main. Arrondi à l'enregistrement : 2 décimales au-delà de 100 €, 4 au-delà de 1 €, 6 chiffres significatifs en dessous.

## D-031 ✅ Poussière repliée et « Solder » une position
Les positions de moins de 1 € (valeur au prix du jour, ou coût à défaut de prix) sont regroupées dans une section repliée « Poussière ». Chaque position peut être soldée à la main : une « sortie sans contrepartie » datée du jour la retire du suivi, sans effet fiscal. La confirmation rappelle qu'un actif vendu ou dépensé ailleurs doit être saisi comme une vente (imposable), pas soldé. Les quantités retirées de Binance vers un autre wallet restent volontairement suivies (D-029) : l'outil ne peut pas savoir si elles y sont encore.

## D-032 ✅ Quantité reçue d'un échange calculée via Binance
Dans le formulaire, un échange peut être complété automatiquement : quantité reçue = quantité cédée × cours de l'actif cédé ÷ cours de l'actif reçu, à la minute de l'opération (mêmes chemins de prix que D-026, même consentement). La valeur en euros de l'échange est renseignée si elle est vide. Les frais ne sont pas déduits : la quantité affichée est une estimation à corriger si l'on connaît la quantité réelle.

## D-033 ✅ Frais sans déplacement : une dépense au coût moyen
Remplace la convention de D-014 pour les seuls « transferts » sans actif déplacé (frais de marge payés en BNB, D-021) : la quantité sort au coût moyen et ce coût est constaté en perte de suivi. Conserver le coût faisait exploser le prix moyen du BNB à chaque prélèvement (constaté sur un historique réel : 1 208 € de prix moyen). Les frais réseau d'un vrai transfert gardent la convention D-014. Sans effet fiscal.

## D-034 ✅ Ajustements datés du dernier mouvement de l'actif
Précise D-029 : l'ajustement est daté du jour du dernier mouvement de l'actif sur le compte (là où il a été vendu sur marge ou converti), et non du dernier jour de l'export.

## D-035 ✅ Journal Binance synthétique de référence
`docs/exemples/binance-synthetique-UTC0.csv` couvre les opérations rencontrées sur un historique réel (achats, Convert, Earn, airdrop, marge, frais BNB, poussière, Binance Pay, retrait, achat par carte, opérations inconnues). Les résultats attendus, calculés à la main, sont publiés dans `docs/exemples/RESULTATS-ATTENDUS.md` et vérifiés par un test : l'utilisateur peut importer le fichier et comparer écran par écran.

## D-036 ✅ Montant en euros calculé via Binance
Dans le formulaire, achat, vente, paiement, récompense et don proposent « Calculer le montant via Binance » : quantité × cours de l'actif à la minute de l'opération (chemins de prix de D-026, même consentement). Utile pour les achats par carte et les paiements Binance Pay importés sans montant (D-022). Pour un achat par carte, le montant réellement débité est souvent un peu plus élevé : le message invite à le corriger s'il est connu.
## D-037 ✅ Intérêts de marge déduits de l'avoir net
Précise D-027 : un emprunt crée une dette, le remboursement du capital l'éteint, mais la part d'un remboursement qui dépasse la dette en cours (intérêts, frais de liquidation) est une vraie sortie. Neutraliser tous les remboursements comptait ces intérêts comme encore détenus : sur un historique réel, 403,82 USDC et des reliquats sur 15 actifs apparaissaient comme positions alors que le compte était vide. Corrige les positions avant chaque cession (valeur du portefeuille) et les ajustements de fin d'historique (D-029).

## D-038 ✅ Transactions à compléter comptées dans le rapprochement
Les achats et paiements importés sans montant en euros (D-022) sont comptés en quantité dans le rapprochement de fin d'historique. Sinon, une fois complétés par l'utilisateur, ils retiraient une seconde fois ce que l'ajustement avait déjà sorti.

## D-039 ✅ Achat par carte : lignes à 5 secondes près
La ligne en euros d'un achat par carte arrive parfois une seconde après la ligne en crypto. Les lignes « Buy Crypto With Fiat » d'un même compte espacées de 5 s au plus forment un seul achat, montant compris.
