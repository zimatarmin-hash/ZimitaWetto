/* ==========================================================================
   Zimita Wetto
   Wetter-Dashboard für Zimat (Fraktion der Gemeinde Kiens, Südtirol).

   Datenquellen:
   - Landeswetterdienst Südtirol (static-wetter.provincia.bz.it) – offene,
     CORS-freigegebene JSON-Endpunkte derselben Daten, die auch
     wetter.provinz.bz.it clientseitig lädt. Liegt nur auf Gemeindeebene vor
     -> gilt für Kiens.
   - Live-Radar/Blitz/Hagel/Satellit-Frames (static-meteo.provincia.bz.it) –
     offene Rasterbild-Zeitserien, ebenfalls von der Landesseite verwendet.
   - Open-Meteo (api.open-meteo.com) – freie, CORS-offene Zweitquelle,
     abgefragt für die genaue Position Zimat. Liefert außerdem Taupunkt,
     Luftfeuchte, Sonnenstunden und Vergangenheitsdaten (past_days) fürs
     Heuwetter-Modul.
   - Kachelmannwetter hat KEINE öffentliche API. Werte werden live von der
     Webseite über den Lese-Proxy r.jina.ai (Jina AI Reader, CORS-offen)
     gelesen und geparst. Das ist inoffiziell und kann brechen, wenn die
     Seite ihr Markup ändert – daher immer mit Try/Catch und
     "nicht verfügbar"-Fallback statt Absturz.
   - Bergfex wurde entfernt: die Seite blockiert automatisierte Anfragen
     (auch über den Lese-Proxy) aktiv mit HTTP 429 Too Many Requests.
   ========================================================================== */

const CONFIG = {
  // Aktuell gewählte Gemeinde für die Landeswetterdienst-Daten (Bulletins
  // liegen nur je Gemeinde vor, nicht je Fraktion). Wird über die
  // Ortssuche im Kopfbereich umgestellt, sofern die gesuchte Fraktion einer
  // der 116 Südtiroler Gemeinden zugeordnet werden kann.
  municipality: {
    uuid: '9a239c35-f405-46ab-ba5d-aeffd2b8af0b',
    name_de: 'Kiens',
    url_slug_de: 'kiens',
  },
  baseBulletinId: 144000000,
  // Feinposition (Fraktion/Ort) für Open-Meteo & Kartenmittelpunkt – punktgenau,
  // im Unterschied zu den Landeswetterdienst-Daten, die nur je Gemeinde vorliegen.
  // Standard ist immer Zimat (Weiler bei St. Sigmund, Gemeinde Kiens).
  position: {
    name: 'Zimat',
    sub: 'Fraktion von Kiens',
    lat: 46.81423,
    lon: 11.80156,
  },
  southTyrolViewbox: '10.35,47.15,12.55,46.15',
  providerBase: 'https://static-wetter.provinz.bz.it/forecast-data/website',
  meteoBase: 'https://static-meteo.provincia.bz.it/raster-data/website',
  openMeteo: 'https://api.open-meteo.com/v1/forecast',
  jinaBase: 'https://r.jina.ai/',
  kachelmannHourlyUrl: 'https://kachelmannwetter.com/de/ajax_pub/weathernexthoursdays?city_id=3178820&lang=de&unit_t=celsius&unit_v=kmh&unit_l=metrisch&unit_r=joule&unit_p=hpa&nf=pointcomma&tf=1&_cb=1',
  refreshForecastMs: 10 * 60 * 1000,
  refreshRadarMs: 5 * 60 * 1000,
  rasterTimeZone: 'Europe/Rome',
  openMeteoPastDays: 2,
};

proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

const PROVIDERS = [
  {
    id: 'suedtirol', name: 'Südtirolwetter', letter: 'S', color: '#0e7c9c',
    url: '', desc: '',
    embeddable: false,
  },
  {
    id: 'kachelmann', name: 'Kachelmannwetter', letter: 'K', color: '#1f9d55',
    url: 'https://kachelmannwetter.com/de/wetter/3178820-kiens',
    desc: '14-Tage-Trend. Keine offizielle API – Stunden-/Tageswerte werden live gelesen. Technisch bedingt immer auf Kiens bezogen.',
    embeddable: true,
  },
];
// Aktualisiert den Südtirolwetter-Link/-Text anhand der aktuell gewählten
// Gemeinde (PROVIDERS[0]) – ihr URL-Slug funktioniert für alle 116 Gemeinden.
function buildProviders() {
  PROVIDERS[0].url = `https://wetter.provinz.bz.it/de/gemeindewetter/${CONFIG.municipality.url_slug_de}?tl=${CONFIG.baseBulletinId}`;
  PROVIDERS[0].desc = `Amtlicher Landeswetterdienst – offene API, direkte Datenquelle dieser App (Gemeinde ${CONFIG.municipality.name_de}).`;
}
buildProviders();

const RADAR_SOURCE_LINKS = [
  { name: 'Live-Radar, Blitze & Satellit – Original', url: 'https://wetter.provinz.bz.it/de/radar-blitze-und-satellit' },
  { name: 'Analysen & Vorhersagen – Original', url: 'https://wetter.provinz.bz.it/de/analysen-und-vorhersagen' },
];

/* ==========================================================================
   ICONS – reines SVG, selbst gezeichnet aus einfachen Formen (Kreis, Linie,
   Ellipse, Polygon). Kein Emoji mehr im gesamten UI. Farben laufen über
   CSS-Variablen, damit Hell/Dunkel automatisch passt.
   ========================================================================== */
let _svgUid = 0;

function svgWrap(inner, cls = '') {
  return `<svg class="wicon ${cls}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;
}
function sunRays(cx, cy, r1, r2, count = 8) {
  let s = '';
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count;
    const x1 = cx + r1 * Math.cos(a), y1 = cy + r1 * Math.sin(a);
    const x2 = cx + r2 * Math.cos(a), y2 = cy + r2 * Math.sin(a);
    s += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="var(--sun-color)" stroke-width="1.7" stroke-linecap="round"/>`;
  }
  return s;
}
function sunCore(cx, cy, r) { return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--sun-color)"/>`; }
function moonShape(cx, cy, r) {
  const id = 'moonmask' + (_svgUid++);
  return `<mask id="${id}"><rect x="0" y="0" width="24" height="24" fill="#fff"/><circle cx="${cx + r * 0.55}" cy="${cy - r * 0.4}" r="${r * 0.85}" fill="#000"/></mask>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--moon-color)" mask="url(#${id})"/>`;
}
function cloudShape(cx, cy, s = 1, color = 'var(--cloud-color)') {
  return `<g fill="${color}">
    <ellipse cx="${cx - 4 * s}" cy="${cy + 1 * s}" rx="${4 * s}" ry="${3.2 * s}"/>
    <ellipse cx="${cx + 2.5 * s}" cy="${cy - 1.2 * s}" rx="${5.2 * s}" ry="${4.2 * s}"/>
    <rect x="${cx - 8 * s}" y="${cy + 0.6 * s}" width="${16 * s}" height="${4.6 * s}" rx="${2.3 * s}"/>
  </g>`;
}
function rainDrops(cx, cy, count, long = false) {
  let s = '';
  const spacing = 4.6, len = long ? 5.6 : 3.8;
  const startX = cx - ((count - 1) * spacing) / 2;
  for (let i = 0; i < count; i++) {
    const x = startX + i * spacing;
    s += `<line x1="${x}" y1="${cy}" x2="${x - 1.3}" y2="${cy + len}" stroke="var(--rain-color)" stroke-width="2" stroke-linecap="round"/>`;
  }
  return s;
}
function snowDots(cx, cy, count) {
  let s = '';
  const spacing = 5;
  const startX = cx - ((count - 1) * spacing) / 2;
  for (let i = 0; i < count; i++) {
    s += `<circle cx="${startX + i * spacing}" cy="${cy + (i % 2 ? 3 : 0)}" r="1.3" fill="var(--snow-color)"/>`;
  }
  return s;
}
function boltShape(cx, cy, scale = 1) {
  const pts = [[1, -9], [-7, 3], [-2, 3], [-4, 10], [6, -2], [0, -2]]
    .map(([x, y]) => `${(cx + x * scale).toFixed(1)},${(cy + y * scale).toFixed(1)}`).join(' ');
  return `<polygon points="${pts}" fill="var(--bolt-color)"/>`;
}
function fogLines(cx, cy) {
  return `<line x1="${cx - 8}" y1="${cy - 4}" x2="${cx + 5}" y2="${cy - 4}" stroke="var(--cloud-color)" stroke-width="1.8" stroke-linecap="round" opacity="0.85"/>
    <line x1="${cx - 9}" y1="${cy}" x2="${cx + 9}" y2="${cy}" stroke="var(--cloud-color)" stroke-width="1.8" stroke-linecap="round"/>
    <line x1="${cx - 6}" y1="${cy + 4}" x2="${cx + 8}" y2="${cy + 4}" stroke="var(--cloud-color)" stroke-width="1.8" stroke-linecap="round" opacity="0.85"/>`;
}

function weatherIconMarkup(key, isNight, size = 'md') {
  let inner;
  switch (key) {
    case 'clear':
      inner = isNight ? moonShape(12, 12, 6.3) : sunCore(12, 12, 5) + sunRays(12, 12, 7.2, 9.6, 8);
      break;
    case 'partly-cloudy':
      inner = (isNight ? moonShape(8, 8, 3.8) : sunCore(8, 8, 3.4) + sunRays(8, 8, 5.1, 6.9, 8)) + cloudShape(14.5, 15, 0.95);
      break;
    case 'cloudy':
      inner = cloudShape(12, 13, 1.15);
      break;
    case 'fog':
      inner = cloudShape(12, 8.5, 0.7) + fogLines(12, 15.5);
      break;
    case 'drizzle':
      inner = cloudShape(12, 9.5, 0.95) + rainDrops(12, 15.5, 2);
      break;
    case 'rain':
      inner = cloudShape(12, 9, 1) + rainDrops(12, 15, 3);
      break;
    case 'heavy-rain':
      inner = cloudShape(12, 8.5, 1.05) + rainDrops(12, 14.5, 3, true);
      break;
    case 'snow':
      inner = cloudShape(12, 9.5, 1) + snowDots(12, 16, 3);
      break;
    case 'sleet':
      inner = cloudShape(12, 9.5, 1) + rainDrops(10.5, 16, 1) + snowDots(15, 16.5, 2);
      break;
    case 'thunder':
      inner = cloudShape(12, 8.5, 1) + boltShape(12, 16, 1);
      break;
    case 'thunder-rain':
      inner = cloudShape(12, 8.5, 1) + boltShape(10, 16, 0.85) + rainDrops(16, 15, 1);
      break;
    default:
      inner = cloudShape(12, 13, 1.05);
  }
  return svgWrap(inner, `wicon--${size} wicon--${key}`);
}

// --- Sky-condition codes (a-z) der Landeswetterdienst-API -> Condition-Key
const SKY_KEY = {
  a: 'clear', b: 'clear', c: 'partly-cloudy', d: 'cloudy', e: 'cloudy',
  f: 'drizzle', g: 'heavy-rain', h: 'rain', i: 'heavy-rain', j: 'drizzle', k: 'drizzle',
  l: 'snow', m: 'snow', n: 'snow', o: 'snow', p: 'snow', q: 'sleet', r: 'sleet',
  s: 'fog', t: 'fog', u: 'drizzle', v: 'thunder', w: 'sleet', x: 'thunder-rain', y: 'thunder', z: 'thunder',
};
function skyConditionKey(code) { return SKY_KEY[String(code || '').toLowerCase()] || 'cloudy'; }
function skyIcon(code, isNight) { return weatherIconMarkup(skyConditionKey(code), isNight); }

// --- Open-Meteo WMO weather codes -> Condition-Key --------------------------
const OM_KEY = {
  0: 'clear', 1: 'clear', 2: 'partly-cloudy', 3: 'cloudy', 45: 'fog', 48: 'fog',
  51: 'drizzle', 53: 'drizzle', 55: 'drizzle', 56: 'sleet', 57: 'sleet',
  61: 'drizzle', 63: 'rain', 65: 'heavy-rain', 66: 'sleet', 67: 'sleet',
  71: 'snow', 73: 'snow', 75: 'snow', 77: 'snow',
  80: 'drizzle', 81: 'rain', 82: 'heavy-rain', 85: 'snow', 86: 'snow',
  95: 'thunder', 96: 'thunder-rain', 99: 'thunder-rain',
};
function omConditionKey(code) { return OM_KEY[code] || 'cloudy'; }
function omIcon(code, isNight) { return weatherIconMarkup(omConditionKey(code), isNight); }

// --- Freitext-Wetterbeschreibung (Kachelmann) -> Condition-Key ------------
function descConditionKey(desc, rainProbFallback) {
  const d = (desc || '').toLowerCase();
  if (/gewitter/.test(d)) return 'thunder';
  if (/schnee/.test(d)) return 'snow';
  if (/regen|schauer/.test(d)) return (rainProbFallback ?? 0) > 60 ? 'heavy-rain' : 'rain';
  if (/nebel|dunst/.test(d)) return 'fog';
  if (/wolkenlos|heiter|sonnig/.test(d)) return 'clear';
  if (/stark bewölkt|bedeckt/.test(d)) return 'cloudy';
  if (/wolkig|bewölkt/.test(d)) return 'partly-cloudy';
  return (rainProbFallback ?? 0) > 50 ? 'rain' : 'partly-cloudy';
}

// --- UI-Chrome-Icons (keine Wettersymbole) ---------------------------------
const UI_ICON = {
  home: `<path d="M4 11.5 L12 4 L20 11.5 V20 H14 V14 H10 V20 H4 Z" fill="currentColor"/>`,
  chart: `<rect x="4" y="13" width="4" height="7" rx="1" fill="currentColor"/><rect x="10" y="8" width="4" height="12" rx="1" fill="currentColor"/><rect x="16" y="4" width="4" height="16" rx="1" fill="currentColor"/>`,
  radar: `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="5.3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/>`,
  list: `<circle cx="5" cy="7" r="1.4" fill="currentColor"/><line x1="9" y1="7" x2="20" y2="7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="5" cy="12" r="1.4" fill="currentColor"/><line x1="9" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="5" cy="17" r="1.4" fill="currentColor"/><line x1="9" y1="17" x2="20" y2="17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  hay: `<path d="M6 20 C6 14 7 8 8 3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M12 20 C12 13 12 6 12 2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M18 20 C18 14 17 8 16 3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
  sun: sunCore(12, 12, 4.3) + sunRays(12, 12, 6.5, 8.9, 8),
  moon: moonShape(12, 12, 6.3),
  play: `<polygon points="8,5 19,12 8,19" fill="currentColor"/>`,
  pause: `<rect x="6.5" y="5" width="4" height="14" rx="1.4" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.4" fill="currentColor"/>`,
  chevron: `<path d="M9 5 L16 12 L9 19" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  external: `<path d="M9 6 H6 a2 2 0 0 0 -2 2 V18 a2 2 0 0 0 2 2 H16 a2 2 0 0 0 2 -2 V15" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/><path d="M11 13 L20 4 M13 4 H20 V11" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  drop: `<path d="M12 3 C8 9 5 12.5 5 16 a7 7 0 0 0 14 0 C19 12.5 16 9 12 3 Z" fill="currentColor"/>`,
  wind: `<line x1="2" y1="8" x2="15" y2="8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="2" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="2" y1="16" x2="12" y2="16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  thermo: `<rect x="10" y="3" width="4" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="18" r="3.4" fill="currentColor"/>`,
  bolt: boltShape(12, 15, 1.3),
  warn: `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="12" y1="7.3" x2="12" y2="13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16.3" r="1" fill="currentColor"/>`,
  cloudsun: sunCore(8, 9, 2.9) + sunRays(8, 9, 4.4, 6, 8) + cloudShape(14.5, 15, 0.9, 'currentColor'),
  check: `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.5 12.3 L10.5 15.5 L16.5 8.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  sunrise: `<path d="M6.5 15 a5.5 5.5 0 0 1 11 0" stroke="currentColor" stroke-width="1.7" fill="none"/><line x1="12" y1="2.5" x2="12" y2="8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M9 5 L12 8 L15 5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><line x1="2.5" y1="15" x2="21.5" y2="15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
  sunset: `<path d="M6.5 15 a5.5 5.5 0 0 1 11 0" stroke="currentColor" stroke-width="1.7" fill="none"/><line x1="12" y1="2.5" x2="12" y2="8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M9 5.5 L12 2.5 L15 5.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><line x1="2.5" y1="15" x2="21.5" y2="15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
  moonrise: moonShape(12, 10, 4.6) + `<line x1="2.5" y1="17" x2="21.5" y2="17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
  moonset: moonShape(12, 10, 4.6) + `<line x1="2.5" y1="17" x2="21.5" y2="17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
  pin: `<path d="M12 21 C8 16.5 5.5 13 5.5 9.2 a6.5 6.5 0 0 1 13 0 C18.5 13 16 16.5 12 21 Z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="9.2" r="2.4" fill="currentColor"/>`,
  ruler: `<rect x="3" y="9" width="18" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="7" y1="9" x2="7" y2="12" stroke="currentColor" stroke-width="1.4"/><line x1="11" y1="9" x2="11" y2="12" stroke="currentColor" stroke-width="1.4"/><line x1="15" y1="9" x2="15" y2="12" stroke="currentColor" stroke-width="1.4"/><line x1="19" y1="9" x2="19" y2="12" stroke="currentColor" stroke-width="1.4"/>`,
  legend: `<rect x="4" y="6" width="16" height="3" rx="1.5" fill="currentColor" opacity="0.9"/><rect x="4" y="11" width="16" height="3" rx="1.5" fill="currentColor" opacity="0.6"/><rect x="4" y="16" width="16" height="3" rx="1.5" fill="currentColor" opacity="0.35"/>`,
  windarrow: `<line x1="12" y1="20" x2="12" y2="4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M7 9 L12 4 L17 9" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  search: `<circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="15.3" y1="15.3" x2="20.5" y2="20.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  close: `<line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
};
function uiIcon(name, size = 'md') { return svgWrap(UI_ICON[name] || '', `wicon--${size}`); }
function initStaticIcons() {
  document.querySelectorAll('[data-icon]').forEach(el => {
    el.innerHTML = uiIcon(el.dataset.icon, el.dataset.iconSize || 'md');
  });
}

// --- Helpers ---------------------------------------------------------------
async function fetchJSON(url, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextViaJina(targetUrl, timeoutMs = 16000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(CONFIG.jinaBase + targetUrl, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseNum(tok) {
  if (tok == null) return null;
  const s = String(tok).trim();
  if (!s || s === '-' || s === '–') return null;
  const n = parseFloat(s.replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

const ROME_TZ = CONFIG.rasterTimeZone;
function fmtTime(date) {
  return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: ROME_TZ }).format(date);
}
function fmtDayTime(date) {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: ROME_TZ }).format(date);
}
function fmtDayLabel(date, idx) {
  if (idx === 0) return 'Heute';
  if (idx === 1) return 'Morgen';
  return new Intl.DateTimeFormat('de-DE', { weekday: 'short', timeZone: ROME_TZ }).format(date);
}
function isoDateInTz(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function isNightAt(date, sunRiseHHmm, sunSetHHmm) {
  if (!sunRiseHHmm || !sunSetHHmm) {
    const h = date.getHours();
    return h < 6 || h >= 21;
  }
  const hhmm = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: ROME_TZ, hourCycle: 'h23' }).format(date);
  return hhmm < sunRiseHHmm || hhmm > sunSetHHmm;
}
function round(n) { return Math.round(n); }
function avg(arr) { const a = arr.filter(v => typeof v === 'number' && Number.isFinite(v)); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
function showToast(msg, ms = 4000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.hidden = true; }, ms);
}

// Wandelt eine "Wanduhrzeit" in einer bestimmten Zeitzone in den korrekten
// UTC-Zeitpunkt um (ohne Zeitzonen-Bibliothek, nur via Intl). Wird für die
// Rasterbild-Zeitstempel der Provinz benötigt, die als Lokalzeit (nicht UTC)
// benannt sind.
function zonedTimeToUtcMs(y, mo, d, h, mi, s, timeZone) {
  const guessMs = Date.UTC(y, mo - 1, d, h, mi, s);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = {};
  fmt.formatToParts(new Date(guessMs)).forEach(p => { if (p.type !== 'literal') parts[p.type] = p.value; });
  const shownAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, parts.hour === '24' ? 0 : +parts.hour, +parts.minute, +parts.second);
  const offsetMs = shownAsUtc - guessMs;
  return guessMs - offsetMs;
}

// ==========================================================================
// STATE
// ==========================================================================
const STATE = {
  hourly: [],      // Landeswetterdienst: [{time, temp, rainProb, rainFall, sky, windGust}]
  days: [],        // Landeswetterdienst: [{date, idx, title, sky, tMin, tMax, rainProb, reliability, astronomy?, sunshineDuration}]
  openMeteo: null, // aktuelle Position (Standard: Zimat), inkl. past_days
  kachelmann: null,// {hourly:[...], daily:[...]}
  heu: null,
  municipalities: null, // alle 116 Südtiroler Gemeinden (für die Ortssuche)
  lastUpdated: null,
};

// ==========================================================================
// DATA LOADING – Landeswetterdienst Südtirol
// ==========================================================================
async function loadMunicipalities() {
  const url = `${CONFIG.providerBase}/static-data/municipalities.json`;
  STATE.municipalities = await fetchJSON(url, 9000);
}

async function loadMunicipalityHourly() {
  const url = `${CONFIG.providerBase}/municipalities/${CONFIG.municipality.uuid}.json`;
  const data = await fetchJSON(url);
  const start = new Date(data.start);
  const groupKey = Object.keys(data).find(k => k !== 'start' && k !== 'end');
  const group = data[groupKey] || {};
  const keys = Object.keys(group).map(Number).sort((a, b) => a - b);
  return keys.map((k, i) => {
    const slot = group[String(k)];
    const time = new Date(start.getTime() + i * 3 * 3600 * 1000);
    return {
      time,
      temp: slot.temperature,
      rainProb: slot.rain_probability,
      rainFall: slot.rain_fall,
      windGust: slot.wind_gust,
      windSpeed: slot.wind_speed,
      sky: slot.sky_condition,
    };
  });
}

async function loadMunicipalityDay(dayIndex) {
  const id = CONFIG.baseBulletinId + dayIndex * 1440;
  const url = `${CONFIG.providerBase}/southtyrol/de_${id}.json`;
  const data = await fetchJSON(url);
  const bulletin = data?.data?.bulletins?.[0];
  if (!bulletin) return null;
  const metrics = (bulletin.municipalityMetrics || []).find(m => m.venueId === CONFIG.municipality.uuid) || {};
  return {
    idx: dayIndex,
    date: new Date(bulletin.period?.start || data.meta.date),
    title: bulletin.title,
    conditions: bulletin.conditions,
    weatherText: bulletin.weather,
    reliability: bulletin.reliability,
    astronomy: bulletin.astronomy,
    sky: metrics.sky_condition,
    tMin: metrics.temperature_minimum,
    tMax: metrics.temperature_maximum,
    rainProb: metrics.rain_probability,
    rainFall: metrics.rain_fall,
    windGust: metrics.wind_gust,
    sunshineDuration: metrics.sunshine_duration,
  };
}

const WIND_PROFILE_LEVELS = [1000, 925, 850, 700, 600, 500]; // hPa – Bodennähe bis ~5500m
function windProfileHourlyParams() {
  return WIND_PROFILE_LEVELS.flatMap(h => [`wind_speed_${h}hPa`, `wind_direction_${h}hPa`, `geopotential_height_${h}hPa`]);
}

async function loadOpenMeteo() {
  const p = new URLSearchParams({
    latitude: CONFIG.position.lat, longitude: CONFIG.position.lon,
    current: 'temperature_2m,weather_code,wind_speed_10m',
    hourly: ['precipitation_probability,temperature_2m,weather_code,relative_humidity_2m,dew_point_2m,wind_speed_10m', ...windProfileHourlyParams()].join(','),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,precipitation_sum,sunshine_duration',
    timezone: ROME_TZ, forecast_days: 6, past_days: CONFIG.openMeteoPastDays,
  });
  return fetchJSON(`${CONFIG.openMeteo}?${p.toString()}`);
}

// ==========================================================================
// DATA LOADING – Kachelmannwetter (Reader-Proxy, inoffiziell)
// ==========================================================================
function parseKachelmannText(text) {
  const hourly = [];
  const hourlyRe = /(\d{2}:\d{2}) Uhr\n\n!\[Image \d+(?::\s*([^\]]*))?\]\([^)]*\)\n\n(-?\d+)°C\n\n(\d+)%/g;
  let m;
  while ((m = hourlyRe.exec(text))) {
    hourly.push({ timeLabel: m[1], desc: (m[2] || '').trim(), temp: +m[3], rainProb: +m[4] });
  }

  const tailIdx = text.search(/\n(Heute|Morgen)\n\n \d{1,2}\.\w+/);
  const daily = [];
  if (tailIdx > 0) {
    const tail = text.slice(tailIdx);
    const dtoks = tail.split('\n\n').map(s => s.trim()).filter(Boolean);
    const starts = [];
    dtoks.forEach((tok, i) => { if (/^(Heute|Morgen|Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)$/.test(tok)) starts.push(i); });
    starts.forEach((s, k) => {
      try {
        const end = starts[k + 1] ?? dtoks.length;
        const chunk = dtoks.slice(s, end);
        const joined = chunk.join('|');
        const maxM = joined.match(/(-?\d+)°C\|max/);
        const minM = joined.match(/(-?\d+)°C\|min/);
        const mmM = [...joined.matchAll(/(\d+)mm/g)];
        const nachIdx = chunk.indexOf('nachmittags');
        const iconTok = nachIdx > 0 ? chunk[nachIdx - 1] : chunk[1];
        const descM = (iconTok || '').match(/!\[Image \d+(?::\s*([^\]]*))?\]/);
        const desc = descM?.[1]?.trim() || '';
        if (!maxM && !minM) return;
        daily.push({
          label: chunk[0], desc, conditionKey: descConditionKey(desc, null),
          tMax: maxM ? +maxM[1] : null, tMin: minM ? +minM[1] : null,
          rainAmt: mmM.length ? +mmM[mmM.length - 1][1] : null,
        });
      } catch (_) { /* skip malformed day */ }
    });
  }

  return { hourly, daily };
}

async function loadKachelmann() {
  const text = await fetchTextViaJina(CONFIG.kachelmannHourlyUrl);
  return parseKachelmannText(text);
}

// ==========================================================================
// RENDER – Übersicht
// ==========================================================================
function currentHourlySlot() {
  const now = Date.now();
  let best = STATE.hourly[0];
  for (const h of STATE.hourly) {
    if (h.time.getTime() <= now) best = h; else break;
  }
  return best;
}

function renderStatus() {
  const day0 = STATE.days[0];
  const slot = currentHourlySlot();
  const om = STATE.openMeteo;
  const now = new Date();

  if (!day0 && !om && !STATE.kachelmann) {
    document.getElementById('statusDesc').textContent = 'Daten aktuell nicht verfügbar.';
    return;
  }

  const nightNow = day0?.astronomy ? isNightAt(now, day0.astronomy.sunRise, day0.astronomy.sunSet) : false;

  const kachelmannHour = STATE.kachelmann?.hourly?.[0] || null;
  const omHour = nearestOpenMeteoHourly(om);

  const temps = [slot?.temp, om?.current?.temperature_2m, kachelmannHour?.temp].filter(v => typeof v === 'number');
  const rains = [slot?.rainProb, omHour?.precipitation_probability, kachelmannHour?.rainProb].filter(v => typeof v === 'number');
  const avgTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
  const avgRain = rains.length ? rains.reduce((a, b) => a + b, 0) / rains.length : null;

  const condKey = skyConditionKey(slot?.sky);
  document.getElementById('statusIcon').innerHTML = weatherIconMarkup(condKey, nightNow, 'xl');
  document.getElementById('headerIcon').innerHTML = weatherIconMarkup(condKey, nightNow, 'lg');
  document.getElementById('statusTemp').textContent = avgTemp != null ? `${round(avgTemp)}°` : '--°';
  document.getElementById('statusDesc').textContent = day0?.title || 'Aktuelle Lage';
  document.getElementById('statusRain').textContent = avgRain != null ? `${round(avgRain)}%` : '--%';
  document.getElementById('statusWind').textContent = om?.current?.wind_speed_10m != null ? `${round(om.current.wind_speed_10m)} km/h` : '-- km/h';
  document.getElementById('statusMinMax').textContent = day0 ? `${round(day0.tMin)}° / ${round(day0.tMax)}°` : '--° / --°';
  document.getElementById('statusSourceCount').textContent = temps.length;

  const updated = fmtTime(now);
  document.getElementById('headerUpdated').textContent = `aktualisiert ${updated}`;
  document.getElementById('aboutUpdated').textContent = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: ROME_TZ }).format(now);
}

function nearestOpenMeteoHourly(om) {
  if (!om?.hourly?.time) return null;
  const now = Date.now();
  let bestIdx = 0, bestDiff = Infinity;
  om.hourly.time.forEach((t, i) => {
    const diff = Math.abs(new Date(t).getTime() - now);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
  });
  return {
    precipitation_probability: om.hourly.precipitation_probability?.[bestIdx],
    temperature_2m: om.hourly.temperature_2m?.[bestIdx],
    weather_code: om.hourly.weather_code?.[bestIdx],
  };
}

function renderHourly() {
  const el = document.getElementById('hourlyScroll');
  const next = STATE.hourly.filter(h => h.time.getTime() >= Date.now() - 3600 * 1000).slice(0, 12);
  if (!next.length) { el.innerHTML = '<div class="placeholder">Keine Stundendaten verfügbar.</div>'; return; }
  const day0 = STATE.days[0];
  el.innerHTML = next.map(h => {
    const night = day0?.astronomy ? isNightAt(h.time, day0.astronomy.sunRise, day0.astronomy.sunSet) : false;
    return `<div class="hour-item">
      <span class="hour-item__time">${fmtTime(h.time)}</span>
      <span class="hour-item__icon">${skyIcon(h.sky, night)}</span>
      <span class="hour-item__temp">${round(h.temp)}°</span>
      <span class="hour-item__rain">${uiIcon('drop', 'xs')}${h.rainProb ?? 0}%</span>
    </div>`;
  }).join('');
}

function renderDayList() {
  const el = document.getElementById('dayList');
  if (!STATE.days.length) { el.innerHTML = '<div class="placeholder">Keine Tagesdaten verfügbar.</div>'; return; }
  const allTemps = STATE.days.flatMap(d => [d.tMin, d.tMax]).filter(v => typeof v === 'number');
  const globalMin = Math.min(...allTemps), globalMax = Math.max(...allTemps);
  const span = Math.max(1, globalMax - globalMin);
  el.innerHTML = STATE.days.map(d => {
    const left = ((d.tMin - globalMin) / span) * 100;
    const width = Math.max(6, ((d.tMax - d.tMin) / span) * 100);
    return `<div class="day-row">
      <span class="day-row__name">${fmtDayLabel(d.date, d.idx)}</span>
      <span class="day-row__icon">${skyIcon(d.sky, false)}</span>
      <span class="day-row__range">
        <span class="temp-min">${round(d.tMin)}°</span>
        <span class="range-bar"><span class="range-bar__fill" style="left:${left}%;width:${width}%"></span></span>
        <span>${round(d.tMax)}°</span>
      </span>
      <span class="day-row__rain">${d.rainProb ?? 0}%</span>
    </div>`;
  }).join('');
}

function renderQuickLinks() {
  const html = PROVIDERS.map(p => `
    <a class="quicklink" href="${p.url}" target="_blank" rel="noopener">
      <span class="quicklink__badge" style="background:${p.color}">${p.letter}</span>
      <span class="quicklink__body">
        <span class="quicklink__title">${p.name}</span>
        <span class="quicklink__sub">${p.desc}</span>
      </span>
      <span class="quicklink__chevron">${uiIcon('chevron', 'sm')}</span>
    </a>`).join('');
  document.getElementById('quickLinksOverview').innerHTML = html;
}

// ==========================================================================
// RENDER – Vergleich
// ==========================================================================
function cellHtml(iconHtml, tMin, tMax, rainProb) {
  const t = (tMin != null && tMax != null) ? `${round(tMin)}° / ${round(tMax)}°` : (tMax != null ? `${round(tMax)}°` : '');
  return `<span class="compare-cell__icon">${iconHtml}</span>
    <span class="compare-cell__temp">${t}</span>
    ${rainProb != null ? `<span class="compare-cell__rain">${round(rainProb)}% Regen</span>` : ''}`;
}
function naCell() { return '<span class="compare-cell__na">–</span>'; }

function renderCompareTable() {
  const tbody = document.querySelector('#compareTable tbody');
  const om = STATE.openMeteo;
  const omOffset = CONFIG.openMeteoPastDays;
  if (!STATE.days.length) { tbody.innerHTML = '<tr><td colspan="4" class="placeholder">Keine Daten.</td></tr>'; return; }
  tbody.innerHTML = STATE.days.map((d, i) => {
    const suedtirol = cellHtml(skyIcon(d.sky, false), d.tMin, d.tMax, d.rainProb);

    let omCell = naCell();
    const oi = omOffset + i;
    if (om?.daily?.time?.[oi]) {
      omCell = cellHtml(omIcon(om.daily.weather_code[oi], false), om.daily.temperature_2m_min[oi], om.daily.temperature_2m_max[oi], om.daily.precipitation_probability_max?.[oi]);
    }

    const km = STATE.kachelmann?.daily?.[i];
    const kachelmannCell = km ? cellHtml(weatherIconMarkup(km.conditionKey, false), km.tMin, km.tMax, null) : naCell();

    return `<tr>
      <td>${fmtDayLabel(d.date, d.idx)}</td>
      <td>${suedtirol}</td>
      <td>${omCell}</td>
      <td>${kachelmannCell}</td>
    </tr>`;
  }).join('');
}

function renderProviderCardsInto(containerId, providers) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = providers.map(p => `
    <div class="provider-card" data-provider="${p.id}">
      <div class="provider-card__head">
        <span class="quicklink__badge" style="background:${p.color}">${p.letter}</span>
        <div class="quicklink__body">
          <div class="quicklink__title">${p.name}</div>
          <div class="quicklink__sub">${p.desc}</div>
        </div>
      </div>
      <div class="provider-card__actions">
        <a class="btn btn--primary" href="${p.url}" target="_blank" rel="noopener">Original öffnen</a>
        ${p.embeddable ? `<button class="btn btn--ghost" data-toggle-preview="${p.id}">Vorschau</button>` : ''}
      </div>
      ${p.embeddable ? `<div class="provider-card__frame-wrap" id="frame-${p.id}"></div>` : ''}
    </div>`).join('');

  el.querySelectorAll('[data-toggle-preview]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.togglePreview;
      const provider = providers.find(p => p.id === id);
      const wrap = document.getElementById(`frame-${id}`);
      const isOpen = wrap.classList.contains('is-open');
      if (isOpen) {
        wrap.classList.remove('is-open');
        wrap.innerHTML = '';
        btn.textContent = 'Vorschau';
      } else {
        wrap.innerHTML = `<iframe src="${provider.url}" loading="lazy" referrerpolicy="no-referrer" title="${provider.name} Vorschau"></iframe>
          <p class="provider-card__frame-fallback">Falls hier nichts erscheint, blockiert die Seite die Einbettung – bitte <a href="${provider.url}" target="_blank" rel="noopener">Original öffnen</a>.</p>`;
        wrap.classList.add('is-open');
        btn.textContent = 'Vorschau schließen';
      }
    });
  });
}
function renderProviderCards() { renderProviderCardsInto('providerCards', PROVIDERS); }

// Flugwetter-Spezialdienste (Segelflug/Gleitschirm): SkySight & TopMeteo sind
// kostenpflichtige Abos ohne öffentliche API – bewusst nur als Link, keine
// erfundenen Vergleichswerte. Siehe Windprofil (Live-Radar-Tab) für eine
// kostenlose Alternative zu Meteoblues Aerological-Paket.
const FLIGHT_WEATHER_PROVIDERS = [
  {
    id: 'skysight', name: 'SkySight', letter: 'SK', color: '#7c3fc4',
    url: 'https://skysight.io',
    desc: 'Segelflug-/Gleitschirmwetter (Thermik, Wind, Wellen, Vertikalprofile). Ab ca. 89€/Jahr – keine öffentliche API.',
    embeddable: false,
  },
  {
    id: 'topmeteo', name: 'TopMeteo', letter: 'TM', color: '#c4763f',
    url: 'https://www.topmeteo.eu',
    desc: 'Flugwetter für Segelflug, Gleitschirm, Ballon (Thermikkarten, Windprofile 1-kt-Auflösung). Kostenpflichtiges Abo – keine öffentliche API.',
    embeddable: false,
  },
];
function renderFlightWeatherCards() { renderProviderCardsInto('flightWeatherCards', FLIGHT_WEATHER_PROVIDERS); }

// ==========================================================================
// RENDER – Details (Chart, Astronomie, Standort)
// ==========================================================================
function renderChart() {
  const canvas = document.getElementById('detailChart');
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.parentElement.clientWidth;
  const cssH = 220;
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const data = STATE.hourly.slice(0, 16);
  if (!data.length) {
    ctx.fillStyle = getCssVar('--text-muted');
    ctx.font = '13px sans-serif';
    ctx.fillText('Keine Daten verfügbar.', 10, 30);
    return;
  }
  const padL = 34, padR = 38, padT = 16, padB = 24;
  const w = cssW - padL - padR, h = cssH - padT - padB;
  const temps = data.map(d => d.temp);
  const rains = data.map(d => d.rainFall || 0);
  const tMin = Math.min(...temps) - 2, tMax = Math.max(...temps) + 2;
  const rMax = Math.max(4, ...rains);
  const barMaxH = h * 0.6;

  const x = i => padL + (i / (data.length - 1)) * w;
  const yTemp = t => padT + h - ((t - tMin) / (tMax - tMin)) * h;
  const barW = w / data.length * 0.5;

  ctx.strokeStyle = getCssVar('--card-border');
  ctx.lineWidth = 1;
  for (let i = 0; i <= 2; i++) {
    const gy = padT + (h / 2) * i;
    ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(cssW - padR, gy); ctx.stroke();
  }

  const accentColor = getCssVar('--accent');
  ctx.fillStyle = accentColor;
  ctx.globalAlpha = 0.55;
  data.forEach((d, i) => {
    const bh = ((d.rainFall || 0) / rMax) * barMaxH;
    ctx.fillRect(x(i) - barW / 2, padT + h - bh, barW, bh);
  });
  ctx.globalAlpha = 1;

  const tempColor = getCssVar('--temp-line');
  ctx.strokeStyle = tempColor;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  data.forEach((d, i) => { const px = x(i), py = yTemp(d.temp); i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); });
  ctx.stroke();
  ctx.fillStyle = tempColor;
  data.forEach((d, i) => { ctx.beginPath(); ctx.arc(x(i), yTemp(d.temp), 2.5, 0, 7); ctx.fill(); });

  // X-Achse (Zeit)
  ctx.fillStyle = getCssVar('--text-muted');
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  data.forEach((d, i) => {
    if (i % 2 === 0) ctx.fillText(fmtTime(d.time), x(i), cssH - 6);
  });

  // Y-Achse links: Temperatur (°C)
  ctx.textAlign = 'left';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = tempColor;
  ctx.fillText(`${round(tMax)}°`, 2, padT + 8);
  ctx.fillText(`${round(tMin)}°`, 2, padT + h);

  // Y-Achse rechts: Niederschlag (mm)
  ctx.textAlign = 'right';
  ctx.fillStyle = accentColor;
  ctx.fillText(`${rMax.toFixed(1)}mm`, cssW - 2, padT + h - barMaxH + 8);
  ctx.fillText('0mm', cssW - 2, padT + h);

  // Legende
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = tempColor;
  ctx.fillRect(padL, 2, 9, 3);
  ctx.fillText('Temperatur', padL + 13, 8);
  const legendW = ctx.measureText('Temperatur').width;
  ctx.fillStyle = accentColor;
  ctx.fillRect(padL + 13 + legendW + 14, 2, 9, 3);
  ctx.fillText('Niederschlag', padL + 13 + legendW + 27, 8);
}
function getCssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; }

function renderAstro() {
  const day0 = STATE.days[0];
  const el = document.getElementById('sunGrid');
  if (!day0?.astronomy) { el.innerHTML = '<div class="placeholder">Keine Astronomiedaten verfügbar.</div>'; return; }
  const a = day0.astronomy;
  const items = [
    ['sunrise', 'Sonnenaufgang', a.sunRise], ['sunset', 'Sonnenuntergang', a.sunSet],
    ['moonrise', 'Mondaufgang', a.moonRise], ['moonset', 'Monduntergang', a.moonSet],
  ];
  el.innerHTML = items.map(([icon, label, val]) => `
    <div class="sun-item"><span class="sun-item__icon">${uiIcon(icon)}</span>
      <span><span class="sun-item__label">${label}</span><span class="sun-item__value">${val || '–'}</span></span>
    </div>`).join('');
}

function renderLocation() {
  const el = document.getElementById('locGrid');
  const elevation = STATE.openMeteo?.elevation;
  const moon = computeMoonPhase(new Date());
  el.innerHTML = `
    <div class="loc-item"><span class="loc-item__label">Ort</span><span class="loc-item__value">${CONFIG.position.name} (${CONFIG.position.sub})</span></div>
    <div class="loc-item"><span class="loc-item__label">Höhe</span><span class="loc-item__value">${elevation != null ? round(elevation) + ' m ü.d.M.' : '–'}</span></div>
    <div class="loc-item"><span class="loc-item__label">Mondphase</span><span class="loc-item__value loc-item__value--icon">${moonPhaseIconMarkup(moon.phase, 'md')}${moon.name}</span></div>
    <div class="loc-item"><span class="loc-item__label">Zuverlässigkeit heute</span><span class="loc-item__value">${STATE.days[0]?.reliability ?? '–'}%</span></div>`;
}

// --- Mondphase (astronomische Näherung, kein Server-Call nötig) -----------
const MOON_PHASE_NAMES = [
  'Neumond', 'Zunehmende Sichel', 'Zunehmender Halbmond', 'Zunehmender Dreiviertelmond',
  'Vollmond', 'Abnehmender Dreiviertelmond', 'Abnehmender Halbmond', 'Abnehmende Sichel',
];
function computeMoonPhase(date) {
  const synodic = 29.530588853;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14);
  const days = (date.getTime() - knownNewMoon) / 86400000;
  let phase = (days % synodic) / synodic;
  if (phase < 0) phase += 1;
  const idx = Math.round(phase * 8) % 8;
  return { phase, name: MOON_PHASE_NAMES[idx] };
}
function moonPhaseIconMarkup(phase, size = 'md') {
  const cx = 12, cy = 12, r = 8;
  const id = 'mpclip' + (_svgUid++);
  const d = Math.abs(phase - 0.5) * 2 * (2 * r);
  const dir = phase < 0.5 ? 1 : -1;
  const shift = dir * d;
  const inner = `<defs><clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--cloud-color)"/>
    <g clip-path="url(#${id})"><circle cx="${(cx + shift).toFixed(2)}" cy="${cy}" r="${r}" fill="var(--moon-color)"/></g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--cloud-color)" stroke-width="0.6" opacity="0.5"/>`;
  return svgWrap(inner, `wicon--${size}`);
}

// ==========================================================================
// HEUWETTER-INDEX / TROCKENFENSTER
// ==========================================================================
const HEU_STEP_LABELS = {
  3: ['Mähen / Zetteln', 'Wenden', 'Schwaden / Einfahren'],
  4: ['Mähen / Zetteln', 'Wenden', 'Wenden', 'Einfahren'],
};
const DRYING_META = {
  fast: { icon: 'bolt', label: 'Sehr schnelle Trocknung' },
  medium: { icon: 'cloudsun', label: 'Moderate Trocknung' },
  slow: { icon: 'warn', label: 'Träge Trocknung' },
};

function computeDryingIndex(dateObj, hourly) {
  if (!hourly?.time) return null;
  const dateStr = isoDateInTz(dateObj, ROME_TZ);
  const idxs = [];
  hourly.time.forEach((t, i) => { if (t.startsWith(dateStr)) idxs.push(i); });
  if (!idxs.length) return null;
  const hourOf = i => +hourly.time[i].slice(11, 13);
  const windowIdx = idxs.filter(i => { const h = hourOf(i); return h >= 11 && h <= 16; });
  const morningIdx = idxs.filter(i => { const h = hourOf(i); return h >= 0 && h <= 6; });

  const avgRH = avg(windowIdx.map(i => hourly.relative_humidity_2m?.[i]));
  const avgDewDiff = avg(windowIdx.map(i => (hourly.temperature_2m?.[i] != null && hourly.dew_point_2m?.[i] != null) ? hourly.temperature_2m[i] - hourly.dew_point_2m[i] : null));
  const avgWind = avg(windowIdx.map(i => hourly.wind_speed_10m?.[i]));
  const morningRHs = morningIdx.map(i => hourly.relative_humidity_2m?.[i]).filter(v => typeof v === 'number');
  const maxMorningRH = morningRHs.length ? Math.max(...morningRHs) : null;
  const heavyDew = maxMorningRH != null && maxMorningRH > 90;

  if (avgRH == null && avgDewDiff == null) return null;

  let cls;
  if ((avgRH != null && avgRH < 50) || (avgDewDiff != null && avgDewDiff > 10)) cls = 'optimal';
  else if ((avgRH != null && avgRH > 65) || (avgDewDiff != null && avgDewDiff < 5)) cls = 'kritisch';
  else cls = 'maessig';
  if (heavyDew) cls = cls === 'optimal' ? 'maessig' : 'kritisch';

  let speed;
  if (cls === 'optimal' && avgWind != null && avgWind >= 8) speed = 'fast';
  else if (cls === 'kritisch') speed = 'slow';
  else speed = 'medium';

  return { avgRH, avgDewDiff, avgWind, heavyDew, cls, speed };
}

function findHeuWindow(days, requiredWindow) {
  for (let start = 0; start + requiredWindow <= days.length; start++) {
    const slice = days.slice(start, start + requiredWindow);
    if (slice.every(d => d.isDry)) return { status: 'green', start, end: start + requiredWindow - 1 };
  }
  for (let start = 0; start + requiredWindow <= days.length; start++) {
    const slice = days.slice(start, start + requiredWindow);
    const okOrRisky = slice.every(d => d.isDry || d.isRisky);
    const riskyDay = slice.find(d => !d.isDry);
    if (okOrRisky && riskyDay) return { status: 'yellow', start, end: start + requiredWindow - 1, riskyDay };
  }
  return { status: 'red' };
}

function computeHeuwetter() {
  const om = STATE.openMeteo;
  if (!STATE.days.length || !om?.daily) return null;
  const PAST = CONFIG.openMeteoPastDays;

  const pastPrecip = om.daily.precipitation_sum?.slice(0, PAST) || [];
  const baselineWet = pastPrecip.reduce((a, b) => a + (b || 0), 0) >= 1;
  const requiredWindow = baselineWet ? 4 : 3;

  const days = STATE.days.map((d, i) => {
    const oi = PAST + i;
    const omRainProb = om.daily.precipitation_probability_max?.[oi];
    const omPrecip = om.daily.precipitation_sum?.[oi];
    const omSunH = om.daily.sunshine_duration?.[oi] != null ? om.daily.sunshine_duration[oi] / 3600 : null;

    const rainProbs = [d.rainProb, omRainProb].filter(v => typeof v === 'number');
    const precs = [d.rainFall, omPrecip].filter(v => typeof v === 'number');
    const sunHs = [d.sunshineDuration, omSunH].filter(v => typeof v === 'number');

    const rainProbMax = rainProbs.length ? Math.max(...rainProbs) : null;
    const precipMax = precs.length ? Math.max(...precs) : null;
    const sunshineHours = sunHs.length ? Math.min(...sunHs) : null;

    const isDry = precipMax != null && precipMax < 0.2 && rainProbMax != null && rainProbMax < 15 && sunshineHours != null && sunshineHours >= 7;
    const isRisky = !isDry && precipMax != null && precipMax < 1 && rainProbMax != null && rainProbMax < 40 && sunshineHours != null && sunshineHours >= 5;

    return {
      idx: i, date: d.date, sky: d.sky,
      rainProbMax, precipMax, sunshineHours, isDry, isRisky,
      drying: computeDryingIndex(d.date, om.hourly),
    };
  });

  const win = findHeuWindow(days, requiredWindow);
  return { requiredWindow, baselineWet, days, window: win, todayIdx: 0 };
}

function heuBannerContent(heu) {
  const { requiredWindow, baselineWet, days, window: win } = heu;
  if (win.status === 'green') {
    return {
      status: 'green', icon: 'check',
      msg: `Perfektes Heuwetter-Fenster von ${fmtDayLabel(days[win.start].date, win.start)} bis ${fmtDayLabel(days[win.end].date, win.end)}!`,
      sub: baselineWet
        ? `${requiredWindow} Tage Fenster – 1 Tag Bodenabtrocknung + 3 Tage Trocknung (zuletzt nass).`
        : `${requiredWindow} Tage trocken – Boden war bereits trocken.`,
    };
  }
  if (win.status === 'yellow') {
    return {
      status: 'yellow', icon: 'warn',
      msg: `Mögliches Wetterfenster ab ${fmtDayLabel(days[win.start].date, win.start)}, aber erhöhtes Schauer-Risiko am ${fmtDayLabel(win.riskyDay.date, win.riskyDay.idx)}.`,
      sub: `Benötigtes Trockenfenster: ${requiredWindow} Tage (${baselineWet ? 'Boden aktuell nass' : 'Boden aktuell trocken'}).`,
    };
  }
  return {
    status: 'red', icon: 'warn',
    msg: `Kein Heuwetter in Sicht – zu hohe Regenwahrscheinlichkeit in den nächsten ${days.length} Tagen.`,
    sub: `Benötigtes Trockenfenster: ${requiredWindow} Tage (${baselineWet ? 'Boden aktuell nass' : 'Boden aktuell trocken'}).`,
  };
}

function renderHeuBanner(target, content) {
  const root = document.getElementById(target);
  if (!root) return;
  root.classList.remove('heu-banner--green', 'heu-banner--yellow', 'heu-banner--red');
  root.classList.add(`heu-banner--${content.status}`);
  const iconEl = root.querySelector('.heu-banner__icon');
  const msgEl = root.querySelector('.heu-banner__msg');
  const subEl = root.querySelector('.heu-banner__sub');
  if (iconEl) iconEl.innerHTML = uiIcon(content.icon, 'lg');
  if (msgEl) msgEl.textContent = content.msg;
  if (subEl) subEl.textContent = content.sub;
}

function renderHeuSteps(heu) {
  const el = document.getElementById('heuSteps');
  if (!el) return;
  const { window: win, requiredWindow, todayIdx, days } = heu;
  if (win.status === 'red') {
    el.innerHTML = '<p class="placeholder">Kein Trockenfenster in Sicht – kein Countdown verfügbar.</p>';
    return;
  }
  const labels = HEU_STEP_LABELS[requiredWindow];
  const currentStep = (todayIdx >= win.start && todayIdx <= win.end) ? todayIdx - win.start : -1;
  const hint = (currentStep < 0 && todayIdx < win.start)
    ? `<p class="heu-steps__hint">Fenster beginnt in ${win.start - todayIdx} Tag(en).</p>` : '';
  el.innerHTML = hint + labels.map((label, i) => {
    const stepDay = days[win.start + i];
    const state = i < currentStep ? 'done' : i === currentStep ? 'active' : 'upcoming';
    return `<div class="heu-step heu-step--${state}">
      <span class="heu-step__dot">${i < currentStep ? uiIcon('check', 'xs') : i + 1}</span>
      <span class="heu-step__label">${label}</span>
      <span class="heu-step__day">${fmtDayLabel(stepDay.date, stepDay.idx)}</span>
    </div>`;
  }).join('');
}

function renderHeuDayGrid(heu) {
  const el = document.getElementById('heuDayGrid');
  if (!el) return;
  el.innerHTML = heu.days.map(d => {
    const status = !d.isDry && !d.isRisky ? 'red' : (d.drying?.cls === 'kritisch') ? 'yellow' : d.isDry ? 'green' : 'yellow';
    const dr = d.drying ? DRYING_META[d.drying.speed] : null;
    return `<div class="heu-day heu-day--${status}">
      <div class="heu-day__head">
        <span class="heu-day__icon">${skyIcon(d.sky, false)}</span>
        <span class="heu-day__date">${fmtDayLabel(d.date, d.idx)}</span>
        <span class="heu-day__pill heu-day__pill--${status}"></span>
      </div>
      <div class="heu-day__stats">
        <span class="heu-day__stat">${uiIcon('drop', 'xs')}${d.rainProbMax ?? '–'}%</span>
        <span class="heu-day__stat">${uiIcon('sun', 'xs')}${d.sunshineHours != null ? d.sunshineHours.toFixed(1) : '–'}h</span>
        ${d.drying?.avgDewDiff != null ? `<span class="heu-day__stat">${uiIcon('thermo', 'xs')}Δ${d.drying.avgDewDiff.toFixed(1)}°</span>` : ''}
      </div>
      ${dr ? `<div class="heu-day__drying">${uiIcon(dr.icon, 'sm')}<span>${dr.label}</span></div>` : '<div class="heu-day__drying heu-day__drying--na">Abtrocknungsdaten unvollständig</div>'}
      ${d.drying?.heavyDew ? `<div class="heu-day__dew">${uiIcon('warn', 'xs')} Starker Tau am Morgen (−2h Trocknung eingerechnet)</div>` : ''}
    </div>`;
  }).join('');
}

function renderHeuwetter() {
  const heu = computeHeuwetter();
  STATE.heu = heu;
  if (!heu) {
    ['heuBannerTop', 'heuBannerFull'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { const m = el.querySelector('.heu-banner__msg'); if (m) m.textContent = 'Heuwetter-Daten aktuell nicht verfügbar.'; }
    });
    return;
  }
  const content = heuBannerContent(heu);
  renderHeuBanner('heuBannerTop', content);
  renderHeuBanner('heuBannerFull', content);
  renderHeuSteps(heu);
  renderHeuDayGrid(heu);
}

// ==========================================================================
// ORTSSUCHE (alle Fraktionen/Orte Südtirols) – Standard bleibt immer Zimat
// ==========================================================================
// Nominatim (OpenStreetMap) findet auch kleine Weiler/Fraktionen, die in den
// 116 Gemeinden des Landeswetterdienstes nicht einzeln vorkommen. Aus dem
// Ergebnis wird per Namens-Abgleich die zugehörige Gemeinde ermittelt, damit
// die Landeswetterdienst-Daten (nur je Gemeinde verfügbar) mitwechseln.
function normalizeName(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/g, '');
}
function matchMunicipality(displayName) {
  if (!STATE.municipalities?.length || !displayName) return null;
  const tokens = displayName.split(',').map(t => t.trim());
  for (const tok of tokens) {
    const norm = normalizeName(tok);
    const m = STATE.municipalities.find(mu => normalizeName(mu.name_de) === norm || normalizeName(mu.name_it) === norm);
    if (m) return m;
  }
  return null;
}

let locSearchAbort = null;
async function searchPlaces(query) {
  if (locSearchAbort) locSearchAbort.abort();
  locSearchAbort = new AbortController();
  const p = new URLSearchParams({
    format: 'json', q: query, addressdetails: '1', limit: '8',
    viewbox: CONFIG.southTyrolViewbox, bounded: '1', countrycodes: 'it',
  });
  p.append('accept-language', 'de');
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${p.toString()}`, { signal: locSearchAbort.signal });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function updateLocationTexts() {
  const nameEl = document.getElementById('headerPositionName');
  const subEl = document.getElementById('headerLocationSub');
  if (nameEl) nameEl.textContent = CONFIG.position.name;
  if (subEl) subEl.textContent = CONFIG.position.sub ? `${CONFIG.position.sub} · Südtirol` : 'Südtirol';
  document.querySelectorAll('.js-loc-position').forEach(el => { el.textContent = CONFIG.position.name; });
  document.querySelectorAll('.js-loc-municipality').forEach(el => { el.textContent = CONFIG.municipality.name_de; });
}

function applyLocation({ name, sub, lat, lon, municipality }) {
  CONFIG.position = { name, sub, lat, lon };
  if (municipality) {
    CONFIG.municipality = { uuid: municipality.id, name_de: municipality.name_de, url_slug_de: municipality.url_slug_de };
  }
  buildProviders();
  updateLocationTexts();
  renderQuickLinks();
  renderProviderCards();
  Radar.updatePosition();
  closeLocationSheet();
  showToast(`Position: ${name}${municipality ? ' · Landeswetterdienst-Gemeinde: ' + CONFIG.municipality.name_de : ' · keine Gemeinde zugeordnet, nur Open-Meteo/Karte aktualisiert'}`, 4500);
  loadAll();
}

function resetToDefaultLocation() {
  const kiens = STATE.municipalities?.find(m => m.name_de === 'Kiens')
    || { id: '9a239c35-f405-46ab-ba5d-aeffd2b8af0b', name_de: 'Kiens', url_slug_de: 'kiens' };
  applyLocation({ name: 'Zimat', sub: 'Fraktion von Kiens', lat: 46.81423, lon: 11.80156, municipality: kiens });
}

function openLocationSheet() {
  document.getElementById('locationSheet').hidden = false;
  const input = document.getElementById('locationSearchInput');
  input.value = '';
  renderLocationResults([]);
  setTimeout(() => input.focus(), 60);
}
function closeLocationSheet() {
  document.getElementById('locationSheet').hidden = true;
}

function locationResultSub(placeName, municipality) {
  if (!municipality) return 'Südtirol';
  if (normalizeName(placeName) === normalizeName(municipality.name_de)) return 'Gemeinde · Südtirol';
  return `Fraktion von ${municipality.name_de} · Südtirol`;
}

function renderLocationResults(results, message) {
  const el = document.getElementById('locationResults');
  const defaultBtn = `<button class="location-result location-result--default" id="locationDefaultBtn">
    <span class="location-result__icon">${uiIcon('pin', 'sm')}</span>
    <span class="location-result__body"><span class="location-result__name">Zimat</span><span class="location-result__sub">Standard · Fraktion von Kiens</span></span>
  </button>`;

  if (message) {
    el.innerHTML = defaultBtn + `<p class="location-results__hint">${message}</p>`;
  } else {
    el.innerHTML = defaultBtn + results.map((r, i) => {
      const municipality = matchMunicipality(r.display_name);
      const placeName = r.display_name.split(',')[0].trim();
      return `<button class="location-result" data-idx="${i}">
        <span class="location-result__icon">${uiIcon('pin', 'sm')}</span>
        <span class="location-result__body"><span class="location-result__name">${placeName}</span><span class="location-result__sub">${locationResultSub(placeName, municipality)}</span></span>
      </button>`;
    }).join('');
  }

  document.getElementById('locationDefaultBtn').addEventListener('click', resetToDefaultLocation);
  el.querySelectorAll('.location-result:not(.location-result--default)').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = results[+btn.dataset.idx];
      if (!r) return;
      const municipality = matchMunicipality(r.display_name);
      const placeName = r.display_name.split(',')[0].trim();
      const sub = municipality
        ? (normalizeName(placeName) === normalizeName(municipality.name_de) ? 'Gemeinde' : `Fraktion von ${municipality.name_de}`)
        : '';
      applyLocation({ name: placeName, sub, lat: +r.lat, lon: +r.lon, municipality });
    });
  });
}

let locDebounceTimer = null;
function initLocationPicker() {
  document.getElementById('locationTrigger').addEventListener('click', openLocationSheet);
  document.getElementById('locationSheetBackdrop').addEventListener('click', closeLocationSheet);
  document.getElementById('locationSheetClose').addEventListener('click', closeLocationSheet);
  const input = document.getElementById('locationSearchInput');
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(locDebounceTimer);
    if (q.length < 2) { renderLocationResults([]); return; }
    locDebounceTimer = setTimeout(async () => {
      renderLocationResults([], 'Suche…');
      try {
        const results = await searchPlaces(q);
        if (!results.length) { renderLocationResults([], 'Keine Ergebnisse gefunden.'); return; }
        renderLocationResults(results);
      } catch (e) {
        if (e.name !== 'AbortError') renderLocationResults([], 'Suche fehlgeschlagen – bitte erneut versuchen.');
      }
    }, 450);
  });
}

// ==========================================================================
// LOAD & REFRESH
// ==========================================================================
async function loadAll() {
  const results = await Promise.allSettled([
    loadMunicipalityHourly(),
    Promise.all([0, 1, 2, 3, 4].map(loadMunicipalityDay)),
    loadOpenMeteo(),
    loadKachelmann(),
  ]);

  if (results[0].status === 'fulfilled') STATE.hourly = results[0].value;
  else showToast('Stundenprognose (Land) nicht verfügbar.');

  if (results[1].status === 'fulfilled') STATE.days = results[1].value.filter(Boolean);
  else showToast('Tagesprognose (Land) nicht verfügbar.');

  if (results[2].status === 'fulfilled') STATE.openMeteo = results[2].value;
  else showToast('Open-Meteo-Referenzdaten nicht verfügbar.');

  if (results[3].status === 'fulfilled') STATE.kachelmann = results[3].value;
  else { STATE.kachelmann = null; showToast('Kachelmann-Daten aktuell nicht lesbar (kein offizielles API).'); }

  STATE.lastUpdated = new Date();
  renderStatus(); renderHourly(); renderDayList();
  renderCompareTable(); renderChart(); renderAstro(); renderLocation();
  renderHeuwetter();
  if (document.getElementById('windProfilePanel')?.classList.contains('is-open')) renderWindProfile();
}

// ==========================================================================
// RADAR / LIVE-KARTE
// ==========================================================================
const boundsCache = new Map();
function boundsFromBbox(bboxStr, srs) {
  const key = `${srs}|${bboxStr}`;
  if (boundsCache.has(key)) return boundsCache.get(key);
  const [xmin, ymin, xmax, ymax] = bboxStr.split(',').map(Number);
  let bounds;
  if (srs === 'EPSG:4326') {
    bounds = L.latLngBounds([ymin, xmin], [ymax, xmax]);
  } else {
    const sw = proj4(srs, 'EPSG:4326', [xmin, ymin]);
    const ne = proj4(srs, 'EPSG:4326', [xmax, ymax]);
    bounds = L.latLngBounds([sw[1], sw[0]], [ne[1], ne[0]]);
  }
  boundsCache.set(key, bounds);
  return bounds;
}

const Radar = {
  map: null, overlay: null, marker: null,
  mode: 'live', layers: [], activeLayer: null, frames: [], frameIndex: 0,
  playing: false, timer: null, lastLoad: { live: 0, forecast: 0 },

  ensureMap() {
    if (this.map) return;
    this.map = L.map('map', { attributionControl: true, zoomControl: true }).setView([CONFIG.position.lat, CONFIG.position.lon], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 17, attribution: '© OpenStreetMap-Mitwirkende',
    }).addTo(this.map);
    this.marker = L.marker([CONFIG.position.lat, CONFIG.position.lon]).addTo(this.map)
      .bindPopup(`${CONFIG.position.name} (${CONFIG.position.sub})`);
  },

  updatePosition() {
    if (!this.map) return;
    this.marker.setLatLng([CONFIG.position.lat, CONFIG.position.lon])
      .setPopupContent(`${CONFIG.position.name}${CONFIG.position.sub ? ' (' + CONFIG.position.sub + ')' : ''}`);
    this.map.setView([CONFIG.position.lat, CONFIG.position.lon], this.map.getZoom());
  },

  async setMode(mode) {
    this.pause();
    this.mode = mode;
    document.querySelectorAll('#radarModeSwitch .segmented__btn').forEach(b => b.classList.toggle('is-active', b.dataset.mode === mode));
    if (this.overlay) { this.map?.removeLayer(this.overlay); this.overlay = null; }
    const srcLink = document.getElementById('mapSourceLink');
    if (srcLink) srcLink.href = mode === 'live' ? RADAR_SOURCE_LINKS[0].url : RADAR_SOURCE_LINKS[1].url;
    await this.load(true);
  },

  async load(force = false) {
    this.ensureMap();
    const now = Date.now();
    if (!force && now - this.lastLoad[this.mode] < 60000 && this.layers.length) return;
    document.getElementById('radarStatus').textContent = 'Lade Kartendaten…';
    try {
      const url = this.mode === 'live'
        ? `${CONFIG.meteoBase}/frames/timeseries-radar.json`
        : `${CONFIG.meteoBase}/frames/timeseries-inca-icon.json`;
      const data = await fetchJSON(url);
      this.layers = (Array.isArray(data) ? data : []).filter(l => String(l.online) !== 'false');
      this.lastLoad[this.mode] = now;
      if (!this.layers.length) throw new Error('Keine Ebenen erhalten');
      const keepKey = this.activeLayer?.weather_type;
      const keep = this.layers.find(l => l.weather_type === keepKey);
      this.renderChips();
      this.selectLayer(keep || this.layers[0]);
    } catch (e) {
      document.getElementById('radarStatus').textContent = 'Radar-/Kartendaten aktuell nicht verfügbar.';
      document.getElementById('layerChips').innerHTML = '';
    }
  },

  renderChips() {
    const el = document.getElementById('layerChips');
    el.innerHTML = this.layers.map(l => `<button class="layer-chip" data-type="${l.weather_type}">${l.layerLabel?.DE || l.weather_type}</button>`).join('');
    el.querySelectorAll('.layer-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const layer = this.layers.find(l => l.weather_type === btn.dataset.type);
        if (layer) this.selectLayer(layer);
      });
    });
  },

  selectLayer(layer) {
    this.activeLayer = layer;
    document.querySelectorAll('#layerChips .layer-chip').forEach(b => b.classList.toggle('is-active', b.dataset.type === layer.weather_type));
    this.frames = buildFrames(layer, CONFIG.meteoBase);
    const now = Date.now();
    if (this.mode === 'live') {
      this.frameIndex = Math.max(0, this.frames.length - 1);
    } else {
      const nowIdx = this.frames.findIndex(f => f.time.getTime() >= now);
      this.frameIndex = nowIdx >= 0 ? nowIdx : Math.max(0, this.frames.length - 1);
    }
    this.renderLegend(layer);
    this.updateOverlay();
    const slider = document.getElementById('timeSlider');
    slider.max = String(Math.max(0, this.frames.length - 1));
    slider.value = String(this.frameIndex);

    if (!this.frames.length) {
      document.getElementById('radarStatus').textContent = 'Für diese Ebene liegen aktuell keine Bilder vor.';
    } else if (this.mode === 'live') {
      const ageMin = Math.round((now - this.frames[this.frames.length - 1].time.getTime()) / 60000);
      document.getElementById('radarStatus').textContent = `${this.frames.length} Zeitschritte (letzte 3h) · aktuellstes Bild ist ca. ${ageMin} Min. alt.`;
    } else {
      const first = this.frames[0].time, last = this.frames[this.frames.length - 1].time;
      document.getElementById('radarStatus').textContent = `Amtliche Vorhersage von ${fmtDayTime(first)} bis ${fmtDayTime(last)} (Vergangenheit + ca. 24h Vorhersage). Regler steht auf "jetzt".`;
    }
  },

  renderLegend(layer) {
    const el = document.getElementById('mapLegend');
    if (!layer.legend?.length) { el.innerHTML = ''; return; }
    el.innerHTML = layer.legend.map(item => `
      <span class="map-legend__item"><span class="map-legend__swatch" style="background:${item.color}"></span>${String(item.value).replace(',', '.')}${layer.unit ? ' ' + layer.unit : ''}</span>`).join('');
  },

  updateOverlay() {
    this.ensureMap();
    const frame = this.frames[this.frameIndex];
    if (!frame) {
      if (this.overlay) { this.map.removeLayer(this.overlay); this.overlay = null; }
      document.getElementById('playerTime').textContent = '--:--';
      return;
    }
    const bounds = boundsFromBbox(this.activeLayer.bbox, this.activeLayer.srs || 'EPSG:25832');
    if (this.overlay) {
      this.overlay.setUrl(frame.url);
      this.overlay.setBounds(bounds);
    } else {
      this.overlay = L.imageOverlay(frame.url, bounds, { opacity: 0.75 }).addTo(this.map);
    }
    document.getElementById('playerTime').textContent = this.mode === 'live' ? fmtTime(frame.time) : fmtDayTime(frame.time);
  },

  onSlider(idx) {
    this.pause();
    this.frameIndex = idx;
    this.updateOverlay();
  },

  play() {
    if (!this.frames.length) return;
    this.playing = true;
    document.getElementById('playBtn').innerHTML = uiIcon('pause', 'lg');
    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      document.getElementById('timeSlider').value = String(this.frameIndex);
      this.updateOverlay();
    }, 550);
  },

  pause() {
    this.playing = false;
    document.getElementById('playBtn').innerHTML = uiIcon('play', 'lg');
    clearInterval(this.timer);
  },

  toggle() { this.playing ? this.pause() : this.play(); },
};

function buildFrames(layer, base) {
  const frames = [];
  (layer.timeseries || []).forEach(entry => {
    (entry.intervals || []).forEach(path => {
      const m = path.match(/(\d{14})\.webp$/);
      if (!m) return;
      const s = m[1];
      const ms = zonedTimeToUtcMs(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14), CONFIG.rasterTimeZone);
      frames.push({ url: `${base}/${path}`, time: new Date(ms) });
    });
  });
  frames.sort((a, b) => a.time - b.time);
  return frames;
}

// ==========================================================================
// WINDPROFIL (Open-Meteo Druckflächen) – kostenlose Alternative zum
// kostenpflichtigen Meteoblue "Thermal & Aerological Package".
// ==========================================================================
function nearestHourlyIndex(times) {
  const now = Date.now();
  let bestIdx = 0, bestDiff = Infinity;
  times.forEach((t, i) => {
    const diff = Math.abs(new Date(t).getTime() - now);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
  });
  return bestIdx;
}

function computeWindProfile() {
  const hourly = STATE.openMeteo?.hourly;
  if (!hourly?.time) return null;
  const idx = nearestHourlyIndex(hourly.time);
  const levels = WIND_PROFILE_LEVELS.map(hpa => ({
    hpa,
    speed: hourly[`wind_speed_${hpa}hPa`]?.[idx],
    dir: hourly[`wind_direction_${hpa}hPa`]?.[idx],
    alt: hourly[`geopotential_height_${hpa}hPa`]?.[idx],
  })).filter(l => typeof l.speed === 'number' && typeof l.alt === 'number');
  levels.sort((a, b) => a.alt - b.alt);
  return levels.length ? { time: hourly.time[idx], levels } : null;
}

function renderWindProfile() {
  const panel = document.getElementById('windProfilePanel');
  const profile = computeWindProfile();
  if (!profile) {
    panel.innerHTML = '<p class="wind-profile__hint">Windprofil aktuell nicht verfügbar.</p>';
    return;
  }
  const maxSpeed = Math.max(10, ...profile.levels.map(l => l.speed));
  panel.innerHTML = `<div class="wind-profile__time">${fmtTime(new Date(profile.time))} Uhr · ${CONFIG.position.name}</div>` +
    profile.levels.slice().reverse().map(l => `
      <div class="wind-profile__row" title="${l.hpa}hPa">
        <span class="wind-profile__alt">${Math.round(l.alt)}m</span>
        <span class="wind-profile__bararea">
          <span class="wind-profile__bar" style="width:${Math.max(4, l.speed / maxSpeed * 100).toFixed(0)}%"></span>
          <span class="wind-profile__arrow" style="transform:rotate(${(l.dir + 180) % 360}deg)">${uiIcon('windarrow', 'xs')}</span>
        </span>
        <span class="wind-profile__speed">${Math.round(l.speed)}km/h</span>
      </div>`).join('') +
    '<p class="wind-profile__hint">Höhe ü.M. · Open-Meteo-Modell, kein Meteoblue-Abo nötig.</p>';
}

// ==========================================================================
// TABS & THEME
// ==========================================================================
function switchTab(target) {
  const panels = document.querySelectorAll('.tab-panel');
  const buttons = document.querySelectorAll('.tabbar__btn');
  panels.forEach(p => p.hidden = p.dataset.tab !== target);
  buttons.forEach(b => b.classList.toggle('is-active', b.dataset.tab === target));
  document.body.classList.toggle('radar-active', target === 'radar');
  if (target === 'radar') {
    Radar.ensureMap();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      Radar.map.invalidateSize();
      if (!Radar.layers.length) Radar.load(true);
    }));
  }
  if (target === 'details') {
    setTimeout(renderChart, 30);
  }
}
function initTabs() {
  document.querySelectorAll('.tabbar__btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  document.querySelectorAll('[data-goto-tab]').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.gotoTab)));
}

function initRadarControls() {
  document.querySelectorAll('#radarModeSwitch .segmented__btn').forEach(btn => {
    btn.addEventListener('click', () => Radar.setMode(btn.dataset.mode));
  });
  document.getElementById('playBtn').addEventListener('click', () => Radar.toggle());
  document.getElementById('timeSlider').addEventListener('input', e => Radar.onSlider(+e.target.value));
  document.getElementById('legendToggle').addEventListener('click', () => {
    document.getElementById('windProfilePanel').classList.remove('is-open');
    document.getElementById('windProfileToggle').classList.remove('is-active');
    const legend = document.getElementById('mapLegend');
    legend.classList.toggle('is-open');
    document.getElementById('legendToggle').classList.toggle('is-active', legend.classList.contains('is-open'));
  });
  document.getElementById('windProfileToggle').addEventListener('click', () => {
    document.getElementById('mapLegend').classList.remove('is-open');
    document.getElementById('legendToggle').classList.remove('is-active');
    const btn = document.getElementById('windProfileToggle');
    const panel = document.getElementById('windProfilePanel');
    panel.classList.toggle('is-open');
    btn.classList.toggle('is-active', panel.classList.contains('is-open'));
    if (panel.classList.contains('is-open')) renderWindProfile();
  });
}

function initTheme() {
  const stored = localStorage.getItem('kiens-theme');
  if (stored) document.documentElement.setAttribute('data-theme', stored);
  updateThemeIcon();
  document.getElementById('themeToggle').addEventListener('click', () => {
    const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const current = document.documentElement.getAttribute('data-theme') || (sysDark ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('kiens-theme', next);
    updateThemeIcon();
  });
}
function updateThemeIcon() {
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const current = document.documentElement.getAttribute('data-theme') || (sysDark ? 'dark' : 'light');
  document.getElementById('themeToggle').innerHTML = uiIcon(current === 'dark' ? 'sun' : 'moon');
}

function initAggInfo() {
  document.getElementById('aggInfoBtn').addEventListener('click', () => {
    showToast('Temperatur & Regenwahrscheinlichkeit sind der Schnitt aus bis zu 3 Quellen: Landeswetterdienst Südtirol (Gemeinde Kiens), Open-Meteo (Position Zimat) und Kachelmannwetter. Kachelmann hat kein offizielles API und wird live von der Webseite gelesen – fehlt die Quelle kurzfristig, fließen die übrigen ein.', 6500);
  });
}

// ==========================================================================
// INIT
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  initStaticIcons();
  document.getElementById('statusIcon').innerHTML = weatherIconMarkup('cloudy', false, 'xl');
  document.getElementById('headerIcon').innerHTML = weatherIconMarkup('cloudy', false, 'lg');
  document.getElementById('playBtn').innerHTML = uiIcon('play', 'lg');

  initTheme();
  initTabs();
  initRadarControls();
  initAggInfo();
  initLocationPicker();
  renderQuickLinks();
  renderProviderCards();
  renderFlightWeatherCards();

  loadMunicipalities().catch(() => showToast('Liste der Südtiroler Gemeinden nicht verfügbar – Ortssuche findet ggf. keine Gemeindezuordnung.'));
  loadAll();
  setInterval(loadAll, CONFIG.refreshForecastMs);
  setInterval(() => { if (!document.getElementById('tab-radar').hidden) Radar.load(true); }, CONFIG.refreshRadarMs);

  window.addEventListener('resize', () => {
    if (!document.getElementById('tab-details').hidden) renderChart();
    if (document.body.classList.contains('radar-active') && Radar.map) Radar.map.invalidateSize();
  });
});
