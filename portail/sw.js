/* ============================================================
   AfriKfables — service worker.

   Deux rôles :
   1. rendre le site installable comme une application ;
   2. garder les fichiers déjà écoutés sur le téléphone, pour
      qu'une famille ne repaie pas ses données chaque soir.

   Principe : on ne met en cache que ce qui ne change jamais
   (voix, images, icônes). Le portail et le contenu passent
   toujours par le réseau, sinon une publication resterait invisible.

   La VERSION change à chaque déploiement — l'ancien cache est
   supprimé, le bandeau de mise à jour s'affiche.
   ============================================================ */

/* La version est passée dans l'URL : /sw.js?v=2026-09-16-a.
   Si le paramètre est absent, on utilise 'v1' comme avant. */
const VERSION = 'afrikfables-' + (new URL(self.location).searchParams.get('v') || 'v1');
const DURABLE = /\.(mp3|webp|png|ico|woff2)$/i;

self.addEventListener('install', (e) => {
  /* Forcer l'activation immédiate sans attendre que les onglets se ferment. */
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  /* Supprimer les anciens caches dès l'activation. */
  e.waitUntil(
    caches.keys().then((noms) =>
      Promise.all(noms.filter((n) => n !== VERSION).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  /* Jamais de cache pour l'API ni pour le contenu éditorial :
     une publication doit se voir immédiatement. */
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.endsWith('contenu.json')) return;
  if (url.origin !== self.location.origin) return;

  /* Les voix et les images ne changent jamais : on les sert
     depuis le téléphone si on les a déjà. */
  if (DURABLE.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then((garde) => {
        if (garde) return garde;
        return fetch(e.request).then((rep) => {
          if (rep && rep.status === 200) {
            const copie = rep.clone();
            caches.open(VERSION).then((c) => c.put(e.request, copie));
          }
          return rep;
        });
      })
    );
    return;
  }

  /* Le portail : le réseau d'abord, le cache en secours.
     Une coupure ne doit pas donner un écran blanc. */
  if (url.pathname === '/' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request).then((rep) => {
        if (rep && rep.status === 200) {
          const copie = rep.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copie));
        }
        return rep;
      }).catch(() => caches.match(e.request))
    );
  }
});
