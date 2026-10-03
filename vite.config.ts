import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';

/**
 * Génère un service worker minimal qui met en cache tous les fichiers du
 * build : l'application fonctionne ensuite hors ligne. Aucune dépendance
 * tierce, aucun appel réseau autre que vers le site lui-même.
 */
function offlineServiceWorker(): Plugin {
  return {
    name: 'pmpa-offline-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      // Polices : seuls les jeux latins sont pré-chargés ; les autres alphabets
      // sont mis en cache à la demande s'ils servent un jour.
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && !/(cyrillic|greek|vietnamese)/.test(f));
      const precache = ['./', './favicon.svg', ...files.map((f) => `./${f}`)];
      const version = createHash('sha256').update(precache.join('|')).digest('hex').slice(0, 12);
      const source = `// Généré au build. Ne pas modifier.
const CACHE = 'pmpa-crypto-${version}';
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pmpa-crypto-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // Réseau d'abord pour la page (mises à jour), cache si hors ligne.
    event.respondWith(fetch(request).catch(() => caches.match('./', { ignoreSearch: true })));
    return;
  }
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Chemins relatifs : fonctionne à la racine d'un domaine comme sous /pmpa-crypto/ (GitHub Pages).
  base: './',
  plugins: [svelte(), offlineServiceWorker()],
});
