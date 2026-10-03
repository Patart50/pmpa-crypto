# pmpa-crypto

Calculateur de **prix moyen pondéré (PMP)** et de **plus-values crypto selon la méthode fiscale française** (art. 150 VH bis du CGI). 100 % local, privacy-first : aucune donnée ne quitte votre navigateur.

> ⚠️ Projet en développement (pré-v1.0). Outil d'aide au calcul, pas un conseil fiscal. Vérifiez vos déclarations.

## Pourquoi

- **Le calcul fiscal est global.** En France, la plus-value se calcule sur l'ensemble de votre portefeuille d'actifs numériques, pas actif par actif. Beaucoup d'outils se trompent.
- **Vos données restent chez vous.** Pas de compte, pas de serveur, fonctionne hors ligne.
- **Vérifiable.** Le moteur est testé sur les exemples officiels du BOFiP.

## État d'avancement

| Jalon | Contenu | État |
|---|---|---|
| J1 | Spécification, moteur fiscal, tests sur exemples BOFiP | ✅ |
| J2 | PMP par actif, modèle de transactions, stockage local | ✅ |
| J3 | Interface (saisie, résultats, mode sombre, hors ligne) | ✅ |
| J4 | Import CSV : générique, Binance, Coinbase, Kraken | ⏳ |
| J5 | Récapitulatif annuel (seuil 305 €, PFU, lignes 2086) | ⏳ |
| J6 | Publication v1.0 sur GitHub Pages | ⏳ |

## Développement

```bash
npm install
npm run dev      # serveur local
npm test         # tests
npm run check    # vérification des types
npm run build    # build de production
```

Documentation : [spécification](docs/SPEC.md) · [journal des décisions](docs/DECISIONS.md).

## Licence

[AGPL-3.0](LICENSE)
