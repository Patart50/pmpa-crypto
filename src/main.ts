import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

const app = mount(App, {
  target: document.getElementById('app')!,
});

// Hors ligne : service worker généré au build (absent en développement).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Non bloquant : l'application fonctionne sans, simplement pas hors ligne.
    });
  });
}

export default app;
