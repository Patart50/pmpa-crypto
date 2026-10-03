<script lang="ts">
  /** Choix du fuseau horaire d'un export (heure de Paris ou décalage UTC fixe). */
  interface Props {
    value: number | null;
    label: string;
    allowParis?: boolean;
    hint?: string;
  }
  let { value = $bindable(), label, allowParis = true, hint }: Props = $props();

  const offsets = [
    ...Array.from({ length: 27 }, (_, i) => (i - 12) * 60),
    330,
  ].sort((a, b) => a - b);
  const fmt = (m: number) => {
    const sign = m < 0 ? '−' : '+';
    const abs = Math.abs(m);
    return `UTC${m === 0 ? '' : `${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : ''}`}`;
  };

  let raw = $state(value === null ? 'paris' : String(value));
  $effect(() => {
    value = raw === 'paris' ? null : Number(raw);
  });
</script>

<label class="field">
  <span>{label}</span>
  <select bind:value={raw}>
    {#if allowParis}<option value="paris">Heure de Paris</option>{/if}
    {#each offsets as o}<option value={String(o)}>{fmt(o)}</option>{/each}
  </select>
  {#if hint}<small>{hint}</small>{/if}
</label>
