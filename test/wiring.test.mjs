/**
 * Prüft, was sich ohne Browser prüfen lässt:
 *
 *  - jede in app.js angesprochene Element-ID existiert wirklich in index.html
 *  - jede ID in index.html wird auch benutzt (tote Markup-Reste finden)
 *  - der Service Worker cacht genau die Dateien, die es gibt
 *  - Manifest und Icons passen zusammen
 *  - die reine Logik aus store.js und eclipse.js rechnet richtig
 *
 * Aufruf: node test/wiring.test.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

function ok(name) {
  passed++;
  console.log(`  ok   ${name}`);
}
function fail(name, detail) {
  failed++;
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}
function expect(cond, name, detail) {
  cond ? ok(name) : fail(name, detail);
}

const html = readFileSync(join(root, 'index.html'), 'utf8');
const appJs = readFileSync(join(root, 'js', 'app.js'), 'utf8');
const swJs = readFileSync(join(root, 'sw.js'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));

console.log('\nVerdrahtung HTML ↔ app.js');
{
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const usedIds = new Set([...appJs.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));

  const missing = [...usedIds].filter((id) => !htmlIds.has(id));
  expect(missing.length === 0, 'alle von app.js gesuchten IDs stehen im HTML', missing.join(', '));

  const unused = [...htmlIds].filter((id) => !usedIds.has(id));
  expect(unused.length === 0, 'keine unbenutzten IDs im HTML', unused.join(', '));
}

console.log('\nDateien und Verweise');
{
  const assets = [...swJs.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]).filter(Boolean);
  const fehlend = assets.filter((a) => !existsSync(join(root, a)));
  expect(fehlend.length === 0, 'jede vom Service Worker gecachte Datei existiert', fehlend.join(', '));

  // Umgekehrt: jedes Modul, das index.html oder ein Modul lädt, muss im Cache stehen
  const moduleFiles = [
    'js/app.js',
    'js/astro.js',
    'js/eclipse.js',
    'js/meter.js',
    'js/chart.js',
    'js/store.js',
    'js/sky.js',
    'js/photo.js',
  ];
  const nichtGecacht = moduleFiles.filter((f) => !assets.includes(f));
  expect(nichtGecacht.length === 0, 'alle Module stehen im Offline-Cache', nichtGecacht.join(', '));

  const icons = manifest.icons.map((i) => i.src.replace('./', ''));
  const fehlendeIcons = icons.filter((i) => !existsSync(join(root, i)));
  expect(fehlendeIcons.length === 0, 'Manifest-Icons liegen vor', fehlendeIcons.join(', '));

  expect(html.includes('manifest.webmanifest'), 'index.html verweist auf das Manifest');
  expect(existsSync(join(root, 'css', 'style.css')), 'Stylesheet existiert');
}

console.log('\nCSS-Klassen aus dem JavaScript');
{
  const css = readFileSync(join(root, 'css', 'style.css'), 'utf8');
  // Lookahead statt Konsumieren: bei ".status.error" muss auch "error" gefunden werden
  const cssClasses = new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)(?=[\s,{:.])/g)].map((m) => m[1]));
  const jsClasses = [
    ...appJs.matchAll(/classList\.(?:add|toggle|remove)\('([^']+)'/g),
  ].map((m) => m[1]);
  const fehlend = [...new Set(jsClasses)].filter((c) => !cssClasses.has(c));
  expect(fehlend.length === 0, 'jede per JS gesetzte Klasse ist im CSS definiert', fehlend.join(', '));
}

console.log('\nLogik: gleitender Median');
{
  const { Session } = await import('../js/store.js');
  // localStorage gibt es in Node nicht — Session fängt das ab, hier ein Minimalersatz
  globalThis.localStorage = {
    store: {},
    getItem(k) {
      return this.store[k] ?? null;
    },
    setItem(k, v) {
      this.store[k] = v;
    },
    removeItem(k) {
      delete this.store[k];
    },
  };

  const s = new Session({ lat: 51, lon: 7, height: 0 });
  const t0 = Date.UTC(2026, 7, 12, 17, 0, 0);
  // Konstante Reihe mit einem Ausreißer in der Mitte
  for (let i = 0; i < 21; i++) {
    s.add(t0 + i * 5000, { value: i === 10 ? 500 : 10, raw: 0.5, saturated: 0, dark: 0 });
  }
  const sm = s.smoothed(40);
  expect(sm.length === 21, 'Glättung liefert gleich viele Punkte');
  expect(Math.abs(sm[10].value - 10) < 1e-9, 'einzelner Ausreißer wird herausgefiltert', `bekam ${sm[10].value}`);

  const csv = s.toCSV();
  expect(csv.split('\n').filter((l) => !l.startsWith('#')).length === 22, 'CSV hat Kopfzeile plus alle Werte');
  expect(csv.includes('# Ort:'), 'CSV enthält den Standort im Kopf');
}

console.log('\nLogik: Skalenanpassung');
{
  const { fitScale } = await import('../js/eclipse.js');
  const model = (t) => 1000 + (t % 7); // beliebige, aber bekannte Modellwerte
  const samples = [];
  for (let i = 0; i < 50; i++) {
    const t = 1000000 + i * 5000;
    samples.push({ t, value: model(t) / 250 }); // Messung ist Modell / 250
  }
  const scale = fitScale(samples, model);
  expect(Math.abs(scale - 250) < 1, 'Skalenfaktor wird korrekt zurückgerechnet', `bekam ${scale.toFixed(3)}`);

  // Mit zwei groben Ausreißern muss der Median trotzdem stehen
  samples[7].value *= 40;
  samples[23].value /= 60;
  const robust = fitScale(samples, model);
  expect(Math.abs(robust - 250) < 1, 'Skalenfaktor bleibt trotz Ausreißern stabil', `bekam ${robust.toFixed(3)}`);

  expect(fitScale([], model) === 1, 'ohne Messwerte fällt der Faktor auf 1 zurück');
}

console.log('\nLogik: Vorhersagekurve');
{
  const { predictCurve, findEclipse } = await import('../js/eclipse.js');
  const site = { lat: 50.9375, lon: 6.9603, height: 53 };
  const e = findEclipse(site, Date.UTC(2026, 7, 12, 17, 46), 6);
  const curve = predictCurve(site, e.contacts.c1 - 600000, e.contacts.c4 + 600000, 120);

  expect(curve.length === 120, 'Kurve hat die angeforderte Punktzahl');
  expect(curve.every((p) => Number.isFinite(p.lux) && p.lux > 0), 'alle Helligkeiten sind endlich und positiv');
  expect(curve.every((p) => p.obscuration >= 0 && p.obscuration <= 1), 'Bedeckung bleibt zwischen 0 und 1');
  expect(curve[0].obscuration === 0 && curve[curve.length - 1].obscuration === 0, 'Kurve beginnt und endet unbedeckt');

  const maxPoint = curve.reduce((a, b) => (b.obscuration > a.obscuration ? b : a));
  expect(
    Math.abs(maxPoint.t - e.maxTime) < 120000,
    'Maximum der Kurve liegt beim berechneten Maximum',
    `${Math.round((maxPoint.t - e.maxTime) / 1000)} s daneben`
  );
}

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed ? 1 : 0);
