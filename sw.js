const CACHE_NAME = "monofilms-cache";

const ARCHIVOS_CACHE = [
    "./",
    "./index.html",
    "./offline.html",
    "./estilos.css",
    "./app.js",
    "./manifest.json",
    "./imagenes/ICONOS/LOGO-APP.png",
    "./imagenes/ICONOS/home.png",
    "./imagenes/ICONOS/HOMECELESTE.png",
    "./imagenes/ICONOS/busqueda.png",
    "./imagenes/ICONOS/BUSQUEDACELESTE.png",
    "./imagenes/ICONOS/favoritos.png",
    "./imagenes/ICONOS/FAVORITOSCELESTE.png"
];

// Instalación: abro la caché y guardo los archivos estáticos
self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(ARCHIVOS_CACHE);
            })
    );
});

// Activación: borro las cachés viejas si cambio la versión
self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.map(key => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        })
    );
});

// Estrategia Stale While Revalidate corregida para evitar errores offline
self.addEventListener("fetch", event => {
    event.respondWith(
        caches.match(event.request)
            .then(respuestaCache => {
                // Hago la petición para actualizar en segundo plano
                const peticionRed = fetch(event.request)
                    .then(respuestaRed => {
                        // Solo guardamos en caché si la respuesta es válida (status 200)
                        if (respuestaRed && respuestaRed.status === 200) {
                            return caches.open(CACHE_NAME).then(cache => {
                                cache.put(event.request, respuestaRed.clone());
                                return respuestaRed;
                            });
                        }
                        return respuestaRed;
                    })
                    .catch(error => {
                        // Si falla la red y NO tenemos este recurso en caché
                        if (!respuestaCache) {
                            // Si el usuario intentaba navegar a otra página, le tiramos el offline.html
                            if (event.request.mode === "navigate") {
                                return caches.match("./offline.html");
                            }
                            // Si era una fuente, una imagen o una API, devolvemos un error de red controlado
                            return new Response("Network error", { status: 503, statusText: "Service Unavailable" });
                        }
                    });

                // Devuelvo lo de caché si está, o espero a la red
                return respuestaCache || peticionRed;
            })
    );
});