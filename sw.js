/**
 * Service Worker da Rádio GoMix
 *
 * Estratégia de cache:
 *   - Shell do app (HTML, CSS, JS, ícones): Cache First → resposta instantânea,
 *     mesmo offline. O usuário vê a UI mesmo sem internet.
 *   - Arquivos .mp3 (streaming): BYPASS total → nunca cacheados.
 *     Streams de áudio são muito grandes e mudam a cada requisição.
 *   - Chamadas de API (/api/*): Network First → sempre busca dados frescos.
 *     Faz fallback apenas se a rede falhar completamente.
 *
 * Por que não cachear o áudio?
 *   O sistema Faux-Live depende de buscar o áudio AGORA com o currentTime correto.
 *   Se o browser entregar um .mp3 cacheado, o seek pode ser ignorado ou inconsistente.
 */

const CACHE_NAME = 'radiogomix-shell-v1';

// Arquivos que compõem o "esqueleto" (shell) do PWA
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/logo.jpg',
];

// ─────────────────────────────────────────────────────────────────────────────
// INSTALL — Pré-cacheia o shell do app
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando e cacheando shell do app...');

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS);
    })
  );

  // Força a ativação imediata sem esperar as abas existentes fecharem
  self.skipWaiting();
});

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVATE — Limpa caches antigos de versões anteriores do SW
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Ativado. Limpando caches antigos...');

  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Removendo cache obsoleto:', name);
            return caches.delete(name);
          })
      )
    )
  );

  // Assume controle imediato de todas as abas abertas
  self.clients.claim();
});

// ─────────────────────────────────────────────────────────────────────────────
// FETCH — Intercepta todas as requisições de rede
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ── BYPASS 1: Streaming de áudio (.mp3) ──────────────────────────────────
  // Nunca intercepta requisições de áudio. O browser gerencia o range request
  // diretamente, o que é necessário para o seek funcionar corretamente.
  if (url.pathname.endsWith('.mp3') || url.pathname.includes('/storage/')) {
    return; // Deixa o browser lidar diretamente
  }

  // ── BYPASS 2: Chamadas de API ─────────────────────────────────────────────
  // Estratégia Network First: tenta a rede, usa cache como fallback de emergência.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // ── Shell do App: Cache First ─────────────────────────────────────────────
  // Para arquivos estáticos, entrega do cache imediatamente.
  // Atualiza o cache em background para a próxima visita (stale-while-revalidate).
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkFetch = fetch(event.request).then((networkResponse) => {
        // Atualiza o cache com a versão mais recente da rede
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return networkResponse;
      });

      return cachedResponse || networkFetch;
    })
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND SYNC — Mantém a rádio "viva" mesmo com tela apagada
// ─────────────────────────────────────────────────────────────────────────────
// O MediaSession API (configurado no index.html) é o mecanismo principal
// para manter o áudio rodando em background no mobile. Este SW garante que
// o shell do app esteja disponível para quando o usuário retornar à tela.

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
