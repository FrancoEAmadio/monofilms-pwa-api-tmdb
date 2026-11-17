// Registramos el Service Worker para habilitar la PWA (instalación y funcionamiento offline)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .catch(error => console.error('Error al registrar el SW:', error));
    });
}

// ── CONFIGURACIÓN GENERAL ─────────────────────────────────────────────────────
const TOKEN_TMDB    = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI3YjI0MzdmNmNmMGI2MWY2MzA1NTBhNDc4ZTJhNjBhMSIsIm5iZiI6MTc4MTM2MzQ0Ny4zMTAwMDAyLCJzdWIiOiI2YTJkNzJmNzBiMjI0MzRmZDE4MGQ0NzIiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.zjNcvxSxbrE1-juwKnyZkpjWu2z90SRSODW21P3OqSU';
const URL_BASE      = 'https://api.themoviedb.org/3';
const URL_POSTER    = 'https://image.tmdb.org/t/p/w500';
const URL_BACKDROP  = 'https://image.tmdb.org/t/p/original';
// En pantallas chicas el fondo del banner se pide más liviano
const URL_BACKDROP_MOVIL = 'https://image.tmdb.org/t/p/w780';

const POSTER_FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='450' viewBox='0 0 300 450'%3E%3Crect width='300' height='450' fill='%230f172a'/%3E%3Ctext x='150' y='225' text-anchor='middle' font-family='Arial' font-size='14' font-weight='bold' fill='%234f566b'%3ESin P%C3%B3ster%3C/text%3E%3C/svg%3E";

const GENEROS_TMDB = {
    movie: { accion: '28',    comedia: '35', animacion: '16', cienciaficcion: '878'   },
    tv:    { accion: '10759', comedia: '35', animacion: '16', cienciaficcion: '10765' }
};

const CLAVE_FAVORITOS = 'monofilms_favoritos';
const CLAVE_RECIENTES = 'monofilms_recientes';

let contenidoCargado  = [];
let tipoContenido     = 'movie';
let peliculasHero     = [];
let indiceHero        = 0;
let timerHero         = null;
let controladorFetch  = null;
let vistaActual       = 'inicio';   // 'inicio' | 'busqueda' | 'favoritos'
let eventoInstalacion = null;
window.isDragging     = false;

const $ = id => document.getElementById(id);

// Evita que un título con caracteres raros rompa el HTML
function escaparHTML(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const esPantallaChica = () => window.matchMedia('(max-width: 768px)').matches;

// ── API ───────────────────────────────────────────────────────────────────────
async function consultarAPI(endpoint, parametros = {}, señalAborto = null) {
    if (!TOKEN_TMDB) return null;

    const parametrosURL = new URLSearchParams({
        language: 'es-ES',
        'vote_count.gte': '150',
        ...parametros
    });

    const respuesta = await fetch(
        `${URL_BASE}${endpoint}?${parametrosURL}`,
        {
            headers: {
                Authorization: `Bearer ${TOKEN_TMDB}`,
                Accept: 'application/json'
            },
            ...(señalAborto && { signal: señalAborto })
        }
    );

    if (respuesta.status === 503) {
        const cuerpo = await respuesta.json().catch(() => ({}));
        if (cuerpo.error === 'offline') throw new Error('OFFLINE');
        throw new Error('SERVER_ERROR');
    }

    const datos = await respuesta.json();
    return datos.results || datos || [];
}

function guardarBusquedaLocal(textoBuscado, resultados) {
    try {
        localStorage.setItem(`monofilms_${textoBuscado.toLowerCase()}`, JSON.stringify(resultados));
    } catch { }
}

function recuperarBusquedaLocal(textoBuscado) {
    try {
        const guardado = localStorage.getItem(`monofilms_${textoBuscado.toLowerCase()}`);
        return guardado ? JSON.parse(guardado) : null;
    } catch {
        return null;
    }
}

// ── FAVORITOS (se guardan en el dispositivo) ─────────────────────────────────
function leerFavoritos() {
    try { return JSON.parse(localStorage.getItem(CLAVE_FAVORITOS)) || []; } catch { return []; }
}
function guardarFavoritos(lista) {
    try { localStorage.setItem(CLAVE_FAVORITOS, JSON.stringify(lista)); } catch { }
    actualizarContadoresFavoritos();
}
const esFavorito = id => leerFavoritos().some(f => f.id === Number(id));

function alternarFavorito(id) {
    const lista = leerFavoritos();
    const indice = lista.findIndex(f => f.id === Number(id));
    if (indice >= 0) {
        lista.splice(indice, 1);
        guardarFavoritos(lista);
        mostrarAviso('Quitado de favoritos');
        return false;
    }
    const item = contenidoCargado.find(p => p.id === Number(id));
    if (!item) return false;
    // Solo guardamos lo necesario para mostrar la tarjeta y la ficha
    const { id: idItem, title, name, poster_path, backdrop_path, overview, vote_average, release_date, first_air_date, media_type } = item;
    lista.unshift({ id: idItem, title, name, poster_path, backdrop_path, overview, vote_average, release_date, first_air_date, media_type: media_type || tipoContenido });
    guardarFavoritos(lista);
    mostrarAviso('Agregado a favoritos');
    return true;
}

function actualizarContadoresFavoritos() {
    const total = leerFavoritos().length;
    ['contadorFavsHeader', 'contadorFavsMenu', 'contadorFavsNav'].forEach(id => {
        const el = $(id);
        if (!el) return;
        el.textContent = total;
        el.hidden = total === 0;
    });
    document.querySelectorAll('.peli-card-horizontal').forEach(card => {
        card.classList.toggle('es-favorito', esFavorito(card.dataset.id));
    });
}

// ── TARJETAS ─────────────────────────────────────────────────────────────────
function registrarContenido(item) {
    if (!contenidoCargado.find(p => p.id === item.id)) contenidoCargado.push(item);
}

function crearTarjeta(pelicula) {
    const titulo     = escaparHTML(pelicula.title || pelicula.name || 'Título desconocido');
    const anio       = (pelicula.release_date || pelicula.first_air_date || '').split('-')[0] || 'S/D';
    const puntuacion = pelicula.vote_average ? '⭐ ' + pelicula.vote_average.toFixed(1) : 'Nuevo';
    const urlPoster  = pelicula.poster_path ? `${URL_POSTER}${pelicula.poster_path}` : POSTER_FALLBACK;

    registrarContenido(pelicula);

    return `
        <article class="peli-card-horizontal ${esFavorito(pelicula.id) ? 'es-favorito' : ''}" data-id="${pelicula.id}" tabindex="0" role="button" aria-label="Ver ficha de ${titulo}">
            <div class="poster-contenedor">
                <img src="${urlPoster}" alt="" class="peli-poster" loading="lazy" draggable="false" onerror="this.src='${POSTER_FALLBACK}'">
                <span class="fav-marca" aria-hidden="true"><svg><use href="#i-estrella"/></svg></span>
                <div class="card-overlay"><span class="btn-card-accion">Ver ficha</span></div>
            </div>
            <div class="peli-info">
                <h3 class="peli-titulo-tarjeta">${titulo}</h3>
                <div class="peli-meta-flex">
                    <span>${anio}</span>
                    <span class="peli-nota-badge">${puntuacion}</span>
                </div>
            </div>
        </article>`;
}

// ── BANNER (HERO) ────────────────────────────────────────────────────────────
function montarHero() {
    clearInterval(timerHero);
    const contenedorSlides = $('sliderWrapper');
    const contenedorPuntos = $('sliderDots');
    if (!contenedorSlides || !contenedorPuntos || !peliculasHero.length) return;

    const baseFondo = esPantallaChica() ? URL_BACKDROP_MOVIL : URL_BACKDROP;

    contenedorSlides.innerHTML = peliculasHero.map((pelicula, indice) => {
        registrarContenido(pelicula);
        const titulo   = escaparHTML(pelicula.title || pelicula.name);
        const urlFondo = pelicula.backdrop_path ? `${baseFondo}${pelicula.backdrop_path}` : '';
        return `
            <div class="slide-item ${indice === indiceHero ? 'active' : ''}" aria-hidden="${indice === indiceHero ? 'false' : 'true'}">
                <img src="${urlFondo}" class="slide-backdrop" alt="" ${indice === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}>
                <div class="slide-overlay">
                    <div class="slide-info-block">
                        <h2>${titulo}</h2>
                        <div class="slide-meta-datos">
                            <span class="badge-slide-nota">${pelicula.vote_average ? '⭐ ' + pelicula.vote_average.toFixed(1) : 'Estreno'}</span>
                            <span class="slide-anio-txt">Tendencia global</span>
                        </div>
                        <p class="slide-resumen">${escaparHTML(pelicula.overview || 'Sin sinopsis disponible en español.')}</p>
                        <button class="btn-explorar-ficha" data-ficha="${pelicula.id}">Ver ficha</button>
                    </div>
                </div>
            </div>`;
    }).join('');

    contenedorPuntos.innerHTML = peliculasHero.map((_, indice) =>
        `<button class="dot ${indice === indiceHero ? 'active' : ''}" data-slide="${indice}" aria-label="Ir al destacado ${indice + 1}"></button>`
    ).join('');

    reiniciarTimerHero();
}

function reiniciarTimerHero() {
    clearInterval(timerHero);
    if (peliculasHero.length < 2) return;
    timerHero = setInterval(() => {
        indiceHero = (indiceHero + 1) % peliculasHero.length;
        actualizarHero();
    }, 6000);
}

function saltarSlide(indice) {
    if (!peliculasHero.length) return;
    indiceHero = (indice + peliculasHero.length) % peliculasHero.length;
    actualizarHero();
    reiniciarTimerHero();
}

function actualizarHero() {
    document.querySelectorAll('.slide-item').forEach((slide, i) => {
        slide.classList.toggle('active', i === indiceHero);
        slide.setAttribute('aria-hidden', i === indiceHero ? 'false' : 'true');
    });
    document.querySelectorAll('.dot').forEach((punto, i) => punto.classList.toggle('active', i === indiceHero));
}

// ── FICHA ────────────────────────────────────────────────────────────────────
function abrirModal(id) {
    const modal = $(id);
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add('modal-abierto');
    requestAnimationFrame(() => modal.classList.add('visible'));
    modal.querySelector('.btn-cerrar-modal')?.focus({ preventScroll: true });
}

function cerrarModal(id) {
    const modal = $(id);
    if (!modal || modal.hidden) return;
    modal.classList.remove('visible');
    document.body.classList.remove('modal-abierto');
    setTimeout(() => { modal.hidden = true; }, 220);
}

window.abrirFicha = function(idPelicula) {
    if (window.isDragging) return;

    const id = Number(idPelicula);
    const pelicula = contenidoCargado.find(p => p.id === id) || leerFavoritos().find(p => p.id === id);
    if (!pelicula) return;
    registrarContenido(pelicula);

    const cuerpo = $('modalCuerpo');
    if (!cuerpo) return;

    const titulo   = escaparHTML(pelicula.title || pelicula.name);
    const fecha    = pelicula.release_date || pelicula.first_air_date;
    const fechaTxt = fecha ? new Date(fecha + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Sin fecha';
    const fondo    = pelicula.backdrop_path ? `${URL_BACKDROP_MOVIL}${pelicula.backdrop_path}` : (pelicula.poster_path ? `${URL_POSTER}${pelicula.poster_path}` : '');
    const tipo     = (pelicula.media_type || tipoContenido) === 'tv' ? 'Serie' : 'Película';
    const fav      = esFavorito(id);

    cuerpo.innerHTML = `
        <div class="ficha-header">
            ${fondo ? `<img src="${fondo}" class="ficha-backdrop" alt="">` : ''}
            <div class="ficha-gradiente"></div>
        </div>
        <div class="ficha-info">
            <span class="ficha-tipo">${tipo}</span>
            <h2 class="ficha-titulo" id="fichaTitulo">${titulo}</h2>
            <div class="ficha-tags">
                <span>📅 ${fechaTxt}</span>
                <span>${pelicula.vote_average ? '⭐ ' + pelicula.vote_average.toFixed(1) + ' / 10' : 'Sin calificaciones todavía'}</span>
            </div>
            <p class="ficha-sinopsis">${escaparHTML(pelicula.overview || 'Sin sinopsis en español disponible.')}</p>
            <button class="btn-favorito ${fav ? 'activo' : ''}" data-fav="${id}" aria-pressed="${fav}">
                <svg><use href="#${fav ? 'i-estrella' : 'i-estrella-borde'}"/></svg>
                <span>${fav ? 'En tus favoritos' : 'Agregar a favoritos'}</span>
            </button>
        </div>`;

    abrirModal('modalFicha');
};

// ── CARGA DE CARRUSELES ──────────────────────────────────────────────────────
async function cargarGrillas() {
    if (controladorFetch) controladorFetch.abort();
    controladorFetch = new AbortController();

    const idsGenero      = GENEROS_TMDB[tipoContenido];
    const nombresRieles  = ['riel-populares', 'riel-accion', 'riel-comedia', 'riel-animacion', 'riel-cienciaficcion'];
    const endpointGenero = tipoContenido === 'movie' ? '/discover/movie' : '/discover/tv';
    const señal          = controladorFetch.signal;

    nombresRieles.forEach(idRiel => {
        const riel = $(idRiel);
        if (riel) riel.innerHTML = Array.from({ length: 7 }, () => '<div class="peli-card-horizontal esqueleto" aria-hidden="true"><div class="poster-contenedor"></div><div class="peli-info"><span></span><span></span></div></div>').join('');
    });

    try {
        const peticiones = await Promise.allSettled([
            consultarAPI(endpointGenero, { sort_by: 'popularity.desc', page: 1 }, señal),
            consultarAPI(endpointGenero, { with_genres: idsGenero.accion,         sort_by: 'popularity.desc' }, señal),
            consultarAPI(endpointGenero, { with_genres: idsGenero.comedia,        sort_by: 'popularity.desc' }, señal),
            consultarAPI(endpointGenero, { with_genres: idsGenero.animacion,      sort_by: 'popularity.desc' }, señal),
            consultarAPI(endpointGenero, { with_genres: idsGenero.cienciaficcion, sort_by: 'popularity.desc' }, señal),
            consultarAPI(`/trending/${tipoContenido}/week`, {}, señal)
        ]);

        if (señal.aborted) return;

        peticiones.slice(0, 5).forEach((peticion, i) => {
            const riel = $(nombresRieles[i]);
            if (!riel) return;
            if (peticion.status === 'fulfilled' && peticion.value && peticion.value.length) {
                riel.innerHTML = peticion.value.map(item => crearTarjeta({ ...item, media_type: tipoContenido })).join('');
            } else {
                riel.innerHTML = '<div class="loader-mensaje">No disponible sin conexión.</div>';
            }
        });

        const tendenciasSemanales = peticiones[5].value || [];
        if (tendenciasSemanales.length) {
            peliculasHero = tendenciasSemanales.filter(p => p.backdrop_path && p.overview).slice(0, 5)
                .map(p => ({ ...p, media_type: tipoContenido }));
            indiceHero = 0;
            montarHero();
        }

    } catch (error) {
        if (error.name === 'AbortError') return;
        nombresRieles.forEach(idRiel => {
            const riel = $(idRiel);
            if (riel) riel.innerHTML = '<div class="loader-mensaje">Sin conexión. Volvé a intentarlo.</div>';
        });
    }
}

// ── VISTAS: INICIO / BÚSQUEDA / FAVORITOS ────────────────────────────────────
function mostrarVistaLista(titulo) {
    document.body.classList.add('busqueda-activa');
    $('bloques-estandar').hidden = true;
    $('resultados-busqueda').hidden = false;
    $('tituloResultados').textContent = titulo;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function marcarNavInferior(clave) {
    document.querySelectorAll('.nav-inf-item').forEach(b => b.classList.toggle('active-inf', b.dataset.nav === clave));
}

function guardarReciente(texto) {
    try {
        const lista = (JSON.parse(localStorage.getItem(CLAVE_RECIENTES)) || []).filter(t => t.toLowerCase() !== texto.toLowerCase());
        lista.unshift(texto);
        localStorage.setItem(CLAVE_RECIENTES, JSON.stringify(lista.slice(0, 6)));
    } catch { }
}

async function buscarContenido(textoBusqueda) {
    const texto = textoBusqueda?.trim();
    if (!texto) return;

    vistaActual = 'busqueda';
    marcarNavInferior('buscar');
    guardarReciente(texto);
    mostrarVistaLista(`Resultados para "${texto}"`);

    const grillaBusqueda = $('peliculas-buscadas');
    grillaBusqueda.innerHTML = '<div class="loader-mensaje">Buscando...</div>';

    const mostrarGuardados = () => {
        const resultadosGuardados = recuperarBusquedaLocal(texto);
        if (resultadosGuardados && resultadosGuardados.length) {
            grillaBusqueda.innerHTML = resultadosGuardados.map(crearTarjeta).join('');
        } else {
            window.location.href = './offline.html';
        }
    };

    if (!navigator.onLine) { mostrarGuardados(); return; }

    if (controladorFetch) controladorFetch.abort();
    controladorFetch = new AbortController();

    try {
        const resultadosAPI = await consultarAPI('/search/multi', { query: texto }, controladorFetch.signal);
        if (controladorFetch.signal.aborted) return;
        if (resultadosAPI === null) { mostrarGuardados(); return; }

        const resultadosFiltrados = resultadosAPI.filter(item => item.media_type !== 'person' && item.poster_path);

        if (resultadosFiltrados.length) {
            guardarBusquedaLocal(texto, resultadosFiltrados);
            grillaBusqueda.innerHTML = resultadosFiltrados.map(crearTarjeta).join('');
        } else {
            grillaBusqueda.innerHTML = `<p class="mensaje-vacio">No hubo resultados para "${escaparHTML(texto)}".</p>`;
        }
    } catch (error) {
        if (error.name === 'AbortError') return;
        mostrarGuardados();
    }
}

function mostrarFavoritos() {
    vistaActual = 'favoritos';
    marcarNavInferior('favoritos');
    mostrarVistaLista('Mis favoritos');
    const favoritos = leerFavoritos();
    $('peliculas-buscadas').innerHTML = favoritos.length
        ? favoritos.map(crearTarjeta).join('')
        : `<div class="mensaje-vacio">
               <svg><use href="#i-estrella-borde"/></svg>
               <p>Todavía no guardaste nada.</p>
               <p>Abrí la ficha de una película o serie y tocá <strong>Agregar a favoritos</strong>.</p>
           </div>`;
}

function volverAlInicio(recargar = true) {
    vistaActual = 'inicio';
    document.body.classList.remove('busqueda-activa');
    $('resultados-busqueda').hidden = true;
    $('bloques-estandar').hidden = false;
    const campoBusqueda = $('peliculaInput');
    if (campoBusqueda) campoBusqueda.value = '';
    marcarNavInferior(tipoContenido);
    if (recargar) cargarGrillas();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cambiarTipo(tipo) {
    if (!tipo) return;
    const cambio = tipo !== tipoContenido;
    tipoContenido = tipo;
    document.querySelectorAll('.tab-tipo').forEach(b => b.classList.toggle('active', b.dataset.type === tipo));
    const tituloPopulares = $('titulo-carrusel-1');
    if (tituloPopulares) tituloPopulares.textContent = tipo === 'movie' ? 'Películas populares' : 'Series populares';
    volverAlInicio(cambio || vistaActual !== 'inicio');
}

function irAGenero(genero) {
    document.querySelectorAll('.cat-item').forEach(c => c.classList.toggle('active', c.dataset.genre === genero));
    if (vistaActual !== 'inicio') volverAlInicio(false);
    const destino = genero
        ? document.querySelector(`.fila-carrusel-seccion[data-seccion="${genero}"]`)
        : null;
    const alto = $('header-wrapper').offsetHeight + 12;
    const top = destino ? destino.getBoundingClientRect().top + window.scrollY - alto : 0;
    window.scrollTo({ top, behavior: 'smooth' });
    // Mantiene visible el género elegido en la fila deslizable del teléfono
    document.querySelector(`.cat-item[data-genre="${genero}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}

// ── MENÚ LATERAL ─────────────────────────────────────────────────────────────
function abrirMenu() {
    $('menuFondo').hidden = false;
    $('menuLateral').setAttribute('aria-hidden', 'false');
    $('btnMenu').setAttribute('aria-expanded', 'true');
    document.body.classList.add('menu-abierto');
    requestAnimationFrame(() => $('menuFondo').classList.add('visible'));
}
function cerrarMenu() {
    $('menuLateral').setAttribute('aria-hidden', 'true');
    $('btnMenu').setAttribute('aria-expanded', 'false');
    document.body.classList.remove('menu-abierto');
    $('menuFondo').classList.remove('visible');
    setTimeout(() => { $('menuFondo').hidden = true; }, 250);
}

// ── BUSCADOR A PANTALLA COMPLETA (teléfono y tablet) ─────────────────────────
function abrirBuscador() {
    const overlay = $('buscadorOverlay');
    let recientes = [];
    try { recientes = JSON.parse(localStorage.getItem(CLAVE_RECIENTES)) || []; } catch { }
    $('buscadorRecientes').innerHTML = recientes.length
        ? `<p class="menu-titulo">Búsquedas recientes</p>` + recientes.map(t => `<button class="chip-reciente" data-reciente="${escaparHTML(t)}">${escaparHTML(t)}</button>`).join('')
        : '';
    overlay.hidden = false;
    document.body.classList.add('modal-abierto');
    requestAnimationFrame(() => {
        overlay.classList.add('visible');
        $('inputBuscarOverlay').focus();
    });
}
function cerrarBuscador() {
    const overlay = $('buscadorOverlay');
    if (overlay.hidden) return;
    overlay.classList.remove('visible');
    document.body.classList.remove('modal-abierto');
    $('inputBuscarOverlay').blur();
    setTimeout(() => { overlay.hidden = true; }, 200);
}

// ── AVISOS ───────────────────────────────────────────────────────────────────
let timerAviso = null;
function mostrarAviso(texto) {
    const toast = $('toast');
    toast.textContent = texto;
    toast.classList.add('visible');
    clearTimeout(timerAviso);
    timerAviso = setTimeout(() => toast.classList.remove('visible'), 2200);
}

// ── ACCIONES COMPARTIDAS (menú, pie, barra inferior) ────────────────────────
function ejecutarAccion(accion, dato) {
    switch (accion) {
        case 'tipo':      cambiarTipo(dato.type); break;
        case 'genero':    irAGenero(dato.genre ?? ''); break;
        case 'buscar':    abrirBuscador(); break;
        case 'favoritos': mostrarFavoritos(); break;
        case 'acerca':    abrirModal('modalAcerca'); break;
        case 'instalar':
            if (eventoInstalacion) {
                eventoInstalacion.prompt();
                eventoInstalacion.userChoice.finally(() => { eventoInstalacion = null; $('menuInstalar').hidden = true; });
            }
            break;
    }
}

// ── ARRANQUE ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    cargarGrillas();
    actualizarContadoresFavoritos();

    // Banner: flechas, puntos y deslizar con el dedo
    $('btnPrevHero')?.addEventListener('click', () => saltarSlide(indiceHero - 1));
    $('btnNextHero')?.addEventListener('click', () => saltarSlide(indiceHero + 1));
    $('sliderDots')?.addEventListener('click', e => {
        const punto = e.target.closest('[data-slide]');
        if (punto) saltarSlide(Number(punto.dataset.slide));
    });
    const hero = $('hero-slider');
    let toqueX = null, toqueY = null;
    hero?.addEventListener('touchstart', e => { toqueX = e.touches[0].clientX; toqueY = e.touches[0].clientY; }, { passive: true });
    hero?.addEventListener('touchend', e => {
        if (toqueX === null) return;
        const dx = e.changedTouches[0].clientX - toqueX;
        const dy = e.changedTouches[0].clientY - toqueY;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) saltarSlide(indiceHero + (dx < 0 ? 1 : -1));
        toqueX = null;
    }, { passive: true });

    // Carruseles: flechas (PC) y arrastre con mouse
    document.querySelectorAll('.slider-row-wrapper').forEach(filaCarrusel => {
        const carrusel  = filaCarrusel.querySelector('.carrusel-horizontal-contenedor');
        const flechaIzq = filaCarrusel.querySelector('.carrusel-arrow.left');
        const flechaDer = filaCarrusel.querySelector('.carrusel-arrow.right');
        if (carrusel && flechaIzq && flechaDer) {
            flechaIzq.addEventListener('click', () => carrusel.scrollBy({ left: -carrusel.clientWidth * 0.8, behavior: 'smooth' }));
            flechaDer.addEventListener('click', () => carrusel.scrollBy({ left:  carrusel.clientWidth * 0.8, behavior: 'smooth' }));
        }
    });

    document.querySelectorAll('.carrusel-horizontal-contenedor').forEach(carrusel => {
        let arrastrando = false, posicionInicial, scrollInicial;

        carrusel.addEventListener('mousedown', e => {
            arrastrando = true;
            window.isDragging = false;
            carrusel.classList.add('active-drag');
            posicionInicial = e.pageX - carrusel.offsetLeft;
            scrollInicial   = carrusel.scrollLeft;
        });
        const detenerArrastre = () => {
            arrastrando = false;
            carrusel.classList.remove('active-drag');
            setTimeout(() => window.isDragging = false, 50);
        };
        carrusel.addEventListener('mouseleave', detenerArrastre);
        carrusel.addEventListener('mouseup',    detenerArrastre);
        carrusel.addEventListener('mousemove', e => {
            if (!arrastrando) return;
            e.preventDefault();
            const desplazamiento = (e.pageX - carrusel.offsetLeft) - posicionInicial;
            if (Math.abs(desplazamiento) > 5) window.isDragging = true;
            carrusel.scrollLeft = scrollInicial - desplazamiento;
        });
    });

    // Un solo manejador de clics para todo lo que se genera dinámicamente
    document.addEventListener('click', e => {
        const tarjeta = e.target.closest('.peli-card-horizontal:not(.esqueleto)');
        if (tarjeta) { abrirFicha(tarjeta.dataset.id); return; }

        const btnFicha = e.target.closest('[data-ficha]');
        if (btnFicha) { abrirFicha(btnFicha.dataset.ficha); return; }

        const btnFav = e.target.closest('[data-fav]');
        if (btnFav) {
            const id = btnFav.dataset.fav;
            const ahora = alternarFavorito(id);
            btnFav.classList.toggle('activo', ahora);
            btnFav.setAttribute('aria-pressed', String(ahora));
            btnFav.querySelector('use').setAttribute('href', ahora ? '#i-estrella' : '#i-estrella-borde');
            btnFav.querySelector('span').textContent = ahora ? 'En tus favoritos' : 'Agregar a favoritos';
            if (vistaActual === 'favoritos') mostrarFavoritos();
            return;
        }

        const reciente = e.target.closest('[data-reciente]');
        if (reciente) { cerrarBuscador(); buscarContenido(reciente.dataset.reciente); return; }

        const cerrar = e.target.closest('[data-cerrar]');
        if (cerrar) { cerrarModal(cerrar.dataset.cerrar); return; }

        const conAccion = e.target.closest('[data-accion]');
        if (conAccion) {
            if (conAccion.closest('#menuLateral')) cerrarMenu();
            ejecutarAccion(conAccion.dataset.accion, conAccion.dataset);
        }
    });

    // Tarjetas con teclado
    document.addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.peli-card-horizontal')) {
            e.preventDefault();
            abrirFicha(e.target.dataset.id);
        }
        if (e.key === 'Escape') {
            cerrarModal('modalFicha');
            cerrarModal('modalAcerca');
            cerrarBuscador();
            if (document.body.classList.contains('menu-abierto')) cerrarMenu();
        }
    });

    // Géneros y tipo de contenido
    document.querySelectorAll('.cat-item').forEach(c => c.addEventListener('click', () => irAGenero(c.dataset.genre)));
    document.querySelectorAll('.tab-tipo').forEach(b => b.addEventListener('click', () => cambiarTipo(b.dataset.type)));

    // Buscador de PC
    $('formBuscarDesktop')?.addEventListener('submit', e => {
        e.preventDefault();
        buscarContenido($('peliculaInput').value);
    });

    // Buscador a pantalla completa
    $('btnBuscarHeader')?.addEventListener('click', abrirBuscador);
    $('btnCerrarBuscador')?.addEventListener('click', cerrarBuscador);
    $('formBuscarOverlay')?.addEventListener('submit', e => {
        e.preventDefault();
        const texto = $('inputBuscarOverlay').value;
        if (!texto.trim()) return;
        cerrarBuscador();
        buscarContenido(texto);
    });

    // Favoritos desde la cabecera
    $('btnFavoritosHeader')?.addEventListener('click', mostrarFavoritos);

    // Logo y "Volver al inicio"
    $('brand-logo')?.addEventListener('click', e => { e.preventDefault(); volverAlInicio(vistaActual !== 'inicio'); });
    $('btnVolverHome')?.addEventListener('click', () => volverAlInicio(false));

    // Menú lateral
    $('btnMenu')?.addEventListener('click', abrirMenu);
    $('btnCerrarMenu')?.addEventListener('click', cerrarMenu);
    $('menuFondo')?.addEventListener('click', cerrarMenu);

    // Barra inferior del teléfono
    document.querySelectorAll('.nav-inf-item').forEach(b => b.addEventListener('click', () => {
        const destino = b.dataset.nav;
        if (destino === 'buscar') abrirBuscador();
        else if (destino === 'favoritos') mostrarFavoritos();
        else cambiarTipo(destino);
    }));

    // Ficha y "Acerca de": cerrar con la X o tocando afuera
    $('btnCerrarModal')?.addEventListener('click', () => cerrarModal('modalFicha'));
    ['modalFicha', 'modalAcerca'].forEach(id => {
        $(id)?.addEventListener('click', e => { if (e.target.id === id) cerrarModal(id); });
    });

    // Instalación como app (aparece en el menú cuando el navegador lo permite)
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        eventoInstalacion = e;
        $('menuInstalar').hidden = false;
    });
    window.addEventListener('appinstalled', () => { $('menuInstalar').hidden = true; mostrarAviso('MonoFilms quedó instalada'); });

    // Si cambia mucho el ancho (girar la tablet), se piden fondos del tamaño correcto
    let anchoPrevio = esPantallaChica();
    window.addEventListener('resize', () => {
        const ahora = esPantallaChica();
        if (ahora !== anchoPrevio) { anchoPrevio = ahora; montarHero(); }
    });
});
