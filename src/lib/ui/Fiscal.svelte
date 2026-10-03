<script lang="ts">
  import { app } from '../state/app.svelte';
  import { DEFAULT_RATES, EXEMPTION_THRESHOLD_EUR, type CessionDetail } from '../core/fiscal';
  import { dateFr, eur, eurWhole, parseInput, percent, tone } from './format';
  import { ui } from './ui.svelte';
  import { TRANSACTION_LABELS } from '../core/transactions';

  const fiscal = $derived(app.fiscal);
  const years = $derived(fiscal.ok ? fiscal.result.years : []);
  const missing = $derived(fiscal.ok ? fiscal.result.issues.filter((i) => i.code === 'MISSING_PORTFOLIO_VALUE') : []);
  const warnings = $derived(fiscal.ok ? fiscal.result.warnings : []);

  let selected = $state<number | null>(null);
  const year = $derived(years.find((y) => y.year === selected) ?? years[years.length - 1]);

  let rateError = $state(false);
  const rateOverridden = $derived(year ? app.settings.rates?.[String(year.year)] !== undefined : false);

  function onRate(raw: string) {
    if (!year) return;
    const parsed = parseInput(raw.replace('%', ''));
    if (parsed === undefined) {
      rateError = false;
      app.setRate(year.year, undefined);
      return;
    }
    const value = parsed === null ? NaN : Number(parsed);
    if (!(value >= 0 && value <= 100)) {
      rateError = true;
      return;
    }
    rateError = false;
    app.setRate(year.year, String(value / 100));
  }

  const ratePercent = (r: { times(n: number): { toString(): string } }) => r.times(100).toString().replace('.', ',');
  const defaultRateFor = (y: number) => DEFAULT_RATES[y] ?? DEFAULT_RATES[Math.max(...Object.keys(DEFAULT_RATES).map(Number))];

  type Line = { n: string; label: string; value: (c: CessionDetail) => string; strong?: boolean };
  const lines: Line[] = [
    { n: '211', label: 'Date de la cession', value: (c) => dateFr(c.date, false) },
    { n: '212', label: 'Valeur globale du portefeuille au moment de la cession', value: (c) => eur(c.portfolioValue) },
    { n: '213', label: 'Prix de cession', value: (c) => eur(c.price) },
    { n: '214', label: 'Frais de cession', value: (c) => eur(c.fees) },
    { n: '215', label: 'Prix de cession net des frais', value: (c) => eur(c.netPrice) },
    { n: '220', label: "Prix total d'acquisition", value: (c) => eur(c.grossAcquisition) },
    { n: '221', label: 'Fractions de capital initial des cessions antérieures', value: (c) => eur(c.previousFractions) },
    { n: '223', label: "Prix total d'acquisition net", value: (c) => eur(c.netAcquisition) },
    { n: '224', label: 'Plus-value ou moins-value', value: (c) => eur(c.gain), strong: true },
  ];

  const txLabel = (id: string) => {
    const tx = app.find(id);
    return tx ? `${TRANSACTION_LABELS[tx.type]} du ${dateFr(tx.date, false)}${tx.out ? ` (${tx.out.asset})` : ''}` : id;
  };
</script>

<section class="intro">
  <h1>Plus-values imposables</h1>
  <p class="muted">
    Calcul global sur tout votre portefeuille, selon l'article 150 VH bis du CGI. Les échanges entre cryptos ne sont pas imposables : seules
    les ventes contre euros et les paiements en crypto comptent.
  </p>
</section>

{#if !fiscal.ok}
  <p class="notice" role="alert"><span><strong>Calcul impossible.</strong> {fiscal.message}</span></p>
{:else}
  {#if missing.length > 0}
    <div class="notice missing" role="status">
      <div>
        <p>
          <strong>{missing.length === 1 ? 'Une cession est exclue' : `${missing.length} cessions sont exclues`} du calcul</strong> : il manque la
          valeur totale de votre portefeuille au moment de la vente.
        </p>
        <ul>
          {#each missing as m (m.transactionId)}
            <li>
              <span>{txLabel(m.transactionId)}</span>
              <button class="btn btn-small" type="button" onclick={() => ui.edit(m.transactionId)}>Renseigner</button>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}

  {#if warnings.length > 0}
    {#each warnings as w}
      <p class="notice" role="status"><span><strong>À vérifier.</strong> {w.message}</span></p>
    {/each}
  {/if}

  {#if years.length === 0}
    <section class="none">
      <h2>Aucune cession imposable</h2>
      <p class="muted">
        Tant que vous ne vendez pas contre euros et ne payez rien en crypto, vous n'avez aucune plus-value à déclarer. Pensez quand même à
        déclarer vos comptes ouverts à l'étranger (formulaire 3916-bis).
      </p>
    </section>
  {:else if year}
    <nav class="years" aria-label="Année de cession">
      {#each years as y (y.year)}
        <button type="button" aria-pressed={y.year === year.year} onclick={() => (selected = y.year)}>
          {y.year}
          {#if fiscal.result.incompleteYears.includes(y.year)}<span class="dot" title="Année incomplète"></span>{/if}
        </button>
      {/each}
    </nav>

    <section class="year panel" aria-labelledby="year-title">
      <div class="year-head">
        <h2 id="year-title">Cessions {year.year}</h2>
        <p class="muted">À déclarer au printemps {year.year + 1}</p>
      </div>

      <dl class="figures">
        <div>
          <dt>Total des cessions</dt>
          <dd class="num">{eur(year.totalCessionPrices)}</dd>
          <dd class="sub">
            {#if year.exempt}
              <span class="gain">Exonéré : n'excède pas {eurWhole(EXEMPTION_THRESHOLD_EUR)}</span>
            {:else}
              Au-delà du seuil de {eurWhole(EXEMPTION_THRESHOLD_EUR)}
            {/if}
          </dd>
        </div>
        <div>
          <dt>Plus-value nette</dt>
          <dd class={`num ${tone(year.netGain)}`}>{eur(year.netGain)}</dd>
          <dd class="sub">{year.cessions.length} cession{year.cessions.length > 1 ? 's' : ''}</dd>
        </div>
        <div>
          <dt>Base imposable</dt>
          <dd class="num">{eurWhole(year.taxableGainRounded)}</dd>
          <dd class="sub">
            {#if year.netGain.lt(0)}Moins-value non reportable{:else if year.exempt}Exonération{:else}Case 3AN de la 2042 C{/if}
          </dd>
        </div>
        <div>
          <dt>Impôt estimé (flat tax)</dt>
          <dd class="num tax">{eurWhole(year.estimatedTax)}</dd>
          <dd class="sub rate">
            <label>
              <span>Taux</span>
              <input
                inputmode="decimal"
                value={ratePercent(year.rate)}
                aria-invalid={rateError}
                aria-describedby="rate-help"
                onchange={(e) => onRate(e.currentTarget.value)}
              />
              <span aria-hidden="true">%</span>
            </label>
          </dd>
        </div>
      </dl>
      <p id="rate-help" class="rate-help muted">
        Taux par défaut pour {year.year} : {percent(defaultRateFor(year.year))}.
        {#if rateOverridden}
          <button class="link" type="button" onclick={() => year && app.setRate(year.year, undefined)}>Revenir au taux par défaut</button>
        {/if}
        L'option pour le barème progressif n'est pas simulée.
      </p>
      {#if year.netGain.lt(0)}
        <p class="rate-help muted">Une moins-value nette se déclare en case 3BN mais ne se reporte pas sur les années suivantes.</p>
      {/if}
    </section>

    <section class="register" aria-labelledby="register-title">
      <div class="register-head">
        <h2 id="register-title">Détail des cessions</h2>
        <p class="muted">Dans l'ordre des lignes du formulaire 2086, une colonne par cession.</p>
      </div>
      <div class="panel sheet">
        <table>
          <thead>
            <tr>
              <th scope="col" class="n"><span class="sr-only">Ligne</span></th>
              <th scope="col" class="label-col"><span class="sr-only">Libellé</span></th>
              {#each year.cessions as c, i (c.ref ?? i)}
                <th scope="col" class="col">
                  Cession {i + 1}
                  {#if c.ref}
                    <button class="link" type="button" onclick={() => c.ref && ui.edit(c.ref)}>Modifier</button>
                  {/if}
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each lines as line}
              <tr class:total={line.strong}>
                <td class="n">{line.n}</td>
                <th scope="row" class="label-col">{line.label}</th>
                {#each year.cessions as c, i (c.ref ?? i)}
                  <td class={`num ${line.strong ? tone(c.gain) : ''}`}>{line.value(c)}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="cards">
        {#each year.cessions as c, i (c.ref ?? i)}
          <div class="panel card">
            <div class="card-head">
              <h3>Cession {i + 1}</h3>
              {#if c.ref}<button class="link" type="button" onclick={() => c.ref && ui.edit(c.ref)}>Modifier</button>{/if}
            </div>
            <dl>
              {#each lines as line}
                <div class:total={line.strong}>
                  <dt><span class="n-inline">{line.n}</span> {line.label}</dt>
                  <dd class={`num ${line.strong ? tone(c.gain) : ''}`}>{line.value(c)}</dd>
                </div>
              {/each}
            </dl>
          </div>
        {/each}
      </div>
      <p class="muted foot">
        Les soultes (lignes 216 à 218 et 222) ne sont pas encore gérées. Le récapitulatif prêt à reporter, arrondi à l'euro, arrive dans une
        prochaine version.
      </p>
    </section>
  {/if}
{/if}

<style>
  .intro {
    display: grid;
    gap: 0.4rem;
    max-width: 46rem;
  }
  .intro h1 {
    font-size: clamp(1.6rem, 3.5vw, 2.1rem);
  }
  .missing {
    display: block;
  }
  .missing ul {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
  }
  .missing li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .none {
    display: grid;
    gap: 0.4rem;
    max-width: 40rem;
  }
  .years {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
  }
  .years button {
    font: inherit;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    padding: 0.35rem 0.85rem;
    border-radius: 999px;
    border: 1px solid var(--rule-strong);
    background: var(--surface);
    color: var(--ink);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .years button[aria-pressed='true'] {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
  }
  .dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--warn);
  }
  .year {
    padding: 1.15rem 1.25rem 1rem;
    display: grid;
    gap: 1rem;
  }
  .year-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .year-head h2 {
    font-size: 1.35rem;
  }
  .figures {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    margin: 0;
    border-top: 1px solid var(--rule);
  }
  .figures > div {
    padding: 0.85rem 1rem 0.2rem;
    border-left: 1px solid var(--rule);
  }
  .figures > div:first-child {
    border-left: 0;
    padding-left: 0;
  }
  dt {
    font-size: 0.82rem;
    color: var(--muted);
  }
  dd {
    margin: 0.15rem 0 0;
    font-size: 1.3rem;
    font-weight: 600;
  }
  dd.tax {
    color: var(--accent);
  }
  dd.sub {
    font-size: 0.8rem;
    font-weight: 400;
    color: var(--muted);
  }
  .rate label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .rate input {
    width: 4.2rem;
    padding: 0.15rem 0.35rem;
    text-align: right;
    font-size: 0.85rem;
  }
  .rate-help {
    font-size: 0.82rem;
  }
  .link {
    font: inherit;
    font-size: inherit;
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
  }
  .register {
    display: grid;
    gap: 0.75rem;
  }
  .register-head {
    display: grid;
    gap: 0.2rem;
  }
  .register-head h2 {
    font-size: 1.3rem;
  }
  .register-head p,
  .foot {
    font-size: 0.85rem;
  }
  .sheet {
    overflow-x: auto;
  }
  .sheet table {
    min-width: max-content;
    width: 100%;
  }
  .sheet th,
  .sheet td {
    padding: 0.55rem 0.9rem;
  }
  /* Numéros de ligne du formulaire 2086 : la colonne qui fait la page. */
  .n {
    font-family: var(--font-doc);
    font-variant-numeric: lining-nums tabular-nums;
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--accent);
    width: 3.5rem;
    text-align: right !important;
    border-right: 1px solid var(--rule);
    background: var(--surface-2);
    position: sticky;
    left: 0;
  }
  .label-col {
    text-align: left;
    font-weight: 450;
    color: var(--ink);
    font-size: 0.9rem;
    max-width: 22rem;
    white-space: normal;
  }
  thead .col {
    color: var(--ink);
    font-size: 0.85rem;
  }
  thead .col .link {
    display: block;
    margin-left: auto;
    font-weight: 400;
    font-size: 0.78rem;
  }
  tr.total > * {
    border-top: 2px solid var(--rule-strong);
    border-bottom: 0;
    font-weight: 650;
  }
  .cards {
    display: none;
  }
  @media (max-width: 640px) {
    .sheet {
      display: none;
    }
    .cards {
      display: grid;
      gap: 0.75rem;
    }
    .card {
      padding: 0.75rem 0.9rem;
    }
    .card-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 0.4rem;
    }
    .card-head h3 {
      font-size: 1.05rem;
    }
    .card dl {
      margin: 0;
      display: grid;
    }
    .card dl > div {
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.4rem 0;
      border-top: 1px solid var(--rule);
    }
    .card dt {
      font-size: 0.85rem;
      color: var(--ink);
    }
    .card dd {
      margin: 0;
      font-size: 0.9rem;
      font-weight: 500;
      white-space: nowrap;
    }
    .card .total {
      border-top: 2px solid var(--rule-strong);
    }
    .card .total dd,
    .card .total dt {
      font-weight: 650;
    }
    .n-inline {
      font-family: var(--font-doc);
      font-weight: 600;
      color: var(--accent);
      margin-right: 0.3rem;
      font-variant-numeric: lining-nums tabular-nums;
    }
  }
  @media (max-width: 860px) {
    .figures {
      grid-template-columns: repeat(2, 1fr);
    }
    .figures > div:nth-child(3) {
      border-left: 0;
      padding-left: 0;
    }
    .figures > div:nth-child(n + 3) {
      border-top: 1px solid var(--rule);
    }
    .label-col {
      min-width: 12rem;
    }
  }
</style>
