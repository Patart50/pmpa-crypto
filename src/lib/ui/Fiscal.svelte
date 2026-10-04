<script lang="ts">
  import { app } from '../state/app.svelte';
  import { DEFAULT_RATES, EXEMPTION_THRESHOLD_EUR, type CessionDetail } from '../core/fiscal';
  import { dateFr, eur, eurWhole, parseInput, percent, tone } from './format';
  import { ui } from './ui.svelte';
  import { TRANSACTION_LABELS, type Transaction } from '../core/transactions';
  import AutoValue from './AutoValue.svelte';
  import { buildDeclaration, estimatedTaxFromDeclaration, type DeclaredCession } from '../core/declaration';
  import type { Dec } from '../core/money';
  import { declarationCsv } from './declarationCsv';

  const fiscal = $derived(app.fiscal);
  const years = $derived(fiscal.ok ? fiscal.result.years : []);
  const missing = $derived(fiscal.ok ? fiscal.result.issues.filter((i) => i.code === 'MISSING_PORTFOLIO_VALUE') : []);
  const warnings = $derived(fiscal.ok ? fiscal.result.warnings : []);
  const missingTx = $derived(missing.map((m) => app.find(m.transactionId)).filter((t): t is Transaction => !!t));

  let selected = $state<number | null>(null);
  const year = $derived(years.find((y) => y.year === selected) ?? years[years.length - 1]);
  const declaration = $derived(fiscal.ok ? buildDeclaration(fiscal.result, EXEMPTION_THRESHOLD_EUR) : []);
  const declared = $derived(year ? declaration.find((d) => d.year === year.year) : undefined);
  const declaredTax = $derived(year && declared ? estimatedTaxFromDeclaration(declared, year.rate) : undefined);
  const incomplete = $derived(year && fiscal.ok ? fiscal.result.incompleteYears.includes(year.year) : false);
  /** Plateformes citées dans les transactions : candidates au 3916-bis. */
  const platforms = $derived([...new Set(app.transactions.map((t) => t.platform?.trim()).filter((p): p is string => !!p))].sort());
  let cents = $state(false);

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

  type Line = {
    n: string;
    label: string;
    exact: (c: CessionDetail) => string;
    whole: (d: DeclaredCession) => string;
    strong?: boolean;
    note?: string;
  };
  const w = (v: Dec) => eurWhole(v);
  const lines: Line[] = [
    { n: '211', label: 'Date de la cession', exact: (c) => dateFr(c.date, false), whole: (d) => dateFr(d.date, false) },
    { n: '212', label: 'Valeur globale du portefeuille au moment de la cession', exact: (c) => eur(c.portfolioValue), whole: (d) => w(d.l212) },
    { n: '213', label: 'Prix de cession', exact: (c) => eur(c.price), whole: (d) => w(d.l213) },
    { n: '214', label: 'Frais de cession', exact: (c) => eur(c.fees), whole: (d) => w(d.l214) },
    { n: '215', label: 'Prix de cession net des frais', exact: (c) => eur(c.netPrice), whole: (d) => w(d.l215), note: 'calculée' },
    { n: '216', label: 'Soulte reçue ou versée', exact: () => eur(0), whole: (d) => w(d.l216) },
    { n: '217', label: 'Prix de cession net des soultes', exact: (c) => eur(c.price), whole: (d) => w(d.l217), note: 'calculée' },
    { n: '218', label: 'Prix de cession net des frais et soultes', exact: (c) => eur(c.netPrice), whole: (d) => w(d.l218), note: 'calculée' },
    { n: '220', label: "Prix total d'acquisition", exact: (c) => eur(c.grossAcquisition), whole: (d) => w(d.l220) },
    { n: '221', label: 'Fractions de capital initial', exact: (c) => eur(c.previousFractions), whole: (d) => w(d.l221) },
    { n: '222', label: "Soultes reçues lors d'échanges antérieurs", exact: () => eur(0), whole: (d) => w(d.l222) },
    { n: '223', label: "Prix total d'acquisition net", exact: (c) => eur(c.netAcquisition), whole: (d) => w(d.l223), note: 'calculée' },
    { n: '224', label: 'Plus-value ou moins-value', exact: (c) => eur(c.gain), whole: (d) => w(d.l224), strong: true, note: 'calculée' },
  ];

  function exportCsv() {
    if (!declared) return;
    const blob = new Blob([declarationCsv(declared)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recapitulatif-2086-${declared.year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    ui.notify('Récapitulatif exporté en CSV.');
  }

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
        <AutoValue targets={missingTx} />
        <p class="muted manual">Ou une par une, à la main :</p>
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
    {#if missing.length > 0}
      <p class="muted">Le résultat s'affichera dès qu'une cession aura sa valeur de portefeuille.</p>
    {:else}
    <section class="none">
      <h2>Aucune cession imposable</h2>
      <p class="muted">
        Tant que vous ne vendez pas contre euros et ne payez rien en crypto, vous n'avez aucune plus-value à déclarer. Pensez quand même à
        déclarer vos comptes ouverts à l'étranger (formulaire 3916-bis).
      </p>
    </section>
    {/if}
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
          <dd class="num">{eurWhole(declared?.box === '3AN' ? declared.boxAmount : 0)}</dd>
          <dd class="sub">
            {#if declared?.box === '3BN'}Moins-value non reportable{:else if year.exempt}Exonération{:else}Case 3AN de la 2042 C{/if}
          </dd>
        </div>
        <div>
          <dt>Impôt estimé (flat tax)</dt>
          <dd class="num tax">{eurWhole(declaredTax ?? year.estimatedTax)}</dd>
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

    {#if declared}
      <section class="recap panel" aria-labelledby="recap-title">
        <div class="recap-head">
          <div>
            <h2 id="recap-title">À reporter sur votre déclaration {year.year + 1}</h2>
            <p class="muted">Montants en euros entiers, recalculés comme le fait le formulaire à partir de ce que vous saisissez.</p>
          </div>
          <div class="recap-actions no-print">
            <button class="btn btn-small" type="button" onclick={exportCsv}>Exporter en CSV</button>
            <button class="btn btn-small" type="button" onclick={() => window.print()}>Imprimer ou PDF</button>
          </div>
        </div>

        {#if incomplete}
          <p class="notice" role="alert">
            <span><strong>Récapitulatif incomplet.</strong> Des cessions de {year.year} n'ont pas de valeur de portefeuille et n'y figurent pas.</span>
          </p>
        {/if}

        <div class="boxes">
          <div class="box">
            <span class="box-code">3AN</span>
            <span class="box-label">Plus-value nette, 2042 C</span>
            <span class="box-value num">{declared.box === '3AN' ? eurWhole(declared.boxAmount) : '—'}</span>
          </div>
          <div class="box">
            <span class="box-code">3BN</span>
            <span class="box-label">Moins-value nette, 2042 C</span>
            <span class="box-value num">{declared.box === '3BN' ? eurWhole(declared.boxAmount) : '—'}</span>
          </div>
          <div class="box">
            <span class="box-code">51</span>
            <span class="box-label">Total des prix de cession, 2086</span>
            <span class="box-value num">{eurWhole(declared.l51)}</span>
          </div>
          <div class="box">
            <span class="box-code">52</span>
            <span class="box-label">Total des plus et moins-values, 2086</span>
            <span class="box-value num">{eurWhole(declared.l52)}</span>
          </div>
        </div>

        {#if declared.exempt}
          <p class="muted small">Total des cessions de {eurWhole(year.totalCessionPrices)} : n'excède pas {eurWhole(EXEMPTION_THRESHOLD_EUR)}, aucune imposition.</p>
        {:else if declared.borderline}
          <p class="notice small" role="status">
            <span
              ><strong>Cas limite.</strong> Vos prix de cession bruts ({eurWhole(year.totalCessionPrices)}) dépassent {eurWhole(EXEMPTION_THRESHOLD_EUR)},
              mais la ligne 51, nette des frais, n'en est pas loin ({eurWhole(declared.l51)}). L'outil retient les prix bruts ; le formulaire peut
              conclure autrement.</span
            >
          </p>
        {/if}

        <ol class="checklist">
          <li>
            <strong>Formulaire 2086</strong> : une colonne par cession, avec les montants du tableau ci-dessous. Toutes les cessions de l'année doivent y
            figurer ({declared.cessions.length} en {year.year}).
          </li>
          <li>
            <strong>Déclaration 2042 C</strong> :
            {#if declared.box}reporter {eurWhole(declared.boxAmount)} en case {declared.box}.{:else}rien à reporter en 3AN ni 3BN.{/if}
          </li>
          <li>
            <strong>Formulaire 3916-bis</strong> : un par compte ouvert auprès d'une plateforme établie à l'étranger{platforms.length > 0
              ? ` (plateformes citées dans vos transactions : ${platforms.join(', ')})`
              : ''}, même sans aucune vente. Vérifiez le pays de l'entité dans les conditions d'utilisation. Amende de 750 € par compte non
            déclaré, 1 500 € si sa valeur a dépassé 50 000 €.
          </li>
        </ol>
      </section>
    {/if}

    <section class="register" aria-labelledby="register-title">
      <div class="register-head">
        <h2 id="register-title">Détail des cessions</h2>
        <p class="muted">Dans l'ordre des lignes du formulaire 2086, une colonne par cession. Les lignes « calculées » sont remplies par le formulaire.</p>
        <label class="cents no-print">
          <input type="checkbox" bind:checked={cents} />
          Afficher le calcul exact au centime
        </label>
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
                    <button class="link no-print" type="button" onclick={() => c.ref && ui.edit(c.ref)}>Modifier</button>
                  {/if}
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each lines as line}
              <tr class:total={line.strong} class:derived={!!line.note}>
                <td class="n">{line.n}</td>
                <th scope="row" class="label-col">{line.label}{#if line.note}<span class="calc">&nbsp;· {line.note}</span>{/if}</th>
                {#each year.cessions as c, i (c.ref ?? i)}
                  {@const d = declared?.cessions[i]}
                  <td class={`num ${line.strong ? tone(c.gain) : ''}`}>{cents || !d ? line.exact(c) : line.whole(d)}</td>
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
              {#if c.ref}<button class="link no-print" type="button" onclick={() => c.ref && ui.edit(c.ref)}>Modifier</button>{/if}
            </div>
            <dl>
              {#each lines as line}
                {@const d = declared?.cessions[i]}
                <div class:total={line.strong}>
                  <dt><span class="n-inline">{line.n}</span> {line.label}</dt>
                  <dd class={`num ${line.strong ? tone(c.gain) : ''}`}>{cents || !d ? line.exact(c) : line.whole(d)}</dd>
                </div>
              {/each}
            </dl>
          </div>
        {/each}
      </div>
      <p class="muted foot">
        Les échanges avec soulte ne sont pas gérés : lignes 216 et 222 à zéro. L'arrondi à l'euro peut écarter le résultat de quelques euros du
        calcul exact ; reportez les montants arrondis, c'est ce que le formulaire recalcule.
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
  .missing > div {
    display: grid;
    gap: 0.6rem;
    width: 100%;
  }
  .manual {
    font-size: 0.85rem;
    margin-top: 0.2rem;
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
  .recap {
    padding: 1.15rem 1.25rem;
    display: grid;
    gap: 0.9rem;
  }
  .recap-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.75rem 1rem;
    flex-wrap: wrap;
  }
  .recap-head h2 {
    font-size: 1.3rem;
  }
  .recap-head p {
    font-size: 0.85rem;
    margin-top: 0.15rem;
  }
  .recap-actions {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .boxes {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.6rem;
  }
  .box {
    display: grid;
    gap: 0.1rem;
    padding: 0.7rem 0.85rem;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    background: var(--surface-2);
  }
  .box-code {
    font-family: var(--font-doc);
    font-weight: 700;
    color: var(--accent);
    font-variant-numeric: lining-nums tabular-nums;
  }
  .box-label {
    font-size: 0.78rem;
    color: var(--muted);
  }
  .box-value {
    font-size: 1.25rem;
    font-weight: 650;
  }
  .small {
    font-size: 0.85rem;
  }
  .checklist {
    margin: 0;
    padding-left: 1.2rem;
    display: grid;
    gap: 0.45rem;
    font-size: 0.9rem;
  }
  .cents input {
    width: auto;
    margin: 0;
  }
  .cents {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    color: var(--muted);
    margin-top: 0.2rem;
  }
  .calc {
    color: var(--muted);
    font-size: 0.78rem;
  }
  tr.derived td.num {
    color: var(--muted);
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

  @media (max-width: 640px) {
    .sheet {
      display: none;
    }
    .cards {
      display: grid;
      gap: 0.75rem;
    }
  }
  @media print {
    .sheet {
      display: none;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.6rem;
    }
    .card {
      break-inside: avoid;
    }
  }
  @media (max-width: 860px) {
    .boxes {
      grid-template-columns: repeat(2, 1fr);
    }
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
