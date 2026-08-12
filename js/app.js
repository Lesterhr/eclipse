/**
 * app.js — verdrahtet Messung, Rechnung und Anzeige.
 */

import { nextEclipse, findEclipse, predictCurve, modelAt, fitScale } from './eclipse.js';
import { LightMeter, AmbientSensor, Sonifier } from './meter.js';
import { Session, download } from './store.js';
import { Chart, renderShareCard } from './chart.js';

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

const state = {
  site: null,
  eclipse: null,
  model: [],
  session: null,
  scale: 1,
  measuring: false,
  intervalSec: 5,
  chart: null,
  meter: new LightMeter(),
  ambient: new AmbientSensor(),
  sonifier: new Sonifier(),
  wakeLock: null,
  lastReading: null,
  timer: null,
};

/* ---------- Standort ---------- */

async function locate() {
  setStatus('Standort wird bestimmt …');
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
          height: pos.coords.altitude || 0,
          accuracy: pos.coords.accuracy,
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

/* ---------- Vorhersage ---------- */

function computePrediction() {
  const now = Date.now();
  setStatus('Finsternis wird berechnet …');
  let e = nextEclipse(state.site, now - 4 * 3600000, 400);
  if (!e.visible) {
    e = { visible: false, site: state.site };
  }
  state.eclipse = e;

  if (e.visible) {
    const pad = 12 * 60000;
    const from = (e.contacts.c1 || e.maxTime - 3600000) - pad;
    const to = (e.contacts.c4 || e.maxTime + 3600000) + pad;
    state.model = predictCurve(state.site, from, to, 300);
  } else {
    state.model = [];
  }
  renderPrediction();
}

function renderPrediction() {
  const e = state.eclipse;
  const site = state.site;
  $('site-info').textContent = `${site.lat.toFixed(4)}° N   ${site.lon.toFixed(4)}° E   ${Math.round(site.height || 0)} m`;

  if (!e?.visible) {
    $('eclipse-info').innerHTML =
      '<span class="muted">In den nächsten 400 Tagen ist hier keine Sonnenfinsternis sichtbar.</span>';
    return;
  }
  const d = new Date(e.maxTime);
  const rows = [
    ['Datum', d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })],
    ['Beginn (C1)', fmtTime(e.contacts.c1)],
    ['Maximum', `${fmtTime(e.maxTime)}  ·  ${(e.max.obscuration * 100).toFixed(1)} % bedeckt`],
    ['Ende (C4)', fmtTime(e.contacts.c4)],
    ['Sonne steht dann', `${e.max.sunAlt.toFixed(1)}° über dem Horizont, Azimut ${Math.round(e.max.sunAz)}°`],
    ['Restlicht im Maximum', `${(e.max.lightFraction * 100).toFixed(1)} % — Helligkeit fällt auf etwa ${Math.round(e.max.lux)} lx`],
  ];
  if (e.duration) {
    rows.splice(3, 0, ['Totalität', `${(e.duration / 1000).toFixed(0)} s (C2 ${fmtTime(e.contacts.c2)})`]);
  }
  rows.push(['Sonnenuntergang', fmtTime(e.sunset)]);

  let html = rows
    .map(([k, v]) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`)
    .join('');

  if (e.setsDuringEclipse) {
    const min = Math.round((e.contacts.c4 - e.sunset) / 60000);
    html +=
      `<div class="notice">Die Sonne geht ${min} Minuten vor dem Ende der Finsternis unter. ` +
      `Der vierte Kontakt ist von hier aus nicht zu sehen — sorg für freie Sicht nach Westen, ` +
      `sonst ist vorher Schluss.</div>`;
  }
  $('eclipse-info').innerHTML = html;
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
  renderLive();
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

/* ---------- Anzeige ---------- */

function renderLive() {
  const now = Date.now();
  const e = state.eclipse;

  if (e?.visible) {
    const m = modelAt(now, state.site);
    const running = now >= (e.contacts.c1 || 0) && now <= (e.contacts.c4 || 0);

    if (now < e.contacts.c1) {
      $('big-label').textContent = 'bis zum ersten Kontakt';
      $('big-value').textContent = fmtCountdown(e.contacts.c1 - now);
    } else if (running) {
      $('big-label').textContent = 'Sonne bedeckt';
      $('big-value').textContent = `${(m.obscuration * 100).toFixed(1)} %`;
    } else {
      $('big-label').textContent = 'Finsternis vorbei — Maximum war';
      $('big-value').textContent = `${(e.max.obscuration * 100).toFixed(1)} %`;
    }

    $('sub-stats').innerHTML = [
      ['Restlicht', `${(m.lightFraction * 100).toFixed(1)} %`],
      ['erwartet', `${Math.round(m.lux)} lx`],
      ['Sonnenhöhe', `${m.sunAlt.toFixed(1)}°`],
      ['Maximum um', fmtClock(e.maxTime)],
    ]
      .map(([k, v]) => `<div><span class="k">${k}</span><span class="v">${v}</span></div>`)
      .join('');
  }

  const r = state.lastReading;
  if (r) {
    const measuredLux = r.value * state.scale;
    const warn = [];
    if (r.saturated > 0.02) warn.push('überbelichtet — Kamera weg vom Hellen');
    if (r.dark > 0.5) warn.push('zu dunkel — Messgrenze erreicht');
    $('measure-readout').innerHTML =
      `<div><span class="k">gemessen</span><span class="v">${measuredLux < 10 ? measuredLux.toFixed(2) : Math.round(measuredLux)} lx</span></div>` +
      `<div><span class="k">Werte</span><span class="v">${state.session.samples.length}</span></div>` +
      (warn.length ? `<div class="warn full">${warn.join(' · ')}</div>` : '');
  }

  drawChart();
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

/* ---------- Start ---------- */

async function init() {
  state.chart = new Chart($('chart'));
  window.addEventListener('resize', () => {
    state.chart.resize();
    drawChart();
  });

  // Standort: gespeicherter zuerst, damit sofort etwas dasteht
  const saved = loadSavedSite();
  if (saved) {
    state.site = saved;
    computePrediction();
  }
  const located = await locate();
  if (located) {
    state.site = located;
    saveSite(located);
    computePrediction();
    setStatus('Bereit');
  } else if (!saved) {
    state.site = { lat: 51.0, lon: 7.0, height: 100 };
    computePrediction();
    setStatus('Kein GPS — Standort bitte von Hand eintragen', true);
  } else {
    setStatus('Bereit (gespeicherter Standort)');
  }

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
        renderLive();
      };
      $('btn-discard').onclick = () => {
        Session.clear();
        $('resume-bar').hidden = true;
      };
    }
  }

  $('btn-measure').onclick = () => (state.measuring ? stopMeasuring() : startMeasuring());
  $('btn-sound').onclick = () => {
    if (state.sonifier.running) {
      state.sonifier.stop();
      $('btn-sound').classList.remove('active');
    } else {
      state.sonifier.start();
      $('btn-sound').classList.add('active');
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
  $('btn-manual-site').onclick = () => {
    const lat = Number(prompt('Breite (Nord positiv)', state.site.lat.toFixed(4)));
    const lon = Number(prompt('Länge (Ost positiv)', state.site.lon.toFixed(4)));
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      state.site = { lat, lon, height: state.site.height || 0 };
      saveSite(state.site);
      computePrediction();
    }
  };

  // Anzeige läuft auch ohne Messung mit, damit der Countdown stimmt
  setInterval(renderLive, 1000);
  renderLive();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
