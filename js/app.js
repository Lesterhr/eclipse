/**
 * app.js — verdrahtet Rechnung, Bild, Messung und Kameraberatung.
 */

import { nextEclipse, predictCurve, modelAt, fitScale, timeline, horizonDip, sunset } from './eclipse.js';
import { LightMeter, AmbientSensor, Sonifier } from './meter.js';
import { Session, download } from './store.js';
import { Chart, renderShareCard } from './chart.js';
import { SunView, HorizonView, compass } from './sky.js';
import {
  CompassSensor,
  AimView,
  RoseView,
  orientationFrame,
  screenAngle,
  deltaAngle,
  fistHint,
} from './compass.js';
import { SENSORS, sunSize, maxShutter, shootingAdvice, shutterLabel } from './photo.js';

const $ = (id) => document.getElementById(id);
const fmtTime = (ms) =>
  ms == null ? '—' : new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtClock = (ms) =>
  ms == null ? '—' : new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

function fmtCountdown(deltaMs) {
  const s = Math.max(0, Math.round(deltaMs / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

const PRESETS = [
  { name: 'Buchbergwarte (Wienerwald)', lat: 48.2142, lon: 15.9456, height: 488, aboveTerrain: 170 },
];

const state = {
  site: null,
  eclipse: null,
  model: [],
  path: [],
  plan: [],
  dipGainMs: 0,
  session: null,
  scale: 1,
  measuring: false,
  intervalSec: 5,
  chart: null,
  sun: null,
  horizon: null,
  aim: null,
  rose: null,
  compass: new CompassSensor(),
  /** Feinabgleich des Kompasses in Grad, wird auf jedes Gerätazimut addiert */
  compassOffset: 0,
  /** true, solange der Reiter „Peilen“ oben ist — nur dann läuft die Bildschleife */
  aiming: false,
  meter: new LightMeter(),
  ambient: new AmbientSensor(),
  sonifier: new Sonifier(),
  wakeLock: null,
  lastReading: null,
  timer: null,
  /** null = der Anzeige liegt die echte Uhrzeit zugrunde, sonst der Zeitpunkt am Schieber */
  scrubT: null,
};

/* ---------- Standort ---------- */

async function locate() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          height: Math.round(pos.coords.altitude || 0),
          aboveTerrain: 0,
          name: 'GPS-Standort',
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 600000 }
    );
  });
}

function loadSavedSite() {
  try {
    const raw = localStorage.getItem('eclipse-site');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSite(site) {
  try {
    localStorage.setItem('eclipse-site', JSON.stringify(site));
  } catch {
    /* egal */
  }
}

function loadOffset() {
  const v = Number(localStorage.getItem('eclipse-compass-offset'));
  return Number.isFinite(v) ? v : 0;
}

function saveOffset(deg) {
  try {
    localStorage.setItem('eclipse-compass-offset', String(deg));
  } catch {
    /* egal */
  }
}

function setSite(site) {
  state.site = { aboveTerrain: 0, height: 0, ...site };
  saveSite(state.site);
  computePrediction();
  renderSiteChip();
}

function renderSiteChip() {
  const s = state.site;
  $('site-name').textContent = s.name || `${s.lat.toFixed(3)}°, ${s.lon.toFixed(3)}°`;
}

/* ---------- Vorhersage ---------- */

function computePrediction() {
  setStatus('Finsternis wird berechnet …');
  const e = nextEclipse(state.site, Date.now() - 4 * 3600000, 400);
  state.eclipse = e;

  if (e.visible) {
    const pad = 12 * 60000;
    const from = (e.contacts.c1 || e.maxTime - 3600000) - pad;
    const to = (e.contacts.c4 || e.maxTime + 3600000) + pad;
    state.model = predictCurve(state.site, from, to, 300);
    state.path = predictCurve(state.site, e.contacts.c1 || from, e.contacts.c4 || to, 90);
    state.plan = timeline(e, state.site, 10);
    // Was die erhöhte Position an Sonne dazugewinnt: einmal mit, einmal ohne Kimmtiefe
    state.dipGainMs =
      state.site.aboveTerrain > 0 && e.sunset
        ? e.sunset - sunset({ ...state.site, aboveTerrain: 0 }, e.sunset - 3 * 3600000, 6)
        : 0;
    setStatus('Bereit');
  } else {
    state.model = [];
    state.path = [];
    state.plan = [];
    state.dipGainMs = 0;
    setStatus('Hier ist in den nächsten 400 Tagen keine Finsternis sichtbar', true);
  }
  renderPrediction();
  renderPhotoTable();
  renderLive();
}

function renderPrediction() {
  const e = state.eclipse;
  if (!e?.visible) {
    $('eclipse-info').innerHTML =
      '<span class="muted">In den nächsten 400 Tagen ist hier keine Sonnenfinsternis sichtbar.</span>';
    $('horizon-note').textContent = '';
    return;
  }
  const d = new Date(e.maxTime);
  const rows = [
    ['Datum', d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })],
    ['Es geht los', `${fmtTime(e.contacts.c1)} — der Mond berührt den Sonnenrand`],
    ['Maximum', `${fmtTime(e.maxTime)} — ${(e.max.obscuration * 100).toFixed(1)} % der Sonne bedeckt`],
  ];
  if (e.duration) {
    rows.push(['Totalität', `${(e.duration / 1000).toFixed(0)} s ab ${fmtTime(e.contacts.c2)}`]);
  }
  rows.push(['Sonnenuntergang', fmtTime(e.sunset)]);
  rows.push(['Rechnerisches Ende', `${fmtTime(e.contacts.c4)} — der Mond gibt die Sonne wieder frei`]);
  rows.push([
    'Sonne im Maximum',
    `${e.max.sunAlt.toFixed(1)}° über dem Horizont, Richtung ${compass(e.max.sunAz)} (${Math.round(e.max.sunAz)}°)`,
  ]);
  rows.push([
    'Restlicht im Maximum',
    `${(e.max.lightFraction * 100).toFixed(1)} % — es wird so hell wie eine knappe halbe Stunde später`,
  ]);

  let html = rows
    .map(([k, v]) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`)
    .join('');

  if (e.setsDuringEclipse) {
    const min = Math.round((e.contacts.c4 - e.sunset) / 60000);
    const atSet = modelAt(e.sunset, state.site);
    html +=
      `<div class="notice"><strong>Die Sonne geht mitten in der Finsternis unter.</strong> ` +
      `Um ${fmtClock(e.sunset)} verschwindet sie mit ${(atSet.obscuration * 100).toFixed(0)} % Bedeckung ` +
      `hinter dem Horizont, ${min} Minuten vor dem rechnerischen Ende. Ihr seht also nicht das Ende, ` +
      `sondern eine tief stehende Sichel, die untergeht. Dafür braucht ihr freie Sicht nach ` +
      `${compass(atSet.sunAz)} — kein Baum, kein Hügel, kein Haus.</div>`;
  }
  $('eclipse-info').innerHTML = html;

  const dip = horizonDip(state.site.aboveTerrain);
  const basis = 'Höhe und Richtung, wie sie am Himmel stehen. Eine Faust am ausgestreckten Arm sind rund 10 Grad.';
  $('horizon-note').textContent =
    dip > 0.02
      ? `${basis} Von ${Math.round(state.site.aboveTerrain)} m über dem Umland liegt der sichtbare Horizont ` +
        `${dip.toFixed(2)}° tiefer als die Waagerechte (blaue Linie) — das sind ` +
        `${Math.round(state.dipGainMs / 60000)} Minuten Sonne mehr als unten im Tal.`
      : basis;
}

/* ---------- Zeitpunkt der Anzeige ---------- */

function displayTime() {
  return state.scrubT ?? Date.now();
}

function scrubRange() {
  const e = state.eclipse;
  if (!e?.visible) return null;
  const pad = 10 * 60000;
  return [(e.contacts.c1 ?? e.maxTime) - pad, (e.contacts.c4 ?? e.maxTime) + pad];
}

function syncScrubber() {
  const r = scrubRange();
  if (!r) return;
  const t = displayTime();
  const frac = Math.min(1, Math.max(0, (t - r[0]) / (r[1] - r[0])));
  $('scrub').value = String(Math.round(frac * 1000));
  $('scrub-label').textContent =
    state.scrubT == null ? 'jetzt' : `Vorschau ${fmtClock(state.scrubT)}`;
  $('scrub-label').classList.toggle('accent', state.scrubT != null);
}

/* ---------- Live-Anzeige ---------- */

function renderLive() {
  const e = state.eclipse;
  if (!e?.visible || !state.site) return;
  const t = displayTime();
  const m = modelAt(t, state.site);

  state.sun.draw(m, {
    measuredLux: state.lastReading ? state.lastReading.value * state.scale : null,
  });
  state.horizon.draw({
    path: state.path,
    current: m,
    dip: horizonDip(state.site.aboveTerrain),
  });

  renderHint(m);
  renderStats(m);
  renderAim(m);
  renderPhotoLive(m);
  syncScrubber();
  drawChart();
}

function renderHint(m) {
  const e = state.eclipse;
  const now = Date.now();
  const el = $('now-hint');
  el.classList.remove('danger', 'good');

  if (state.scrubT != null) {
    el.innerHTML =
      `<strong>Vorschau ${fmtClock(state.scrubT)}</strong><br />` +
      `${(m.obscuration * 100).toFixed(1)} % bedeckt, Sonne ${m.sunAlt >= 0 ? `${m.sunAlt.toFixed(1)}° über dem Horizont` : 'schon untergegangen'}, Richtung ${compass(m.sunAz)}.`;
    return;
  }

  const c1 = e.contacts.c1;
  const end = e.endsVisible ?? e.contacts.c4;
  if (now < c1 - 30 * 60000) {
    el.innerHTML =
      `<strong>Noch ${fmtCountdown(c1 - now)} bis es losgeht.</strong><br />` +
      `Um ${fmtClock(c1)} berührt der Mond den Sonnenrand. Sucht euch bis dahin einen Platz mit freier ` +
      `Sicht nach ${compass(e.max.sunAz)} und legt das Handy für die Messung schon hin.`;
  } else if (now < c1) {
    el.classList.add('good');
    el.innerHTML =
      `<strong>Gleich geht es los: noch ${fmtCountdown(c1 - now)}.</strong><br />` +
      `Jetzt die Messung starten, damit ein Stück unbedeckte Kurve als Eichung dabei ist. ` +
      `Filter auf die Kamera, Brille griffbereit.`;
  } else if (now <= end) {
    el.classList.add('good');
    const trend = m.t < e.maxTime ? 'Es wird weiter dunkler' : 'Die Sonne kommt wieder heraus';
    el.innerHTML =
      `<strong>Läuft — ${(m.obscuration * 100).toFixed(1)} % bedeckt.</strong><br />` +
      `${trend}. Maximum um ${fmtClock(e.maxTime)} mit ${(e.max.obscuration * 100).toFixed(1)} %. ` +
      (e.setsDuringEclipse
        ? `Die Sonne geht schon um ${fmtClock(e.sunset)} unter, bis dahin sind es ${fmtCountdown(e.sunset - now)}.`
        : `Vorbei ist es um ${fmtClock(e.contacts.c4)}.`);
  } else {
    el.innerHTML =
      `<strong>Vorbei.</strong> Maximal ${(e.max.obscuration * 100).toFixed(1)} % bedeckt um ${fmtClock(e.maxTime)}. ` +
      `Mit dem Schieber kannst du den Verlauf noch einmal durchgehen, und unter „Messen“ liegt deine Kurve.`;
  }
}

function renderStats(m) {
  const e = state.eclipse;
  const now = Date.now();
  const cells = [
    ['bedeckt', `${(m.obscuration * 100).toFixed(1)} %`],
    ['Restlicht', `${(m.lightFraction * 100).toFixed(1)} %`],
    ['Sonnenhöhe', m.sunAlt >= 0 ? `${m.sunAlt.toFixed(1)}°` : 'unter'],
    ['Richtung', `${compass(m.sunAz)} ${Math.round(m.sunAz)}°`],
    ['Maximum', fmtClock(e.maxTime)],
    [
      e.setsDuringEclipse ? 'Sonne unter' : 'Ende',
      fmtClock(e.setsDuringEclipse ? e.sunset : e.contacts.c4),
    ],
  ];
  if (state.scrubT == null && now < e.maxTime) {
    cells[4] = ['bis Maximum', fmtCountdown(e.maxTime - now)];
  }
  $('live-stats').innerHTML = cells
    .map(([k, v]) => `<div><span class="k">${k}</span><span class="v">${v}</span></div>`)
    .join('');
}

/* ---------- Peilen ---------- */

function compassFrame() {
  const r = state.compass.reading;
  return r ? orientationFrame(r, screenAngle(), state.compassOffset) : null;
}

/** Azimut des Untergangspunkts — die Richtung, in der wirklich nichts stehen darf */
function sunsetAzimuth() {
  const e = state.eclipse;
  return e?.visible && e.sunset ? modelAt(e.sunset, state.site).sunAz : null;
}

/**
 * Der Verlauf für das Band im Sucher. Dieselben Modellpunkte wie die Rose, dazu die
 * Marken, an denen sich der Abend entscheidet: Maximum und Sonnenuntergang.
 */
function courseInfo() {
  const e = state.eclipse;
  if (!e?.visible || state.path.length < 2) return null;
  return {
    path: state.path,
    maxTime: e.maxTime,
    sunset: e.setsDuringEclipse ? e.sunset : null,
    endsVisible: e.endsVisible,
  };
}

function renderAim(m) {
  const frame = compassFrame();
  const sunsetAz = sunsetAzimuth();

  state.aim.draw({ model: m, frame, sunsetAz, course: courseInfo() });
  state.rose.draw({
    sunAz: m.sunAz,
    sunAlt: m.sunAlt,
    path: state.path,
    facing: frame ? frame.facing : null,
    sunsetAz,
  });

  const el = $('aim-hint');
  el.classList.remove('good', 'danger');
  const wo =
    m.sunAlt >= 0
      ? `Die Sonne steht ${compass(m.sunAz)} ${Math.round(m.sunAz)}°, ${m.sunAlt.toFixed(1)}° hoch — ${fistHint(m.sunAlt)}`
      : `Die Sonne ist ${compass(m.sunAz)} untergegangen`;

  if (!frame) {
    el.innerHTML =
      `<strong>${wo}.</strong><br />` +
      `Schalt den Kompass ein, dann dreht sich die Rose mit dir und der Sucher zeigt dir ` +
      `die Sonne dort, wo du das Handy hinhältst.`;
  } else {
    const d = deltaAngle(frame.facing, m.sunAz);
    const dAlt = m.sunAlt - frame.tilt;
    if (Math.abs(d) < 5 && !frame.flat) {
      el.classList.add('good');
      el.innerHTML =
        `<strong>Du schaust genau hin.</strong><br />${wo}. ` +
        (Math.abs(dAlt) < 5
          ? 'Das Handy zeigt auch in der Höhe richtig.'
          : `Jetzt noch ${Math.round(Math.abs(dAlt))}° ${dAlt > 0 ? 'höher' : 'tiefer'} zielen.`);
    } else {
      el.innerHTML =
        `<strong>Dreh dich ${Math.round(Math.abs(d))}° nach ${d > 0 ? 'rechts' : 'links'}.</strong><br />${wo}.` +
        (frame.flat ? ' Das Handy liegt flach, gepeilt wird gerade über die Oberkante.' : '');
    }
  }

  const cells = [
    ['Sonne', `${compass(m.sunAz)} ${Math.round(m.sunAz)}°`],
    ['Höhe', m.sunAlt >= 0 ? `${m.sunAlt.toFixed(1)}°` : 'unter'],
    ['du schaust', frame ? `${compass(frame.facing)} ${Math.round(frame.facing)}°` : '—'],
    [
      'Abweichung',
      frame
        ? (() => {
            const d = deltaAngle(frame.facing, m.sunAz);
            return Math.abs(d) < 2 ? 'passt' : `${Math.round(Math.abs(d))}° ${d > 0 ? 'rechts' : 'links'}`;
          })()
        : '—',
    ],
    ['Untergang', sunsetAz == null ? '—' : `${compass(sunsetAz)} ${Math.round(sunsetAz)}°`],
    ['bedeckt', `${(m.obscuration * 100).toFixed(1)} %`],
  ];
  $('aim-stats').innerHTML = cells
    .map(([k, v]) => `<div><span class="k">${k}</span><span class="v">${v}</span></div>`)
    .join('');
}

const SENSOR_TEXT = {
  aus: 'Kompass ist aus. Ohne ihn bleibt Nord oben — dann ist die Rose eine Karte, kein Instrument.',
  'nicht-verfuegbar': 'Dieses Gerät meldet keine Lagesensoren. Am Rechner ist das normal.',
  abgelehnt:
    'Ohne Zugriff auf die Bewegungssensoren geht es nicht. In Safari: aA in der Adresszeile → Website-Einstellungen → Bewegung und Ausrichtung erlauben.',
  wartet: 'Sensor angemeldet, warte auf die ersten Werte — das Handy einmal bewegen.',
};

function renderSensorNote() {
  const c = state.compass;
  let text = SENSOR_TEXT[c.state];
  if (c.state === 'laeuft') {
    if (c.source === 'ios') {
      text = 'Kompass des Geräts, rechtweisend Nord.';
      if (c.accuracy != null && c.accuracy > 0) text += ` Angegebene Genauigkeit ±${Math.round(c.accuracy)}°.`;
      if (c.accuracy != null && c.accuracy < 0) text += ' Der Sensor meldet sich als unkalibriert — Handy einmal als Acht durch die Luft führen.';
    } else if (c.source === 'absolut') {
      text =
        'Magnetkompass des Handys. Er zeigt magnetisch Nord, in Mitteleuropa rund fünf Grad östlich vom wahren Nord — der Feinabgleich unten holt das heraus.';
    } else {
      text =
        'Nur Lagesensor ohne Nordbezug: Drehungen stimmen, die Richtung nicht. Einmal auf die Sonne eichen, danach passt es.';
    }
  }
  $('rose-note').textContent = text || '';
  $('btn-compass').textContent =
    c.state === 'laeuft' || c.state === 'wartet' ? 'Kompass ausschalten' : 'Kompass einschalten';
  $('btn-compass').classList.toggle('active', c.state === 'laeuft');
  $('cal-note').textContent =
    state.compassOffset === 0
      ? 'Noch nicht geeicht.'
      : `Kompass um ${Math.abs(state.compassOffset).toFixed(1)}° nach ${state.compassOffset > 0 ? 'rechts' : 'links'} gedreht.`;
}

/**
 * Eigene Bildschleife für den Peilbereich: die Lagesensoren liefern rund sechzigmal
 * je Sekunde, der Sekundentakt der übrigen Anzeige wäre dafür viel zu träge. Läuft
 * nur, solange der Reiter oben ist.
 */
function aimLoop() {
  if (!state.aiming) return;
  renderAim(modelAt(displayTime(), state.site));
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(aimLoop);
}

function startAimLoop() {
  if (state.aiming) return;
  state.aiming = true;
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(aimLoop);
}

/* ---------- Foto ---------- */

function gear() {
  const sensor = SENSORS[$('ph-sensor').value] || SENSORS.apsc;
  return {
    focal: Number($('ph-focal').value) || 300,
    sensor,
    pixels: Number($('ph-pixels').value) || 6000,
    aperture: Number($('ph-aperture').value) || 8,
    iso: Number($('ph-iso').value) || 100,
    k: Number($('ph-haze').value) || 0.3,
  };
}

function renderGear() {
  const g = gear();
  const size = sunSize(g.focal, g.sensor, g.pixels);
  const limit = maxShutter(g.focal, g.sensor, g.pixels);
  const pctHeight = size.frameHeight * 100;

  let verdict;
  if (pctHeight < 6) verdict = 'winzig — nur als Punkt in der Landschaft brauchbar';
  else if (pctHeight < 15) verdict = 'klein, aber die Sichel ist erkennbar';
  else if (pctHeight < 45) verdict = 'gute Größe für ein Einzelbild';
  else if (pctHeight < 85) verdict = 'formatfüllend';
  else verdict = 'passt nicht mehr ganz ins Bild';

  $('ph-gear').innerHTML = [
    ['Sonne im Bild', `${Math.round(size.px)} px`],
    ['Anteil Bildhöhe', `${pctHeight.toFixed(0)} %`],
    ['Bildfeld', `${size.fovWidthDeg.toFixed(1)}° × ${size.fovHeightDeg.toFixed(1)}°`],
    ['ohne Nachführung bis', shutterLabel(limit)],
    ['Urteil', verdict],
  ]
    .map(([k, v]) => `<div><span class="k">${k}</span><span class="v">${v}</span></div>`)
    .join('');
}

function renderPhotoLive(m) {
  const g = gear();
  const limit = maxShutter(g.focal, g.sensor, g.pixels);
  const dip = horizonDip(state.site.aboveTerrain);
  const above = m.sunAlt + dip;
  const gone = state.eclipse?.sunset != null && m.t > state.eclipse.sunset;
  const a = shootingAdvice({
    sunAlt: m.sunAlt,
    obscuration: m.obscuration,
    aperture: g.aperture,
    iso: g.iso,
    k: g.k,
    maxSeconds: limit,
    gone,
  });

  const el = $('photo-live');
  el.classList.toggle('danger', a.mode === 'wechsel');

  const setting = `f/${g.aperture}, ISO ${g.iso}`;
  const when = state.scrubT == null ? 'Jetzt' : `Um ${fmtClock(state.scrubT)}`;

  let advice = '';
  if (a.mode === 'wechsel') {
    advice =
      `Ohne Filter bei f/${g.aperture}, ISO ${a.isoHint}${a.isoHint !== g.iso ? ' (runter damit)' : ''}: ` +
      `<strong>${a.exposure.label}</strong>. ` +
      `Mit Filter wären es ${a.filtered.label} — zu lang für ${g.focal} mm, ab ${shutterLabel(limit)} verwischt die Erddrehung. `;
  } else if (a.mode === 'beides') {
    advice =
      `Bei ${setting}: mit ND-5-Filter <strong>${a.filtered.label}</strong>, ` +
      `ohne Filter <strong>${a.bare.label}</strong>. `;
  } else if (a.mode === 'filter') {
    advice = `Startwert bei ${setting} mit ND-5-Filter: <strong>${a.exposure.label}</strong>. `;
    if (a.gefiltertZuLang) {
      advice += `Die Grenze ohne Nachführung liegt bei ${g.focal} mm schon bei ${shutterLabel(limit)}. `;
    }
  }

  el.innerHTML =
    `<strong>${when}: ${(m.obscuration * 100).toFixed(1)} % bedeckt, Sonne ` +
    `${gone || above < 0 ? 'unter dem Horizont' : `${above.toFixed(1)}° über dem Horizont`} im ${compass(m.sunAz)}.</strong><br />` +
    advice +
    `<br />${a.note}`;
}

function renderPhotoTable() {
  const g = gear();
  const rows = state.plan;
  if (!rows.length) {
    $('ph-table').innerHTML = '<span class="muted">Keine Finsternis in Sicht.</span>';
    return;
  }
  const limit = maxShutter(g.focal, g.sensor, g.pixels);
  const body = rows
    .map((r) => {
      const a = shootingAdvice({
        sunAlt: r.sunAlt,
        obscuration: r.obscuration,
        aperture: g.aperture,
        iso: g.iso,
        k: g.k,
        maxSeconds: limit,
        gone: r.belowHorizon,
      });
      const filt =
        a.mode === 'weg'
          ? '—'
          : a.mode === 'wechsel'
            ? 'ab'
            : a.mode === 'beides'
              ? 'ND 5 oder ab'
              : 'ND 5';
      const zeit =
        a.mode === 'weg'
          ? '—'
          : a.mode === 'beides'
            ? `${a.filtered.label} / ${a.bare.label}`
            : a.exposure.label +
            (a.mode === 'wechsel' && a.isoHint !== g.iso ? ` bei ISO ${a.isoHint}` : '');
      return (
        `<tr class="${r.label ? 'event' : ''}${r.belowHorizon ? ' below' : ''}">` +
        `<td>${fmtClock(r.t)}</td>` +
        `<td>${(r.obscuration * 100).toFixed(0)} %</td>` +
        `<td>${r.belowHorizon ? '—' : `${r.altAboveHorizon.toFixed(1)}°`}</td>` +
        `<td>${compass(r.sunAz)}</td>` +
        `<td>${filt}</td>` +
        `<td>${zeit}</td>` +
        `<td class="ev">${r.label || ''}</td>` +
        `</tr>`
      );
    })
    .join('');

  $('ph-table').innerHTML =
    `<table><thead><tr>` +
    `<th>Zeit</th><th>bed.</th><th>Höhe</th><th>Ri.</th><th>Filter</th><th>Zeit bei f/${g.aperture}, ISO ${g.iso}</th><th></th>` +
    `</tr></thead><tbody>${body}</tbody></table>`;
}

/* ---------- Messung ---------- */

async function startMeasuring() {
  if (state.measuring) return;
  try {
    const status = await state.meter.start($('camera-select').value);
    renderMeterStatus(status);
  } catch (err) {
    setStatus(`Kamera nicht verfügbar: ${err.message}`, true);
    return;
  }
  await state.ambient.start();
  await acquireWakeLock();

  if (!state.session) state.session = new Session(state.site);
  state.measuring = true;
  $('btn-measure').textContent = 'Messung stoppen';
  $('btn-measure').classList.add('active');
  setStatus('Messung läuft');

  state.timer = setInterval(tick, state.intervalSec * 1000);
  tick();
}

function stopMeasuring() {
  state.measuring = false;
  clearInterval(state.timer);
  state.timer = null;
  state.meter.stop();
  state.ambient.stop();
  state.sonifier.stop();
  $('btn-sound').classList.remove('active');
  releaseWakeLock();
  state.session?.save();
  $('btn-measure').textContent = 'Messung starten';
  $('btn-measure').classList.remove('active');
  setStatus(`Messung gestoppt — ${state.session?.samples.length || 0} Werte aufgezeichnet`);
}

function tick() {
  const reading = state.meter.read();
  if (!reading) return;
  const now = Date.now();
  state.lastReading = reading;
  state.session.add(now, reading);

  // Skalenfaktor laufend nachführen: die Messung ist relativ, das Modell absolut
  const lookup = (t) => modelAt(t, state.site).lux;
  state.scale = fitScale(state.session.samples.slice(-400), lookup);

  if (state.sonifier.running && state.eclipse?.visible) {
    state.sonifier.update(modelAt(now, state.site).lightFraction);
  }
  renderMeasureReadout();
  drawChart();
}

function renderMeterStatus(s) {
  const parts = [];
  parts.push(s.facing === 'user' ? 'Frontkamera' : 'Rückkamera');
  if (s.locked) parts.push('Belichtung gesperrt');
  else if (s.exposureTime) parts.push('Belichtung wird herausgerechnet');
  else parts.push('⚠ Belichtung weder sperrbar noch auslesbar');
  if (state.ambient.available) parts.push('Lichtsensor aktiv');
  $('meter-status').textContent = parts.join('  ·  ');
  $('meter-status').classList.toggle('warn', !s.locked && !s.exposureTime);
}

function renderMeasureReadout() {
  const r = state.lastReading;
  if (!r) return;
  const measuredLux = r.value * state.scale;
  const warn = [];
  if (r.saturated > 0.02) warn.push('überbelichtet — Kamera weg vom Hellen');
  if (r.dark > 0.5) warn.push('zu dunkel — Messgrenze erreicht');
  $('measure-readout').innerHTML =
    `<div><span class="k">gemessen</span><span class="v">${measuredLux < 10 ? measuredLux.toFixed(2) : Math.round(measuredLux)} lx</span></div>` +
    `<div><span class="k">Werte</span><span class="v">${state.session.samples.length}</span></div>` +
    (warn.length ? `<div class="warn full">${warn.join(' · ')}</div>` : '');
}

function drawChart() {
  if (!state.chart) return;
  state.chart.draw({
    model: state.model,
    measured: state.session ? state.session.smoothed(state.intervalSec * 4) : [],
    scale: state.scale,
    eclipse: state.eclipse,
    now: Date.now(),
    notes: state.session?.notes || [],
  });
}

function setStatus(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

/* ---------- Display wach halten ---------- */

async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => {
        state.wakeLock = null;
      });
    }
  } catch {
    /* nicht kritisch */
  }
}

function releaseWakeLock() {
  try {
    state.wakeLock?.release();
  } catch {
    /* egal */
  }
  state.wakeLock = null;
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && state.measuring && !state.wakeLock) {
    await acquireWakeLock();
  }
});

/* ---------- Export ---------- */

async function shareCard() {
  const blob = await renderShareCard({
    model: state.model,
    measured: state.session?.smoothed(20) || [],
    scale: state.scale,
    eclipse: state.eclipse,
    site: state.site,
  });
  const file = new File([blob], 'finsternis-lichtkurve.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: 'Meine Lichtkurve der Sonnenfinsternis' });
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'finsternis-lichtkurve.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/* ---------- Standort-Auswahl ---------- */

function openSiteSheet() {
  const s = state.site;
  $('in-lat').value = s.lat.toFixed(4);
  $('in-lon').value = s.lon.toFixed(4);
  $('in-height').value = Math.round(s.height || 0);
  $('in-above').value = Math.round(s.aboveTerrain || 0);
  $('site-presets').innerHTML =
    '<div class="results-head">Voreingestellt</div>' +
    PRESETS.map(
      (p, i) =>
        `<button class="result" data-preset="${i}">${p.name}<span class="muted"> · ${p.lat.toFixed(3)}°, ${p.lon.toFixed(3)}°, ${p.height} m</span></button>`
    ).join('');
  $('site-presets').querySelectorAll('[data-preset]').forEach((b) => {
    b.onclick = () => {
      setSite({ ...PRESETS[Number(b.dataset.preset)] });
      closeSiteSheet();
    };
  });
  $('site-sheet').hidden = false;
}

function closeSiteSheet() {
  $('site-sheet').hidden = true;
  $('site-results').innerHTML = '';
}

async function searchPlace() {
  const q = $('site-search').value.trim();
  if (!q) return;
  $('site-results').innerHTML = '<div class="results-head">wird gesucht …</div>';
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}`,
      { headers: { Accept: 'application/json' } }
    );
    const list = await res.json();
    if (!list.length) {
      $('site-results').innerHTML = '<div class="results-head">nichts gefunden</div>';
      return;
    }
    $('site-results').innerHTML =
      '<div class="results-head">Treffer</div>' +
      list
        .map(
          (r, i) =>
            `<button class="result" data-hit="${i}">${r.display_name.split(',').slice(0, 3).join(',')}</button>`
        )
        .join('');
    $('site-results').querySelectorAll('[data-hit]').forEach((b) => {
      b.onclick = () => {
        const r = list[Number(b.dataset.hit)];
        $('in-lat').value = Number(r.lat).toFixed(4);
        $('in-lon').value = Number(r.lon).toFixed(4);
        $('site-results').innerHTML = `<div class="results-head">übernommen: ${r.display_name.split(',')[0]}</div>`;
        $('site-search').dataset.picked = r.display_name.split(',')[0];
      };
    });
  } catch {
    $('site-results').innerHTML =
      '<div class="results-head">Suche geht nur online — Koordinaten von Hand eintragen</div>';
  }
}

/* ---------- Start ---------- */

function setupTabs() {
  const tabs = [...document.querySelectorAll('.tab')];
  const panels = [...document.querySelectorAll('.panel')];
  tabs.forEach((t) => {
    t.onclick = () => {
      tabs.forEach((x) => x.classList.toggle('active', x === t));
      panels.forEach((p) => p.classList.toggle('active', p.dataset.panel === t.dataset.tab));
      // Die Peilschleife nur laufen lassen, solange man sie auch sieht
      state.aiming = false;
      resizeAll();
      renderLive();
      if (t.dataset.tab === 'peilen' && state.compass.state === 'laeuft') startAimLoop();
    };
  });
}

function resizeAll() {
  state.chart.resize();
  state.sun.resize();
  state.horizon.resize();
  state.aim.resize();
  state.rose.resize();
}

async function init() {
  state.chart = new Chart($('chart'));
  state.sun = new SunView($('sunview'));
  state.horizon = new HorizonView($('horizonview'));
  state.aim = new AimView($('aimview'));
  state.rose = new RoseView($('roseview'));
  state.compassOffset = loadOffset();
  setupTabs();
  window.addEventListener('resize', () => {
    resizeAll();
    renderLive();
  });

  // Standort: gespeicherter zuerst, damit sofort etwas dasteht
  const saved = loadSavedSite();
  state.site = saved || { ...PRESETS[0] };
  renderSiteChip();
  computePrediction();

  // GPS nur beim allerersten Start automatisch übernehmen. Wer den Ort einmal
  // selbst gesetzt hat, will nicht, dass ihn die App vom Sofa aus wieder umstellt.
  locate().then((located) => {
    if (!located) {
      if (!saved) setStatus('Kein GPS — Standort oben rechts eintragen', true);
      return;
    }
    if (!saved) {
      setSite(located);
      return;
    }
    const km = 111 * Math.hypot(saved.lat - located.lat, (saved.lon - located.lon) * 0.67);
    if (km > 10) {
      setStatus(`Du stehst ${Math.round(km)} km vom eingestellten Ort entfernt — oben rechts umstellen`, true);
    }
  });

  // Angefangene Messung anbieten
  const old = Session.load();
  if (old && old.samples.length > 3) {
    const age = Date.now() - old.samples[old.samples.length - 1].t;
    if (age < 12 * 3600000) {
      $('resume-bar').hidden = false;
      $('resume-text').textContent = `${old.samples.length} Werte von ${fmtClock(old.startedAt)} gefunden`;
      $('btn-resume').onclick = () => {
        state.session = old;
        $('resume-bar').hidden = true;
        drawChart();
      };
      $('btn-discard').onclick = () => {
        Session.clear();
        $('resume-bar').hidden = true;
      };
    }
  }

  // Peilen
  $('btn-compass').onclick = async () => {
    if (state.compass.state === 'laeuft' || state.compass.state === 'wartet') {
      state.compass.stop();
      state.aiming = false;
    } else {
      const res = await state.compass.start();
      if (res === 'wartet') startAimLoop();
    }
    renderSensorNote();
    renderLive();
  };
  $('btn-cal-sun').onclick = () => {
    const frame = compassFrame();
    if (!frame) {
      $('cal-note').textContent = 'Dafür muss der Kompass laufen.';
      return;
    }
    const m = modelAt(Date.now(), state.site);
    if (m.sunAlt < -1) {
      $('cal-note').textContent = 'Die Sonne ist unter dem Horizont — daran lässt sich nichts eichen.';
      return;
    }
    state.compassOffset += deltaAngle(frame.aim.az, m.sunAz);
    state.compassOffset = ((state.compassOffset + 180) % 360) - 180;
    saveOffset(state.compassOffset);
    renderSensorNote();
    $('cal-note').textContent += ` Geeicht um ${fmtClock(Date.now())}.`;
  };
  $('btn-cal-reset').onclick = () => {
    state.compassOffset = 0;
    saveOffset(0);
    renderSensorNote();
  };
  renderSensorNote();

  $('btn-measure').onclick = () => (state.measuring ? stopMeasuring() : startMeasuring());
  $('btn-sound').onclick = () => {
    if (state.sonifier.running) {
      state.sonifier.stop();
      $('btn-sound').classList.remove('active');
      $('btn-sound').textContent = 'Ton an';
    } else {
      state.sonifier.start();
      $('btn-sound').classList.add('active');
      $('btn-sound').textContent = 'Ton aus';
    }
  };
  $('btn-night').onclick = () => {
    document.body.classList.toggle('night');
    state.chart.night = document.body.classList.contains('night');
    drawChart();
  };
  $('btn-mode').onclick = () => {
    state.chart.mode = state.chart.mode === 'light' ? 'obsc' : 'light';
    $('btn-mode').textContent = state.chart.mode === 'light' ? 'Helligkeit' : 'Bedeckung';
    drawChart();
  };
  $('btn-mark').onclick = () => {
    const text = prompt('Was ist passiert? (z. B. Wolke)') || 'Markierung';
    state.session?.mark(Date.now(), text);
    drawChart();
  };
  $('btn-csv').onclick = () =>
    state.session && download('finsternis-messung.csv', state.session.toCSV(), 'text/csv');
  $('btn-json').onclick = () =>
    state.session && download('finsternis-messung.json', state.session.toJSON(), 'application/json');
  $('btn-share').onclick = shareCard;

  $('interval').onchange = (ev) => {
    state.intervalSec = Number(ev.target.value);
    if (state.measuring) {
      clearInterval(state.timer);
      state.timer = setInterval(tick, state.intervalSec * 1000);
    }
  };
  $('camera-select').onchange = async () => {
    if (state.measuring) {
      const status = await state.meter.start($('camera-select').value);
      renderMeterStatus(status);
    }
  };

  // Zeitschieber
  $('scrub').oninput = (ev) => {
    const r = scrubRange();
    if (!r) return;
    state.scrubT = r[0] + (Number(ev.target.value) / 1000) * (r[1] - r[0]);
    renderLive();
  };
  $('btn-now').onclick = () => {
    state.scrubT = null;
    renderLive();
  };

  // Standort
  $('btn-site').onclick = openSiteSheet;
  $('btn-site-close').onclick = closeSiteSheet;
  $('btn-site-search').onclick = searchPlace;
  $('site-search').onkeydown = (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      searchPlace();
    }
  };
  $('btn-site-gps').onclick = async () => {
    $('btn-site-gps').textContent = 'GPS wird abgefragt …';
    const p = await locate();
    $('btn-site-gps').textContent = 'Aktuellen Standort per GPS holen';
    if (!p) {
      setStatus('GPS nicht verfügbar', true);
      return;
    }
    setSite(p);
    closeSiteSheet();
  };
  $('btn-site-save').onclick = () => {
    const lat = Number($('in-lat').value);
    const lon = Number($('in-lon').value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    setSite({
      lat,
      lon,
      height: Number($('in-height').value) || 0,
      aboveTerrain: Number($('in-above').value) || 0,
      name: $('site-search').dataset.picked || 'eigener Standort',
    });
    closeSiteSheet();
  };

  // Kameradaten
  for (const id of ['ph-focal', 'ph-sensor', 'ph-pixels', 'ph-aperture', 'ph-iso', 'ph-haze']) {
    $(id).oninput = () => {
      renderGear();
      renderPhotoTable();
      renderLive();
    };
  }
  renderGear();

  // Anzeige läuft mit, damit Countdown und Sonnenbild aktuell bleiben
  setInterval(renderLive, 1000);
  renderLive();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
