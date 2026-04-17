/* ================================================================
   PrecioLuz · app.js
   Obtiene precios PVPC de la API pública de Red Eléctrica de España
   y los muestra por hora para hoy y mañana.
   ================================================================ */

'use strict';

// ----------------------------------------------------------------
//  CONFIGURACIÓN
// ----------------------------------------------------------------
const API_BASE = 'https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real';
const GEO_PARAMS = 'geo_trunc=electric_system&geo_limit=peninsular&geo_ids=8741';

// IDs de indicadores en la API de REE
// 1001 = PVPC  |  600 = Precio spot mercado diario
const PREFERRED_IDS = ['1001', '600'];

// ----------------------------------------------------------------
//  ESTADO
// ----------------------------------------------------------------
let todayData    = [];
let tomorrowData = [];
let activeTab    = 'today';
let priceChart   = null;

// ----------------------------------------------------------------
//  TEMA (Modo nocturno/diurno)
// ----------------------------------------------------------------
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
    
    updateThemeIcon();
    
    document.getElementById('theme-toggle').addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const nextTheme = current === 'dark' ? 'light' : 'dark';
        
        if (nextTheme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
        
        localStorage.setItem('theme', nextTheme);
        updateThemeIcon();
        
        // Re-render chart to apply new colors
        const data = activeTab === 'today' ? todayData : tomorrowData;
        if (data && data.length > 0 && priceChart) {
            renderChart(data);
        }
    });
}

function updateThemeIcon() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const btn = document.getElementById('theme-toggle');
    if(btn) {
        btn.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
        btn.setAttribute('aria-label', isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    }
}

function getChartColors() {
    const style = getComputedStyle(document.documentElement);
    return {
        bg: style.getPropertyValue('--bg-card').trim() || '#ffffff',
        textPrimary: style.getPropertyValue('--text-primary').trim() || '#0f172a',
        textSecondary: style.getPropertyValue('--text-secondary').trim() || '#475569',
        border: style.getPropertyValue('--border').trim() || 'rgba(0,0,0,0.08)'
    };
}

// ----------------------------------------------------------------
//  UTILIDADES DE FECHA
// ----------------------------------------------------------------
function isoDate(date) {
    const y  = date.getFullYear();
    const m  = String(date.getMonth() + 1).padStart(2, '0');
    const d  = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Devuelve 'HH:00' a partir de un string ISO de datetime */
function parseHour(datetimeStr) {
    const d = new Date(datetimeStr);
    return `${String(d.getHours()).padStart(2, '0')}:00`;
}

/** Convierte €/MWh → €/kWh  (÷ 1000) */
function toEuroKwh(eurMwh) {
    return eurMwh / 1000;
}

/** Formatea un precio en €/kWh con 4 decimales y coma */
function fmt(eurMwh) {
    return toEuroKwh(eurMwh).toFixed(4).replace('.', ',');
}

/** Devuelve fecha legible en español */
function localDate(date) {
    return date.toLocaleDateString('es-ES', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
}

// ----------------------------------------------------------------
//  CLASIFICACIÓN DE PRECIOS
// ----------------------------------------------------------------
/**
 * Clasifica un precio relativo al rango del día.
 * cheap (<33%), moderate (33-66%), expensive (>66%)
 */
function classify(value, min, max) {
    if (max === min) return 'moderate';
    const pct = (value - min) / (max - min);
    if (pct <= 0.33) return 'cheap';
    if (pct <= 0.66) return 'moderate';
    return 'expensive';
}

// ----------------------------------------------------------------
//  API
// ----------------------------------------------------------------
async function fetchPrices(date) {
    const dateStr = isoDate(date);
    const url = `${API_BASE}?time_trunc=hour&start_date=${dateStr}T00:00&end_date=${dateStr}T23:59&${GEO_PARAMS}`;

    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} al llamar a la API`);

    const json = await res.json();
    const included = json.included || [];

    // Buscar el indicador preferido en orden
    let indicator = null;
    for (const id of PREFERRED_IDS) {
        indicator = included.find(i => String(i.id) === id);
        if (indicator) break;
    }
    // Fallback: primer elemento disponible
    if (!indicator && included.length > 0) indicator = included[0];
    if (!indicator) throw new Error('No se encontraron datos de precio en la respuesta');

    const values = indicator.attributes?.values ?? [];
    if (values.length === 0) throw new Error('La API devolvió 0 registros para esta fecha');

    return values.map(v => ({
        hour:     parseHour(v.datetime),
        datetime: v.datetime,
        eurMwh:   v.value,           // valor original
        euroKwh:  toEuroKwh(v.value), // €/kWh
    })).sort((a, b) => a.hour.localeCompare(b.hour));
}

// ----------------------------------------------------------------
//  RENDERIZADO DE ESTADÍSTICAS
// ----------------------------------------------------------------
function renderStats(data, isToday) {
    const values = data.map(d => d.eurMwh);
    const min    = Math.min(...values);
    const max    = Math.max(...values);
    const avg    = values.reduce((s, v) => s + v, 0) / values.length;

    const minItem = data.find(d => d.eurMwh === min);
    const maxItem = data.find(d => d.eurMwh === max);

    // Precio actual (solo para hoy)
    const now = new Date();
    const currentHourStr = `${String(now.getHours()).padStart(2, '0')}:00`;
    const current = isToday ? data.find(d => d.hour === currentHourStr) : null;

    if (isToday && current) {
        const cls = classify(current.eurMwh, min, max);
        const iconColor = cls === 'cheap' ? 'var(--cheap)' : cls === 'moderate' ? 'var(--moderate)' : 'var(--expensive)';
        const label = cls === 'cheap' ? 'Barato' : cls === 'moderate' ? 'Moderado' : 'Caro';
        setText('current-price', fmt(current.eurMwh));
        setHTML('current-label', `${currentHourStr} · <i class="fa-solid fa-circle" style="color: ${iconColor}; font-size: 0.85em;"></i> ${label}`);
    } else {
        setText('current-price', fmt(avg));
        setText('current-label', 'Media del día');
    }

    setText('min-price', fmt(min));
    setText('min-hour',  minItem ? `Mejor hora: ${minItem.hour}` : '--');

    setText('max-price', fmt(max));
    setText('max-hour',  maxItem ? `Peor hora: ${maxItem.hour}` : '--');

    setText('avg-price', fmt(avg));
    setText('avg-label', isToday ? 'Hoy' : 'Mañana');

    // Actualizar timestamp
    const timeStr = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    setText('last-update', `Actualizado ${timeStr}`);

    // Quitar loading de las cards
    document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('loading'));
}

// ----------------------------------------------------------------
//  RENDERIZADO DEL GRÁFICO
// ----------------------------------------------------------------
function renderChart(data) {
    const ctx = document.getElementById('price-chart').getContext('2d');

    const values  = data.map(d => d.eurMwh);
    const min     = Math.min(...values);
    const max     = Math.max(...values);
    const labels  = data.map(d => d.hour);
    const euroKwh = data.map(d => d.euroKwh);

    const barColors = values.map(v => {
        const cls = classify(v, min, max);
        return cls === 'cheap'     ? 'rgba(34,197,94,0.75)'
             : cls === 'moderate'  ? 'rgba(245,158,11,0.75)'
             :                       'rgba(244,63,94,0.75)';
    });

    const borderColors = values.map(v => {
        const cls = classify(v, min, max);
        return cls === 'cheap'    ? '#22c55e'
             : cls === 'moderate' ? '#f59e0b'
             :                      '#f43f5e';
    });

    const themeColors = getChartColors();

    const chartConfig = {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: '€/kWh',
                data: euroKwh,
                backgroundColor: barColors,
                borderColor: borderColors,
                borderWidth: 1.5,
                borderRadius: 6,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: themeColors.bg,
                    titleColor: themeColors.textSecondary,
                    bodyColor: themeColors.textPrimary,
                    borderColor: themeColors.border,
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 10,
                    callbacks: {
                        title: items => `Hora: ${items[0].label}`,
                        label: item  => ` ${item.parsed.y.toFixed(4).replace('.', ',')} €/kWh`
                    }
                }
            },
            scales: {
                x: {
                    grid:  { color: themeColors.border, drawBorder: false },
                    ticks: { color: themeColors.textSecondary, font: { size: 11 }, maxRotation: 45 }
                },
                y: {
                    grid:  { color: themeColors.border, drawBorder: false },
                    ticks: {
                        color: themeColors.textSecondary,
                        font:  { size: 11 },
                        callback: v => v.toFixed(2).replace('.', ',')
                    }
                }
            },
            animation: { duration: 600, easing: 'easeInOutQuart' }
        }
    };

    if (priceChart) {
        priceChart.data         = chartConfig.data;
        priceChart.options      = chartConfig.options;
        priceChart.update('active');
    } else {
        priceChart = new Chart(ctx, chartConfig);
    }
}

// ----------------------------------------------------------------
//  RENDERIZADO DE LA CUADRÍCULA DE HORAS
// ----------------------------------------------------------------
function renderHours(data, isToday) {
    const grid = document.getElementById('hours-grid');
    grid.innerHTML = '';

    const values = data.map(d => d.eurMwh);
    const min    = Math.min(...values);
    const max    = Math.max(...values);

    const now            = new Date();
    const currentHourStr = `${String(now.getHours()).padStart(2, '0')}:00`;

    data.forEach((item, idx) => {
        const cls       = classify(item.eurMwh, min, max);
        const isCurrent = isToday && item.hour === currentHourStr;
        const barWidth  = max > min ? Math.round(((item.eurMwh - min) / (max - min)) * 100) : 50;

        // Rango horario: "06:00 – 07:00"
        const [hh] = item.hour.split(':');
        const nextH = String((parseInt(hh) + 1) % 24).padStart(2, '0');
        const rangeLabel = `${item.hour} – ${nextH}:00`;

        const card = document.createElement('div');
        card.className = `hour-card ${cls}${isCurrent ? ' is-current' : ''}`;
        card.setAttribute('role', 'listitem');
        card.setAttribute('aria-label', `${rangeLabel}: ${fmt(item.eurMwh)} euros por kWh`);
        card.style.animationDelay = `${idx * 0.025}s`;

        card.innerHTML = `
            ${isCurrent ? '<span class="current-badge">Ahora</span>' : ''}
            <div class="hour-range">${rangeLabel}</div>
            <div class="hour-price">${fmt(item.eurMwh)}</div>
            <div class="hour-unit">€/kWh</div>
            <div class="price-bar">
                <div class="price-bar-fill" style="width: ${barWidth}%"></div>
            </div>
        `;

        grid.appendChild(card);
    });
}

// ----------------------------------------------------------------
//  VISIBILIDAD DE SECCIONES
// ----------------------------------------------------------------
function toggleDataSections(show) {
    const statsSec = document.querySelector('.stats-section');
    const chartSec = document.querySelector('.chart-section');
    const hdrSec   = document.querySelector('.section-header');
    
    if (statsSec) statsSec.style.display = show ? '' : 'none';
    if (chartSec) chartSec.style.display = show ? '' : 'none';
    if (hdrSec)   hdrSec.style.display   = show ? '' : 'none';
}

// ----------------------------------------------------------------
//  CAMBIO DE PESTAÑA
// ----------------------------------------------------------------
function switchTab(tab) {
    activeTab = tab;

    document.getElementById('tab-today').classList.toggle('active',    tab === 'today');
    document.getElementById('tab-tomorrow').classList.toggle('active', tab === 'tomorrow');

    const today    = new Date();
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);

    if (tab === 'today') {
        setText('tab-date', capitalizeFirst(localDate(today)));
        if (todayData.length > 0) {
            toggleDataSections(true);
            renderChart(todayData);
            renderHours(todayData, true);
            renderStats(todayData, true);
        }
    } else {
        setText('tab-date', capitalizeFirst(localDate(tomorrow)));
        if (tomorrowData.length > 0) {
            toggleDataSections(true);
            renderChart(tomorrowData);
            renderHours(tomorrowData, false);
            renderStats(tomorrowData, false);
        } else {
            toggleDataSections(false);
            showTomorrowNotice(tomorrow);
        }
    }
}

// ----------------------------------------------------------------
//  AVISOS Y ERRORES
// ----------------------------------------------------------------
function showTomorrowNotice(tomorrow) {
    const grid = document.getElementById('hours-grid');
    const tomorrowStr = capitalizeFirst(localDate(tomorrow));
    grid.innerHTML = `
        <div class="tomorrow-notice">
            <div class="notice-icon"><i class="fa-solid fa-cloud-sun"></i></div>
            <h3>Precios de mañana no disponibles aún</h3>
            <p>Los precios del ${tomorrowStr} se publican alrededor de las 20:30 h (hora peninsular).</p>
        </div>
    `;
}

function showError(msg) {
    toggleDataSections(false);
    document.getElementById('hours-grid').innerHTML = `
        <div class="error-box">
            <h3><i class="fa-solid fa-bolt"></i> No se pudieron cargar los precios</h3>
            <p>${msg}</p>
            <button class="btn-retry" onclick="init()">Reintentar</button>
        </div>
    `;
    setText('last-update', 'Error al cargar');
}

function showLoading() {
    toggleDataSections(false);
    document.getElementById('hours-grid').innerHTML = `
        <div class="loading-placeholder">
            <div class="spinner"></div>
            <p>Obteniendo precios de Red Eléctrica...</p>
        </div>
    `;
}

// ----------------------------------------------------------------
//  HELPERS
// ----------------------------------------------------------------
function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function setHTML(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
}

function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// ----------------------------------------------------------------
//  INICIALIZACIÓN
// ----------------------------------------------------------------
async function init() {
    initTheme();
    showLoading();

    const today    = new Date();
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);

    // Fecha en la pestaña activa
    setText('tab-date', capitalizeFirst(localDate(today)));

    try {
        todayData = await fetchPrices(today);

        toggleDataSections(true);
        renderStats(todayData, true);
        renderChart(todayData);
        renderHours(todayData, true);

        // Intentar cargar mañana (puede no estar disponible antes de ~20:30)
        try {
            tomorrowData = await fetchPrices(tomorrow);
        } catch {
            tomorrowData = [];
            console.info('[PrecioLuz] Precios de mañana aún no publicados.');
        }

    } catch (err) {
        console.error('[PrecioLuz] Error:', err);
        showError(
            'No se pudo conectar con la API de Red Eléctrica de España. ' +
            'Comprueba tu conexión a internet e inténtalo de nuevo.'
        );
    }
}

// Arranque
document.addEventListener('DOMContentLoaded', init);
