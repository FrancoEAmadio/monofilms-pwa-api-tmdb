// Cambiar la versión cada vez que se modifiquen los archivos, así los usuarios reciben la nueva
const CACHE_NAME = "monofilms-v2";

// Antes se apuntaba a ./imagenes/ICONOS/..., carpeta que no existe: eso hacía fallar la instalación.
const ARCHIVOS_CACHE = [
    "./",
    "./index.html",
    "./offline.html",
    "./estilos.css",
    "./app.js",
    "./manifest.json",
    "./LOGO-APP.png",
    "./icono-192.png",
    "./icono-512.png"
];

// Instalación: guardo los archivos de la app y activo la versión nueva sin esperar
self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ARCHIVOS_CACHE))
            .then(() => self.skipWaiting())
    );
});

// Activación: borro las cachés de versiones anteriores
self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

// Estrategia Stale While Revalidate: respondo rápido con la caché y actualizo en segundo plano
self.addEventListener("fetch", event => {
    const pedido = event.request;
    if (pedido.method !== "GET" || !pedido.url.startsWith("http")) return;

    event.respondWith(
        caches.match(pedido).then(respuestaCache => {
            const peticionRed = fetch(pedido)
                .then(respuestaRed => {
                    if (respuestaRed && respuestaRed.status === 200) {
                        const copia = respuestaRed.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(pedido, copia));
                    }
                    return respuestaRed;
                })
                .catch(() => {
                    if (respuestaCache) return respuestaCache;
                    if (pedido.mode === "navigate") return caches.match("./offline.html");
                    return new Response("Network error", { status: 503, statusText: "Service Unavailable" });
                });

            return respuestaCache || peticionRed;
        })
    );
});
