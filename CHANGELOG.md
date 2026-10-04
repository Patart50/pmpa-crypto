# Notes de version

## 1.0.0 — octobre 2026

Première version publique.

### Calcul
- Prix moyen pondéré par actif (positions ouvertes et historique), coût, prix d'équilibre, plus-value latente, y compris partielle si des prix manquent.
- Plus-values imposables selon l'article 150 VH bis du CGI, calcul global sur tout le portefeuille, testé sur les exemples du BOFiP.
- Seuil d'exonération de 305 €, impôt estimé au prélèvement forfaitaire (30 % ou 31,4 % selon l'année, modifiable).

### Déclaration
- Récapitulatif prêt à reporter : formulaire 2086 en euros entiers, une colonne par cession ; cases 3AN ou 3BN de la 2042 C ; rappel du formulaire 3916-bis.
- Export CSV et impression ou PDF du récapitulatif.

### Import
- Binance (historique des transactions, plusieurs exports fusionnés, marge et intérêts pris en compte dans les positions).
- Coinbase (historique des transactions, montants en dollars convertis en euros).
- Kraken (grand livre « Ledgers », d'après la documentation, à vérifier sur un historique réel).
- Tout autre CSV par association de colonnes ; choix de la plateforme et de la devise.
- Lots d'import supprimables ou remplaçables séparément.

### Saisie et outils
- Neuf types d'opération, dont airdrop, don et sortie via la marge.
- Valeur du portefeuille avant chaque vente calculée sur les cours Binance à la minute (avec votre accord).
- Prix du jour, montants et quantités d'échange calculés via Binance.
- Annulation des 10 dernières actions (Ctrl+Z).

### Confidentialité
- 100 % local : stockage dans le navigateur, sauvegarde JSON, fonctionnement hors ligne.
- Seul appel extérieur, avec consentement : l'API publique de Binance pour les prix.
