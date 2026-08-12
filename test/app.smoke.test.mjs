/**
 * Rauchprobe für app.js und die Zeichenmodule.
 *
 * Ohne Browser lässt sich das Wichtigste trotzdem prüfen: dass die App startet,
 * dass jeder Renderpfad durchläuft und dass keine Leinwand je eine unendliche
 * Koordinate bekommt. Dafür stehen hier Attrappen für DOM, Canvas und Speicher.
 * Sie sind absichtlich dumm — sie sollen nichts nachbilden, nur Aufrufe schlucken
 * und bei Unsinn laut werden.
 *
 * Aufruf: node test/app.smoke.test.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;
function expect(cond, name, detail) {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ---------- Attrappen ---------- */

const badCoords = [];
let drawCalls = 0;

function stubContext() {
  const gradient = { addColorStop: () => {} };
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return () => gradient;
        }
        if (prop === 'measureText') return () => ({ width: 40 });
        if (prop === 'canvas') return {};
        return (...args) => {
          drawCalls++;
          for (const a of args) {
            if (typeof a === 'number' && !Number.isFinite(a)) {
              badCoords.push(`${String(prop)}(${args.join(', ')})`);
            }
          }
        };
      },
      set: () => true,
    }
  );
}

class StubClassList {
  constructor() {
    this.set = new Set();
  }
  add(...c) {
    c.forEach((x) => this.set.add(x));
  }
  remove(...c) {
    c.forEach((x) => this.set.delete(x));
  }
  contains(c) {
    return this.set.has(c);
  }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : force;
    on ? this.set.add(c) : this.set.delete(c);
    return on;
  }
}

class StubElement {
  constructor(id = '', tag = 'div') {
    this.id = id;
    this.tagName = tag;
    this.textContent = '';
    this._html = '';
    this.value = '';
    this.hidden = false;
    this.dataset = {};
    this.classList = new StubClassList();
    this.style = {};
    this.children = [];
  }
  get innerHTML() {
    return this._html;
  }
  set innerHTML(v) {
    this._html = String(v);
    // Die App hängt Klicks an frisch erzeugte Knoten — die brauchen wir zurück
    this.children = [...String(v).matchAll(/data-(preset|hit)="(\d+)"/g)].map((m) => {
      const el = new StubElement('', 'button');
      el.dataset[m[1]] = m[2];
      return el;
    });
  }
  querySelectorAll() {
    return this.children;
  }
  getContext() {
    return stubContext();
  }
  getBoundingClientRect() {
    return { width: 380, height: 260 };
  }
  addEventListener() {}
}

const ids = [...readFileSync(join(root, 'index.html'), 'utf8').matchAll(/\bid="([^"]+)"/g)].map(
  (m) => m[1]
);
const elements = new Map(ids.map((id) => [id, new StubElement(id)]));

// Reiter und Bereiche kommen über Klassen, nicht über IDs
const tabs = ['live', 'peilen', 'messen', 'foto', 'hilfe'].map((name) => {
  const el = new StubElement('', 'button');
  el.dataset.tab = name;
  return el;
});
const panels = ['live', 'peilen', 'messen', 'foto', 'hilfe'].map((name) => {
  const el = new StubElement('', 'section');
  el.dataset.panel = name;
  return el;
});
tabs[0].classList.add('active');
panels[0].classList.add('active');

globalThis.document = {
  getElementById: (id) => elements.get(id) || null,
  querySelectorAll: (sel) => (sel === '.tab' ? tabs : sel === '.panel' ? panels : []),
  createElement: (tag) => new StubElement('', tag),
  addEventListener: () => {},
  body: new StubElement('', 'body'),
  visibilityState: 'visible',
};
// Lagesensor-Attrappe: die angemeldeten Hörer landen hier und lassen sich von Hand füttern
const sensorHoerer = [];
globalThis.window = {
  devicePixelRatio: 2,
  DeviceOrientationEvent: function DeviceOrientationEvent() {},
  addEventListener: (typ, fn) => {
    if (typ.startsWith('deviceorientation')) sensorHoerer.push(fn);
  },
  removeEventListener: () => {},
};
globalThis.navigator = {};
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
globalThis.prompt = () => 'Wolke';

// Timer nicht wirklich laufen lassen, sonst endet der Prozess nie
const timers = [];
globalThis.setInterval = (fn) => {
  timers.push(fn);
  return timers.length;
};
globalThis.clearInterval = () => {};

/* ---------- Start ---------- */

console.log('\nStart');
let startFehler = null;
try {
  await import('../js/app.js');
  // Die Standortabfrage hängt an einem Promise — eine Runde Ereignisschleife abwarten
  await new Promise((r) => setTimeout(r, 0));
} catch (err) {
  startFehler = err;
}
expect(!startFehler, 'app.js startet ohne Fehler', startFehler && startFehler.stack);
expect(drawCalls > 100, 'es wird tatsächlich gezeichnet', `${drawCalls} Aufrufe`);

console.log('\nInhalte stehen');
{
  const hint = elements.get('now-hint').innerHTML;
  expect(hint.length > 40, 'der Hinweis oben ist gefüllt', hint.slice(0, 60));
  expect(elements.get('live-stats').innerHTML.includes('bedeckt'), 'die Kennzahlen stehen');
  expect(elements.get('eclipse-info').innerHTML.includes('Maximum'), 'der Ablauf steht');
  expect(
    elements.get('eclipse-info').innerHTML.includes('mitten in der Finsternis unter'),
    'der Sonnenuntergang mitten in der Finsternis wird gemeldet'
  );
  expect(elements.get('ph-gear').innerHTML.includes('px'), 'die Ausrüstungsrechnung steht');
  expect(elements.get('ph-table').innerHTML.includes('<table>'), 'die Fototabelle steht');
  expect(elements.get('photo-live').innerHTML.includes('bedeckt'), 'die Live-Empfehlung steht');
  expect(elements.get('site-name').textContent.length > 3, 'der Standort steht im Kopf');
  expect(elements.get('horizon-note').textContent.includes('Faust'), 'der Hinweis zum Horizont steht');
}

console.log('\nBedienung');
{
  const klick = (id) => elements.get(id).onclick?.();
  let fehler = null;
  try {
    // Reiter durchschalten
    tabs.forEach((t) => t.onclick());
    // Zeitschieber quer durch den Verlauf
    for (const v of [0, 137, 500, 900, 1000]) {
      elements.get('scrub').oninput({ target: { value: String(v) } });
    }
    klick('btn-now');
    // Ausrüstung ändern
    elements.get('ph-focal').value = '1200';
    elements.get('ph-focal').oninput();
    elements.get('ph-iso').value = '800';
    elements.get('ph-iso').oninput();
    elements.get('ph-sensor').value = 'ff';
    elements.get('ph-sensor').oninput();
    elements.get('ph-haze').value = '0.45';
    elements.get('ph-haze').oninput();
    // Anzeige, Notizen, Standort
    klick('btn-mode');
    klick('btn-night');
    klick('btn-mark');
    klick('btn-site');
    elements.get('in-lat').value = '47.5';
    elements.get('in-lon').value = '13.0';
    elements.get('in-above').value = '0';
    elements.get('in-height').value = '900';
    klick('btn-site-save');
    // Sekundentakt der Anzeige einmal von Hand auslösen
    timers.forEach((fn) => fn());
  } catch (err) {
    fehler = err;
  }
  expect(!fehler, 'Reiter, Schieber, Ausrüstung und Standort lassen sich bedienen', fehler && fehler.stack);
  expect(elements.get('ph-table').innerHTML.includes('ISO 800'), 'die Tabelle folgt den geänderten Kameradaten');
  expect(elements.get('site-name').textContent.includes('Standort'), 'der neue Standort steht im Kopf');
}

console.log('\nVoreinstellung Buchbergwarte');
{
  let fehler = null;
  try {
    elements.get('btn-site').onclick();
    const preset = elements.get('site-presets').querySelectorAll()[0];
    expect(!!preset, 'die Voreinstellung wird angeboten');
    preset.onclick();
  } catch (err) {
    fehler = err;
  }
  expect(!fehler, 'die Voreinstellung lässt sich übernehmen', fehler && fehler.stack);
  expect(
    elements.get('site-name').textContent.includes('Buchbergwarte'),
    'und steht danach im Kopf',
    elements.get('site-name').textContent
  );
  expect(
    elements.get('horizon-note').textContent.includes('Minuten Sonne mehr'),
    'die gewonnene Zeit durch die Kimmtiefe wird beziffert',
    elements.get('horizon-note').textContent
  );
}

console.log('\nPeilen');
{
  let fehler = null;
  try {
    await elements.get('btn-compass').onclick();
    expect(sensorHoerer.length > 0, 'der Kompass meldet sich beim Lagesensor an');
    // Handy hochkant nach Westen, dazu flach, gerollt und im Querformat
    const lagen = [
      { alpha: 90, beta: 90, gamma: 0 },
      { alpha: 0, beta: 0, gamma: 0 },
      { alpha: 213, beta: 118, gamma: -37 },
      { alpha: 44, beta: 95, gamma: 12 },
    ];
    for (const lage of lagen) {
      for (const drehung of [0, 90, 270]) {
        globalThis.window.orientation = drehung;
        sensorHoerer.forEach((fn) =>
          fn({ type: 'deviceorientationabsolute', absolute: true, ...lage })
        );
        timers.forEach((fn) => fn());
      }
    }
    globalThis.window.orientation = 0;
    // Eichen auf die Sonne, zurücksetzen, Kompass wieder aus
    elements.get('btn-cal-sun').onclick();
    elements.get('btn-cal-reset').onclick();
    await elements.get('btn-compass').onclick();
  } catch (err) {
    fehler = err;
  }
  expect(!fehler, 'der Peilbereich läuft durch', fehler && fehler.stack);
  expect(
    elements.get('aim-stats').innerHTML.includes('Untergang'),
    'die Peilzahlen stehen',
    elements.get('aim-stats').innerHTML.slice(0, 80)
  );
  expect(
    elements.get('aim-hint').innerHTML.length > 40,
    'der Peilhinweis ist gefüllt',
    elements.get('aim-hint').innerHTML
  );
  expect(
    elements.get('rose-note').textContent.length > 10,
    'der Zustand des Sensors steht dabei',
    elements.get('rose-note').textContent
  );
}

console.log('\nZeichnen');
expect(badCoords.length === 0, 'keine ungültige Koordinate auf der Leinwand', badCoords.slice(0, 3).join(' | '));

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed ? 1 : 0);
