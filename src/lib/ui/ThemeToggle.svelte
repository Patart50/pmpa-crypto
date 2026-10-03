<script lang="ts">
  import { app } from '../state/app.svelte';
  import type { Theme } from '../storage/schema';

  const order: Theme[] = ['auto', 'light', 'dark'];
  const labels: Record<Theme, string> = { auto: 'Thème : automatique', light: 'Thème : clair', dark: 'Thème : sombre' };
  const current = $derived<Theme>(app.settings.theme ?? 'auto');

  function cycle() {
    app.setTheme(order[(order.indexOf(current) + 1) % order.length]);
  }
</script>

<button class="btn btn-quiet" type="button" onclick={cycle} title={labels[current]} aria-label={`${labels[current]}. Changer de thème`}>
  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
    {#if current === 'light'}
      <circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6" />
      <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4" />
      </g>
    {:else if current === 'dark'}
      <path d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5a6.5 6.5 0 1 0 8.1 8.1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
    {:else}
      <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6" />
      <path d="M10 3.5a6.5 6.5 0 0 1 0 13Z" fill="currentColor" />
    {/if}
  </svg>
</button>
