# MonoFilms | Progressive Web App (PWA) de Cine y Series

## 📝 Descripción del Proyecto
MonoFilms es una Aplicación Web Progresiva (PWA) moderna desarrollada con **JavaScript Vanilla (ES6+)** y conectada a la API oficial de **TMDB (The Movie Database)**. 

El proyecto fue diseñado bajo un enfoque estricto *Mobile-First* e imita la experiencia de las plataformas de streaming actuales, permitiendo explorar contenido popular, filtrar por géneros, buscar películas o series en tiempo real y consultar fichas técnicas detalladas.

## 🚀 Características Principales
* **Arquitectura PWA Instalable:** Configurada mediante un `manifest.json` y un **Service Worker (`sw.js`)** que permite el funcionamiento offline y la instalación directa en dispositivos móviles o de escritorio.
* **Estrategia de Caché Avanzada:** Implementación de persistencia local con `localStorage` y control de red para asegurar la navegación incluso sin conexión a internet.
* **Consumo de API Asincrónico:** Conexión en tiempo real con TMDB mediante `fetch`, control de señales de interrupción (`AbortController`) para optimizar recursos y manejo de estados de carga.
* **Diseño UI/UX Responsivo:** Maquetación propia desarrollada con CSS moderno (Grid, Flexbox, Variables CSS y diseño adaptativo).

## 🛠️ Tecnologías Utilizadas
* **JavaScript (Vanilla JS):** Lógica de la aplicación, manipulación del DOM y promesas.
* **TMDB API:** Proveedor externo de datos cinematográficos.
* **Service Workers & Web App Manifest:** Tecnologías nativas de PWA.
* **HTML5 & CSS3:** Estructura semántica y diseño visual avanzado.
