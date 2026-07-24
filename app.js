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

const POSTER_FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='450' viewBox='0 0 300 450'%3E%3Crect width='300' height='450' fill='%230f172a'/%3E%3Ctext x='150' y='225' text-anchor='middle' font-family='Arial' font-size='14' font-weight='bold' fill='%234f566b'%3ESin P%C3%B3ster%3C/text%3E%3C/svg%3E";

const GENEROS_TMDB = {
    movie: { accion: '28',    comedia: '35', animacion: '16', cienciaficcion: '878'   },
    tv:    { accion: '10759', comedia: '35', animacion: '16', cienciaficcion: '10765' }
};

let contenidoCargado  = [];
let tipoContenido     = 'movie';
let peliculasHero     = [];
let indiceHero        = 0;
let timerHero         = null;
let controladorFetch  = null;
window.isDragging     = false;

async function estaOnline() {
    if (!navigator.onLine) return false;
    try {
        const respuesta = await fetch(`${URL_BASE}/configuration`, {
            headers: { Authorization: `Bearer ${TOKEN_TMDB}` },
            cache: 'no-store',
            signal: AbortSignal.timeout(4000)
        });
        if (respuesta.status === 503) return false;
        return respuesta.ok;
    } catch {
        return false;
    }
}

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
        localStorage.setItem(
            `monofilms_${textoBuscado.toLowerCase()}`,
            JSON.stringify(resultados)
        );
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

function crearTarjeta(pelicula) {
    const titulo   = pelicula.title || pelicula.name || 'Título Desconocido';
    const anio     = (pelicula.release_date || pelicula.first_air_date || '').split('-')[0] || 'S/D';
    const puntuacion = pelicula.vote_average ? pelicula.vote_average.toFixed(1) : '0.0';
    const urlPoster  = pelicula.poster_path ? `${URL_POSTER}${pelicula.poster_path}` : POSTER_FALLBACK;

    if (!contenidoCargado.find(p => p.id === pelicula.id)) {
        contenidoCargado.push(pelicula);
    }

    return `
        <div class="peli-card-horizontal" onclick="abrirFicha(${pelicula.id})">
            <div class="poster-contenedor">
                <img src="${urlPoster}" alt="${titulo}" class="peli-poster" loading="lazy" onerror="this.src='${POSTER_FALLBACK}'">
                <div class="card-overlay"><button class="btn-card-accion">Ver Ficha</button></div>
            </div>
            <div class="peli-info">
                <h3 class="peli-titulo-tarjeta">${titulo}</h3>
                <div class="peli-meta-flex">
                    <span>${anio}</span>
                    <span class="peli-nota-badge">⭐ ${puntuacion}</span>
                </div>
            </div>
        </div>`;
}

// ── ACA ESTÁ LA CORRECCIÓN DEL H2 ──
function montarHero() {
    clearInterval(timerHero);
    const contenedorSlides = document.getElementById('sliderWrapper');
    const contenedorPuntos = document.getElementById('sliderDots');
    if (!contenedorSlides || !contenedorPuntos || !peliculasHero.length) return;

    contenedorSlides.innerHTML = peliculasHero.map((pelicula, indice) => {
        if (!contenidoCargado.find(p => p.id === pelicula.id)) contenidoCargado.push(pelicula);
        const urlFondo = pelicula.backdrop_path ? `${URL_BACKDROP}${pelicula.backdrop_path}` : '';
        return `
            <div class="slide-item ${indice === indiceHero ? 'active' : ''}">
                <img src="${urlFondo}" class="slide-backdrop" alt="${pelicula.title || pelicula.name}">
                <div class="slide-overlay">
                    <div class="slide-info-block">
                        <h2>${pelicula.title || pelicula.name}</h2>
                        <div class="slide-meta-datos">
                            <span class="badge-slide-nota">⭐ ${(pelicula.vote_average || 0).toFixed(1)}</span>
                            <span class="slide-anio-txt">Tendencia Global</span>
                        </div>
                        <p class="slide-resumen">${pelicula.overview || 'Sin sinopsis disponible en español.'}</p>
                        <button class="btn-explorar-ficha" onclick="abrirFicha(${pelicula.id})">Ver Ficha</button>
                    </div>
                </div>
            </div>`;
    }).join('');

    contenedorPuntos.innerHTML = peliculasHero.map((_, indice) =>
        `<span class="dot ${indice === indiceHero ? 'active' : ''}" onclick="saltarSlide(${indice})"></span>`
    ).join('');

    timerHero = setInterval(() => {
        indiceHero = (indiceHero + 1) % peliculasHero.length;
        actualizarHero();
    }, 6000);
}

function saltarSlide(indice) {
    indiceHero = indice;
    actualizarHero();
    montarHero();
}

function actualizarHero() {
    document.querySelectorAll('.slide-item').forEach((slide, i) => slide.classList.toggle('active', i === indiceHero));
    document.querySelectorAll('.dot').forEach((punto, i) => punto.classList.toggle('active', i === indiceHero));
}

window.abrirFicha = function(idPelicula) {
    if (window.isDragging) return;

    const pelicula = contenidoCargado.find(p => p.id === Number(idPelicula));
    if (!pelicula) return;

    const modal  = document.getElementById('modalFicha');
    const cuerpo = document.getElementById('modalCuerpo');
    if (!modal || !cuerpo) return;

    cuerpo.innerHTML = `
        <div class="ficha-header">
            <img src="${pelicula.backdrop_path ? URL_BACKDROP + pelicula.backdrop_path : ''}" class="ficha-backdrop">
            <div class="ficha-gradiente"></div>
        </div>
        <div class="ficha-info">
            <h2 class="ficha-titulo">${pelicula.title || pelicula.name}</h2>
            <div class="ficha-tags">
                <span>📅 Fecha: ${pelicula.release_date || pelicula.first_air_date || 'S/D'}</span>
                <span>⭐ Puntuación: ${(pelicula.vote_average || 0).toFixed(1)} / 10</span>
            </div>
            <p class="ficha-sinopsis">${pelicula.overview || 'Sin sinopsis en español disponible.'}</p>
        </div>`;

    modal.style.display = 'flex';
};

async function cargarGrillas() {
    if (controladorFetch) controladorFetch.abort();
    controladorFetch = new AbortController();

    const idsGenero      = GENEROS_TMDB[tipoContenido];
    const nombresRieles  = ['riel-populares', 'riel-accion', 'riel-comedia', 'riel-animacion', 'riel-cienciaficcion'];
    const endpointGenero = tipoContenido === 'movie' ? '/discover/movie' : '/discover/tv';
    const señal          = controladorFetch.signal;

    nombresRieles.forEach(idRiel => {
        const riel = document.getElementById(idRiel);
        if (riel) riel.innerHTML = '<div class="loader-mensaje">Cargando cartelera...</div>';
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
            const riel = document.getElementById(nombresRieles[i]);
            if (!riel) return;
            if (peticion.status === 'fulfilled' && peticion.value && peticion.value.length) {
                riel.innerHTML = peticion.value.map(crearTarjeta).join('');
            } else {
                riel.innerHTML = '<div class="loader-mensaje">No disponible offline.</div>';
            }
        });

        const tendenciasSemanales = peticiones[5].value || [];
        if (tendenciasSemanales.length) {
            peliculasHero = tendenciasSemanales.filter(p => p.backdrop_path && p.overview).slice(0, 5);
            indiceHero = 0;
            montarHero();
        }

    } catch (error) {
        if (error.name === 'AbortError') return;

        nombresRieles.forEach(idRiel => {
            const riel = document.getElementById(idRiel);
            if (riel) riel.innerHTML = '<div class="loader-mensaje">Sin conexión. Vuelve a intentarlo.</div>';
        });
    }
}

async function buscarContenido(textoBusqueda) {
    if (!textoBusqueda?.trim()) return;

    document.body.classList.add('busqueda-activa');
    document.getElementById('bloques-estandar').style.display = 'none';
    document.getElementById('resultados-busqueda').style.display = 'block';

    const grillaBusqueda = document.getElementById('peliculas-buscadas');
    grillaBusqueda.innerHTML = '<div class="loader-mensaje">Buscando...</div>';

    if (!navigator.onLine) {
        const resultadosGuardados = recuperarBusquedaLocal(textoBusqueda);
        if (resultadosGuardados && resultadosGuardados.length) {
            grillaBusqueda.innerHTML = resultadosGuardados.map(crearTarjeta).join('');
        } else {
            window.location.href = './offline.html';
        }
        return;
    }

    if (controladorFetch) controladorFetch.abort();
    controladorFetch = new AbortController();

    try {
        const resultadosAPI = await consultarAPI(
            '/search/multi',
            { query: textoBusqueda },
            controladorFetch.signal
        );

        if (controladorFetch.signal.aborted) return;

        if (resultadosAPI === null) {
            const resultadosGuardados = recuperarBusquedaLocal(textoBusqueda);
            if (resultadosGuardados && resultadosGuardados.length) {
                grillaBusqueda.innerHTML = resultadosGuardados.map(crearTarjeta).join('');
            } else {
                window.location.href = './offline.html';
            }
            return;
        }

        const resultadosFiltrados = resultadosAPI.filter(pelicula =>
            pelicula.media_type !== 'person' && pelicula.poster_path
        );

        if (resultadosFiltrados.length) {
            guardarBusquedaLocal(textoBusqueda, resultadosFiltrados);
            grillaBusqueda.innerHTML = resultadosFiltrados.map(crearTarjeta).join('');
        } else {
            grillaBusqueda.innerHTML = `
                <p style="grid-column:1/-1;text-align:center;color:var(--text-sub);">
                    No hubo resultados para "${textoBusqueda}".
                </p>`;
        }

    } catch (error) {
        if (error.name === 'AbortError') return;

        const resultadosGuardados = recuperarBusquedaLocal(textoBusqueda);
        if (resultadosGuardados && resultadosGuardados.length) {
            grillaBusqueda.innerHTML = resultadosGuardados.map(crearTarjeta).join('');
        } else {
            window.location.href = './offline.html';
        }
    }
}

function volverAlInicio() {
    document.body.classList.remove('busqueda-activa');
    document.getElementById('resultados-busqueda').style.display = 'none';
    document.getElementById('bloques-estandar').style.display    = 'block';
    const campoBusqueda = document.getElementById('peliculaInput');
    if (campoBusqueda) campoBusqueda.value = '';
    cargarGrillas();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('DOMContentLoaded', () => {
    cargarGrillas();

    document.getElementById('btnPrevHero')?.addEventListener('click', () => {
        indiceHero = (indiceHero - 1 + peliculasHero.length) % peliculasHero.length;
        saltarSlide(indiceHero);
    });
    document.getElementById('btnNextHero')?.addEventListener('click', () => {
        indiceHero = (indiceHero + 1) % peliculasHero.length;
        saltarSlide(indiceHero);
    });

    document.querySelectorAll('.slider-row-wrapper').forEach(filaCarrusel => {
        const carrusel      = filaCarrusel.querySelector('.carrusel-horizontal-contenedor');
        const flechaIzq     = filaCarrusel.querySelector('.carrusel-arrow.left');
        const flechaDer     = filaCarrusel.querySelector('.carrusel-arrow.right');
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
            const posicionActual   = e.pageX - carrusel.offsetLeft;
            const desplazamiento   = posicionActual - posicionInicial;
            if (Math.abs(desplazamiento) > 5) window.isDragging = true;
            carrusel.scrollLeft = scrollInicial - desplazamiento;
        });
    });

    document.querySelectorAll('.cat-item').forEach(categoría => {
        categoría.addEventListener('click', e => {
            document.querySelectorAll('.cat-item').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            const generoSeleccionado = e.target.dataset.genre;
            if (!generoSeleccionado) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
            const seccionGenero = document.getElementById(`riel-${generoSeleccionado}`)?.closest('.fila-carrusel-seccion');
            if (seccionGenero) window.scrollTo({ top: seccionGenero.getBoundingClientRect().top + window.pageYOffset - 140, behavior: 'smooth' });
        });
    });

    document.querySelectorAll('.tab-tipo').forEach(botonTipo => {
        botonTipo.addEventListener('click', e => {
            document.querySelectorAll('.tab-tipo').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            tipoContenido = e.target.dataset.type;
            const tituloPopulares = document.getElementById('titulo-carrusel-1');
            if (tituloPopulares) tituloPopulares.textContent = tipoContenido === 'movie' ? 'Populares en Cine' : 'Series Populares';
            volverAlInicio();
        });
    });

    const campoBusqueda = document.getElementById('peliculaInput');
    document.getElementById('buscarBtn')?.addEventListener('click', () => buscarContenido(campoBusqueda?.value));
    campoBusqueda?.addEventListener('keypress', e => e.key === 'Enter' && buscarContenido(campoBusqueda.value));

    ['btnVolverHome', 'brand-logo', 'nav-root'].forEach(idElemento => {
        document.getElementById(idElemento)?.addEventListener('click', volverAlInicio);
    });

    document.getElementById('nav-buscar-mob')?.addEventListener('click', () => {
        const textoBusqueda = prompt('¿Qué deseas buscar?');
        if (textoBusqueda) buscarContenido(textoBusqueda);
    });

    document.getElementById('btnCerrarModal')?.addEventListener('click', () => {
        document.getElementById('modalFicha').style.display = 'none';
    });
    document.getElementById('modalFicha')?.addEventListener('click', e => {
        if (e.target.id === 'modalFicha') document.getElementById('modalFicha').style.display = 'none';
    });
});