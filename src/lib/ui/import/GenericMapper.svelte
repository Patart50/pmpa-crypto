<script lang="ts">
  /** Association des colonnes d'un CSV quelconque aux champs de l'outil. */
  import { untrack } from 'svelte';
  import type { CsvTable } from '../../import/csv';
  import {
    convertRow,
    distinctValues,
    FIELD_LABELS,
    guessDateFormat,
    guessDecimal,
    guessMapping,
    guessTypeValue,
    MAPPABLE_FIELDS,
    parseGeneric,
    type DateFormat,
    type DecimalSep,
    type Field,
    type GenericOptions,
    type Mapping,
    type TypeChoice,
  } from '../../import/generic';
  import type { FxAmount, ImportReport } from '../../import/common';
  import { TRANSACTION_LABELS, TRANSACTION_TYPES } from '../../core/transactions';
  import { dateFr } from '../format';
  import OffsetSelect from './OffsetSelect.svelte';

  interface Props {
    table: CsvTable;
    fileName: string;
    onreport: (report: ImportReport) => void;
    oncancel: () => void;
  }
  let { table, fileName, onreport, oncancel }: Props = $props();

  const init = untrack(() => {
    const mapping = guessMapping(table.headers);
    const col = (f: Field) => (mapping[f] === undefined ? [] : table.rows.slice(0, 200).map((r) => r[mapping[f]!] ?? ''));
    const numericSamples = (['inQty', 'outQty', 'eur', 'feeQty'] as Field[]).flatMap(col);
    return { mapping, dateFormat: guessDateFormat(col('date')), decimal: guessDecimal(numericSamples) };
  });

  // Les selects travaillent en chaînes : « » = non associé.
  let columns = $state<Record<Field, string>>(
    Object.fromEntries(MAPPABLE_FIELDS.map((f) => [f, init.mapping[f] === undefined ? '' : String(init.mapping[f])])) as Record<Field, string>,
  );
  let dateFormat = $state<DateFormat>(init.dateFormat);
  let decimal = $state<DecimalSep>(init.decimal);
  let offset = $state<number | null>(null);
  let platform = $state('');
  /** Devise des montants du fichier (D-047). */
  let currency = $state('EUR');
  let typeValues = $state<Record<string, TypeChoice | ''>>({});

  const mapping = $derived<Mapping>(
    Object.fromEntries(Object.entries(columns).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])) as Mapping,
  );
  const typeColumnValues = $derived(distinctValues(table, mapping.type));

  /** Choix de l'utilisateur, sinon proposition automatique. */
  const choiceFor = (v: string): TypeChoice | '' => typeValues[v] ?? guessTypeValue(v) ?? '';
  const effectiveTypes = $derived(
    Object.fromEntries(typeColumnValues.map((v) => [v, choiceFor(v)]).filter(([, c]) => c !== '')) as Record<string, TypeChoice>,
  );

  const options = $derived<GenericOptions>({
    fileName,
    mapping,
    typeValues: effectiveTypes,
    dateFormat,
    decimal,
    offsetMinutes: offset,
    platform: platform.trim() || undefined,
  });

  const preview = $derived(table.rows.slice(0, 6).map((row, i) => ({ row, result: convertRow(row, i, options) })));
  const missingTypes = $derived(typeColumnValues.filter((v) => !effectiveTypes[v]));
  const canContinue = $derived(mapping.date !== undefined && missingTypes.length === 0);

  /** Montants hors euros : déplacés vers la conversion au cours de la minute (D-047). */
  function withCurrency(report: ImportReport, cur: string): ImportReport {
    if (cur === 'EUR') return report;
    const fx: FxAmount[] = [];
    const transactions = report.transactions.map((t) => {
      const tx = { ...t };
      if (tx.eur) {
        fx.push({ txId: tx.id, field: 'eur', amount: tx.eur, currency: cur, date: tx.date });
        delete tx.eur;
      }
      if (tx.fee?.asset === 'EUR') {
        fx.push({ txId: tx.id, field: 'fee', amount: tx.fee.quantity, currency: cur, date: tx.date });
        delete tx.fee;
      }
      return tx;
    });
    return {
      ...report,
      transactions,
      currency: cur,
      fx,
      notes: [...report.notes, `${fx.length} montant${fx.length > 1 ? 's' : ''} en ${cur} : convertis en euros au cours Binance de la minute au moment de l'import.`],
    };
  }

  function describe(r: ReturnType<typeof convertRow>): string {
    if (r.ignored) return 'Ignorée';
    if (!r.tx) return r.error ?? '';
    const t = r.tx;
    const parts = [TRANSACTION_LABELS[t.type]];
    if (t.out) parts.push(`−${t.out.quantity} ${t.out.asset}`);
    if (t.in) parts.push(`+${t.in.quantity} ${t.in.asset}`);
    if (t.eur) parts.push(`${t.eur} €`);
    return parts.join(' · ');
  }
</script>

<div class="mapper">
  <p class="lead">
    Format non reconnu automatiquement. Indiquez quelle colonne de <strong>{fileName}</strong> correspond à chaque information. Les champs vides
    sont ignorés.
  </p>

  <div class="grid">
    {#each MAPPABLE_FIELDS as field}
      <label class="field">
        <span>{FIELD_LABELS[field]}{field === 'date' ? ' *' : ''}</span>
        <select id={`map-${field}`} bind:value={columns[field]}>
          <option value="">—</option>
          {#each table.headers as header, i}<option value={String(i)}>{header || `Colonne ${i + 1}`}</option>{/each}
        </select>
      </label>
    {/each}
  </div>

  <div class="grid formats">
    <label class="field">
      <span>Format des dates</span>
      <select id="map-date-format" bind:value={dateFormat}>
        <option value="iso">2026-03-25 (AAAA-MM-JJ)</option>
        <option value="dmy">25/03/2026 (JJ/MM/AAAA)</option>
        <option value="mdy">03/25/2026 (MM/JJ/AAAA)</option>
        <option value="unix">Horodatage Unix</option>
      </select>
    </label>
    <label class="field">
      <span>Séparateur décimal</span>
      <select id="map-decimal" bind:value={decimal}>
        <option value=",">Virgule (1 234,56)</option>
        <option value=".">Point (1,234.56)</option>
      </select>
    </label>
    <OffsetSelect bind:value={offset} label="Fuseau des dates" />
    <label class="field">
      <span>Devise des montants</span>
      <select id="map-currency" bind:value={currency}>
        <option value="EUR">Euro (EUR)</option>
        <option value="USD">Dollar (USD)</option>
        <option value="USDT">Tether (USDT)</option>
        <option value="USDC">USD Coin (USDC)</option>
      </select>
    </label>
    <label class="field">
      <span>Plateforme (si absente du fichier)</span>
      <input id="map-default-platform" bind:value={platform} placeholder="Kraken, Coinbase…" />
    </label>
  </div>

  {#if typeColumnValues.length > 0}
    <section class="types">
      <h3>Types d'opérations du fichier</h3>
      <div class="type-rows">
        {#each typeColumnValues as value}
          <label class="type-row">
            <span class="value">{value}</span>
            <select
              value={choiceFor(value)}
              aria-invalid={!effectiveTypes[value]}
              onchange={(e) => (typeValues[value] = e.currentTarget.value as TypeChoice | '')}
            >
              <option value="">À choisir…</option>
              {#each TRANSACTION_TYPES as t}<option value={t}>{TRANSACTION_LABELS[t]}</option>{/each}
              <option value="ignore">Ignorer ces lignes</option>
            </select>
          </label>
        {/each}
      </div>
    </section>
  {/if}

  <section class="preview">
    <h3>Aperçu</h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date lue</th><th>Résultat</th></tr></thead>
        <tbody>
          {#each preview as p}
            <tr class:bad={!p.result.tx && !p.result.ignored}>
              <td class="num">{p.result.tx ? dateFr(p.result.tx.date) : (p.row[mapping.date ?? -1] ?? '—')}</td>
              <td>{describe(p.result)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <div class="actions">
    <button class="btn" type="button" onclick={oncancel}>Annuler</button>
    <button class="btn btn-primary" type="button" disabled={!canContinue} onclick={() => onreport(withCurrency(parseGeneric(table, options), currency))}>
      {missingTypes.length > 0 ? `Choisissez le type de ${missingTypes.length} valeur${missingTypes.length > 1 ? 's' : ''}` : 'Analyser le fichier'}
    </button>
  </div>
</div>

<style>
  .mapper {
    display: grid;
    gap: 1.1rem;
  }
  .lead {
    font-size: 0.92rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: 0.6rem 0.75rem;
  }
  .formats {
    padding-top: 0.9rem;
    border-top: 1px solid var(--rule);
  }
  h3 {
    font-size: 1rem;
    margin-bottom: 0.5rem;
  }
  .type-rows {
    display: grid;
    gap: 0.35rem;
  }
  .type-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 14rem);
    align-items: center;
    gap: 0.6rem;
  }
  .value {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .preview table {
    font-size: 0.85rem;
  }
  .preview td:last-child,
  .preview th:last-child {
    text-align: left;
  }
  tr.bad td:last-child {
    color: var(--loss);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
</style>
