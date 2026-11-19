// Service worker do CF Master: deixa o app abrir sem internet e ser instalado.
//
// - Arquivos do app (html, css, js, ícones): rede primeiro, com limite de tempo; sem rede
//   ou rede lenta, usa a cópia guardada. Assim uma versão nova publicada chega sozinha.
// - Fontes do Google: cópia guardada primeiro (não mudam).
// - `dados` e `checkins` não passam por aqui: o app já guarda os dois no IndexedDB e
//   precisa saber quando está sem rede.
//
// Troque VERSAO quando mudar a lista de arquivos abaixo.
const VERSAO = "cfmaster-v2";
const APP = [
  "./", "index.html", "manifest.webmanifest",
  "css/app.css",
  "js/app.js", "js/config.js", "js/cripto.js", "js/armazenamento.js", "js/modo.js",
  "marca/logo.png",
  "icones/icon-192.png", "icones/icon-512.png", "icones/icon-maskable-512.png", "icones/apple-touch-icon.png", "icones/favicon-32.png",
];
const FONTES = "cfmaster-fontes";
const LIMITE_REDE_MS = 3500;

self.addEventListener("install", (e) => {
  // Sem skipWaiting aqui: uma versão nova espera o coach tocar em "Atualizar o app"
  // no menu, para a tela não recarregar no meio da aula. Os arquivos do app já vêm
  // da rede quando há conexão, então isso só atrasa mudanças no próprio sw.js.
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(APP)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSAO && k !== FONTES) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => { if (e.data === "pular-espera") self.skipWaiting(); });

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(primeiroCache(req));
    return;
  }
  if (url.origin !== location.origin) return;
  const caminho = url.pathname.split("/").pop();
  if (caminho === "dados" || caminho === "checkins") return; // o app cuida desses dois
  e.respondWith(primeiroRede(req));
});

async function primeiroRede(req) {
  const cache = await caches.open(VERSAO);
  const chave = req.mode === "navigate" ? "index.html" : req;
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, falha) => setTimeout(() => falha(new Error("lento")), LIMITE_REDE_MS)),
    ]);
    if (res.ok) cache.put(chave, res.clone());
    return res;
  } catch {
    const guardado = await cache.match(chave, { ignoreSearch: true });
    if (guardado) return guardado;
    return fetch(req); // última tentativa: deixa o erro de rede chegar ao app
  }
}

async function primeiroCache(req) {
  const cache = await caches.open(FONTES);
  const guardado = await cache.match(req);
  if (guardado) return guardado;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}
