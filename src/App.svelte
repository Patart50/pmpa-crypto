<script lang="ts">
  // Écran provisoire (J1) : démontre le moteur fiscal sur l'exemple officiel
  // du BOFiP (BOI-RPPM-PVBMC-30-20 § 110). L'interface réelle arrive au J3.
  import { computeFiscal, roundDetail, type FiscalEvent } from './lib/core/fiscal';

  const events: FiscalEvent[] = [
    { kind: 'acquisition', date: '2024-01-15', amountEur: 1000 },
    { kind: 'cession', date: '2024-03-15', priceEur: 450, portfolioValueEur: 1200 },
    { kind: 'cession', date: '2024-08-15', priceEur: 1300, portfolioValueEur: 1300 },
  ];

  const result = computeFiscal(events);
  const year = result.years[0];
  const eur = (v: string) =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(v));
</script>

<main>
  <h1>pmpa-crypto</h1>
  <p class="lead">
    Calcul des plus-values crypto selon la méthode fiscale française (art. 150 VH bis du CGI), 100 % dans
    votre navigateur.
  </p>

  <section>
    <h2>Exemple officiel du BOFiP (§ 110)</h2>
    <p>Achat de 1 000 € en janvier, puis deux cessions.</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Valeur du portefeuille</th>
            <th>Prix de cession</th>
            <th>Prix d'acquisition net</th>
            <th>Plus-value</th>
          </tr>
        </thead>
        <tbody>
          {#each year.cessions.map(roundDetail) as c}
            <tr>
              <td>{c.date}</td>
              <td>{eur(c.portfolioValue)}</td>
              <td>{eur(c.price)}</td>
              <td>{eur(c.netAcquisition)}</td>
              <td>{eur(c.gain)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p>
      Plus-value nette {year.year} : <strong>{eur(year.netGain.toString())}</strong> — impôt estimé (PFU
      {Number(year.rate.times(100).toString()).toLocaleString('fr-FR')} %) :
      <strong>{eur(year.estimatedTax.toString())}</strong>
    </p>
  </section>

  <p class="note">Version de développement. Aucune donnée ne quitte votre navigateur.</p>
</main>

<style>
  main {
    max-width: 52rem;
    margin: 0 auto;
    padding: 2.5rem 1rem;
  }
  h1 {
    font-size: 2rem;
    margin: 0 0 0.5rem;
    letter-spacing: -0.02em;
  }
  .lead {
    color: var(--muted);
    margin-top: 0;
  }
  section {
    margin-top: 2rem;
    padding: 1.25rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }
  h2 {
    font-size: 1.1rem;
    margin: 0 0 0.5rem;
  }
  .table-wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    text-align: right;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  th:first-child,
  td:first-child {
    text-align: left;
  }
  th {
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .note {
    margin-top: 2rem;
    font-size: 0.85rem;
    color: var(--muted);
  }
</style>
