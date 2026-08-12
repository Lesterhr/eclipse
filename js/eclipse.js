/**
 * eclipse.js — Bedeckungsgrad, Kontaktzeiten und das Helligkeitsmodell.
 *
 * Zwei Dinge, die hier bewusst getrennt sind:
 *   1. Geometrie: wie viel der Sonnenscheibe deckt der Mond ab (reine Flächenrechnung).
 *   2. Photometrie: wie viel Licht kommt noch an. Das ist NICHT dasselbe, weil die Sonne
 *      zur Mitte hin deutlich heller ist als am Rand (Randverdunklung). Bei 90 % bedeckter
 *      Fläche sind je nach Geometrie nur ~93 % des Lichts weg.
 */

import { skyState, jdFromUnix, centuries, deltaT, sunPosition, moonPosition } from './astro.js';

/** Koeffizienten der quadratischen Randverdunklung im visuellen Band (~550 nm) */
const LIMB_U1 = 0.47;
const LIMB_U2 = 0.23;

/**
 * Geometrische Bedeckung zweier Scheiben.
 * @param {number} d Winkelabstand der Mittelpunkte (Grad)
 * @param {number} rs Sonnenradius (Grad)
 * @param {number} rm Mondradius (Grad)
 * @returns {{obscuration:number, magnitude:number, phase:string}}
 */
export function coverage(d, rs, rm) {
  if (d >= rs + rm) {
    return { obscuration: 0, magnitude: 0, phase: 'none' };
  }
  if (d <= Math.abs(rm - rs)) {
    // Mond ganz vor der Sonne (total) oder Sonne ragt ringförmig heraus (annular)
    const obsc = rm >= rs ? 1 : (rm * rm) / (rs * rs);
    return {
      obscuration: obsc,
      magnitude: rm / rs,
      phase: rm >= rs ? 'total' : 'annular',
    };
  }
  const d2 = d * d;
  const a =
    rs * rs * Math.acos((d2 + rs * rs - rm * rm) / (2 * d * rs)) +
    rm * rm * Math.acos((d2 + rm * rm - rs * rs) / (2 * d * rm)) -
    0.5 * Math.sqrt((-d + rs + rm) * (d + rs - rm) * (d - rs + rm) * (d + rs + rm));
  return {
    obscuration: a / (Math.PI * rs * rs),
    magnitude: (rs + rm - d) / (2 * rs),
    phase: 'partial',
  };
}

/**
 * Anteil des noch sichtbaren Sonnenlichts, mit Randverdunklung.
 *
 * Integriert radial über die Sonnenscheibe. Für jeden Radius ρ ist der vom Mond verdeckte
 * Anteil des Rings analytisch bekannt (Kreis-Kreis-Schnittwinkel), damit bleibt eine
 * eindimensionale Integration — schnell genug für hunderte Kurvenpunkte pro Frame.
 *
 * @param {number} d Winkelabstand der Mittelpunkte (Grad)
 * @param {number} rs Sonnenradius (Grad)
 * @param {number} rm Mondradius (Grad)
 * @param {number} steps Stützstellen der Integration
 * @returns {number} verbleibender Lichtanteil zwischen 0 und 1
 */
export function lightFraction(d, rs, rm, steps = 400) {
  if (d >= rs + rm) return 1;
  if (d <= rm - rs) return 0;

  const intensity = (rho) => {
    const x = rho / rs;
    const mu = Math.sqrt(Math.max(0, 1 - x * x));
    return 1 - LIMB_U1 * (1 - mu) - LIMB_U2 * (1 - mu) * (1 - mu);
  };

  let blocked = 0;
  let total = 0;
  const dr = rs / steps;
  for (let i = 0; i < steps; i++) {
    const rho = (i + 0.5) * dr;
    const weight = intensity(rho) * rho * dr; // 2π kürzt sich gegen den Nenner weg
    total += weight;

    let covered;
    if (rho + d <= rm) {
      covered = 1; // Ring liegt komplett hinter dem Mond
    } else if (rho >= d + rm || d >= rho + rm) {
      covered = 0; // kein Schnitt
    } else {
      const cosPhi = (rho * rho + d * d - rm * rm) / (2 * rho * d);
      covered = Math.acos(Math.min(1, Math.max(-1, cosPhi))) / Math.PI;
    }
    blocked += weight * covered;
  }
  return 1 - blocked / total;
}

/**
 * Beleuchtungsstärke bei wolkenlosem Himmel ohne Finsternis, in Lux.
 *
 * Über dem Horizont: direkte Komponente mit Kasten-Young-Luftmasse plus Streulicht.
 * Darunter: stückweise log-lineare Dämmerung durch die bekannten Stützpunkte
 * (Horizont ~400 lx, bürgerliche Dämmerung 3.4 lx, nautische 0.008 lx, astronomische 0.0006 lx).
 *
 * Absolut ist das eine Näherung. Für die Kurvenform zählt der Verlauf, und die Skala wird
 * ohnehin an die Messung angepasst.
 */
export function clearSkyLux(sunAltDeg) {
  const h = sunAltDeg;
  if (h > 0) {
    const airmass = 1 / (Math.sin(h * (Math.PI / 180)) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
    const directNormal = 127500 * Math.exp(-0.21 * airmass);
    const direct = directNormal * Math.sin(h * (Math.PI / 180));
    const diffuse = 12000 * Math.pow(Math.sin(h * (Math.PI / 180)), 0.6);
    return direct + diffuse + 400;
  }
  const segments = [
    [0, -6, 400, 3.4],
    [-6, -12, 3.4, 0.008],
    [-12, -18, 0.008, 0.0006],
  ];
  for (const [hi, lo, eHi, eLo] of segments) {
    if (h <= hi && h > lo) {
      const f = (h - hi) / (lo - hi);
      return eHi * Math.pow(eLo / eHi, f);
    }
  }
  return h > 0 ? 400 : 0.0006;
}

/**
 * Restlicht, das auch bei totaler Bedeckung noch ankommt: Streulicht aus den Gebieten
 * außerhalb des Kernschattens plus Korona. Als Bruchteil der ungestörten Helligkeit.
 */
const AMBIENT_FLOOR = 0.005;

/**
 * Vollständiger Modellzustand für einen Zeitpunkt.
 * @param {number} unixMs
 * @param {{lat:number, lon:number, height?:number}} site
 */
export function modelAt(unixMs, site) {
  const sky = skyState(unixMs, site);
  const cov = coverage(sky.separation, sky.sun.radius, sky.moon.radius);
  const light = lightFraction(sky.separation, sky.sun.radius, sky.moon.radius);
  const clear = clearSkyLux(sky.sunAlt);
  return {
    t: unixMs,
    separation: sky.separation,
    sunRadius: sky.sun.radius,
    moonRadius: sky.moon.radius,
    sunAlt: sky.sunAlt,
    sunAltGeo: sky.sunAltGeo,
    sunAz: sky.sunAz,
    obscuration: cov.obscuration,
    magnitude: cov.magnitude,
    phase: cov.phase,
    lightFraction: light,
    clearLux: clear,
    lux: clear * (light * (1 - AMBIENT_FLOOR) + AMBIENT_FLOOR),
  };
}

/**
 * Sonnenuntergang nach einem Zeitpunkt.
 *
 * Nicht bloß Deko: an diesem Abend endet die Finsternis in Teilen Deutschlands erst,
 * nachdem die Sonne untergegangen ist. Wer das nicht weiß, wartet auf einen vierten
 * Kontakt, den er nie sieht — und wundert sich über den Knick in der Lichtkurve.
 *
 * Bezug ist die geometrische Höhe −0.833° (Sonnenoberrand am Horizont bei Standardrefraktion).
 *
 * @returns {number|null} Zeitpunkt in Unix-ms, oder null wenn die Sonne im Suchfenster nicht untergeht
 */
export function sunset(site, fromMs, withinHours = 18) {
  const alt = (t) => skyState(t, site).sunAltGeo + 0.833;
  const step = 300000;
  let prev = alt(fromMs);
  for (let t = fromMs + step; t <= fromMs + withinHours * 3600000; t += step) {
    const cur = alt(t);
    if (prev > 0 && cur <= 0) {
      let lo = t - step;
      let hi = t;
      for (let i = 0; i < 40 && hi - lo > 1000; i++) {
        const m = (lo + hi) / 2;
        if (alt(m) > 0) lo = m;
        else hi = m;
      }
      return (lo + hi) / 2;
    }
    prev = cur;
  }
  return null;
}

/** Nullstelle von f im Intervall [a,b] per Bisektion (f(a) und f(b) müssen verschiedene Vorzeichen haben) */
function bisect(f, a, b, tol = 20) {
  let fa = f(a);
  for (let i = 0; i < 60 && b - a > tol; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (fa * fm <= 0) {
      b = m;
    } else {
      a = m;
      fa = fm;
    }
  }
  return (a + b) / 2;
}

/**
 * Sucht die Finsternis rund um einen Zeitpunkt: Kontaktzeiten, Maximum, Verlauf.
 *
 * @param {{lat:number, lon:number, height?:number}} site
 * @param {number} aroundMs Zeitpunkt in der Nähe der Finsternis
 * @param {number} windowHours Suchfenster in Stunden (± um aroundMs)
 */
export function findEclipse(site, aroundMs, windowHours = 6) {
  const step = 60000; // 1 Minute grob rastern
  const from = aroundMs - windowHours * 3600000;
  const to = aroundMs + windowHours * 3600000;

  const sepMinusSum = (t) => {
    const s = skyState(t, site);
    return s.separation - (s.sun.radius + s.moon.radius);
  };
  const sepMinusDiff = (t) => {
    const s = skyState(t, site);
    return s.separation - Math.abs(s.moon.radius - s.sun.radius);
  };

  // Grobes Raster: Minimum des Abstands und Vorzeichenwechsel finden
  let best = null;
  const grid = [];
  for (let t = from; t <= to; t += step) {
    const s = skyState(t, site);
    const v = s.separation - (s.sun.radius + s.moon.radius);
    grid.push({ t, v });
    if (!best || v < best.v) best = { t, v };
  }
  if (!best || best.v > 0) {
    return { visible: false, site };
  }

  // Maximum verfeinern: goldener Schnitt auf dem Abstand
  const sepAt = (t) => skyState(t, site).separation;
  let lo = best.t - step;
  let hi = best.t + step;
  const phi = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 50 && hi - lo > 500; i++) {
    const c = hi - (hi - lo) * phi;
    const d = lo + (hi - lo) * phi;
    if (sepAt(c) < sepAt(d)) hi = d;
    else lo = c;
  }
  const maxT = (lo + hi) / 2;

  const contacts = {};
  // C1 / C4: äußere Berührung
  for (let i = 1; i < grid.length; i++) {
    if (grid[i - 1].v > 0 && grid[i].v <= 0) {
      contacts.c1 = bisect(sepMinusSum, grid[i - 1].t, grid[i].t);
    }
    if (grid[i - 1].v <= 0 && grid[i].v > 0) {
      contacts.c4 = bisect(sepMinusSum, grid[i - 1].t, grid[i].t);
    }
  }
  // C2 / C3: innere Berührung, nur bei totaler oder ringförmiger Phase
  const maxState = modelAt(maxT, site);
  if (maxState.phase === 'total' || maxState.phase === 'annular') {
    const inner = [];
    for (let t = contacts.c1 || from; t <= (contacts.c4 || to); t += 5000) {
      inner.push({ t, v: sepMinusDiff(t) });
    }
    for (let i = 1; i < inner.length; i++) {
      if (inner[i - 1].v > 0 && inner[i].v <= 0) {
        contacts.c2 = bisect(sepMinusDiff, inner[i - 1].t, inner[i].t, 2);
      }
      if (inner[i - 1].v <= 0 && inner[i].v > 0) {
        contacts.c3 = bisect(sepMinusDiff, inner[i - 1].t, inner[i].t, 2);
      }
    }
  }

  // Geht die Sonne mitten in der Finsternis unter? Suche ab dem ersten Kontakt.
  const setTime = sunset(site, (contacts.c1 || maxT) - 3600000, 20);
  const setsDuringEclipse =
    setTime != null && contacts.c4 != null && setTime > (contacts.c1 || 0) && setTime < contacts.c4;

  return {
    visible: true,
    site,
    contacts,
    maxTime: maxT,
    max: maxState,
    duration: contacts.c2 && contacts.c3 ? contacts.c3 - contacts.c2 : 0,
    sunset: setTime,
    setsDuringEclipse,
    /** Zeitpunkt, bis zu dem tatsächlich etwas zu sehen ist */
    endsVisible: setsDuringEclipse ? setTime : contacts.c4,
  };
}

/**
 * Sucht Neumonde ab einem Zeitpunkt. Eine Sonnenfinsternis kann nur bei Neumond
 * stattfinden, deshalb reicht es, dort nachzusehen statt blind die Zeitachse abzurastern.
 *
 * @param {number} fromMs
 * @param {number} days Suchzeitraum in Tagen
 * @returns {number[]} Zeitpunkte der Konjunktionen in Unix-ms
 */
export function newMoons(fromMs, days = 400) {
  const elong = (t) => {
    const T = centuries(jdFromUnix(t) + deltaT(jdFromUnix(t)) / 86400);
    let d = moonPosition(T).lon - sunPosition(T).lon;
    return ((d + 540) % 360) - 180; // auf −180..180 bringen
  };
  const out = [];
  const step = 6 * 3600000;
  let prev = elong(fromMs);
  for (let t = fromMs + step; t <= fromMs + days * 86400000; t += step) {
    const cur = elong(t);
    // Vorzeichenwechsel von − nach + ist die Konjunktion (der Sprung bei ±180 nicht)
    if (prev < 0 && cur >= 0 && cur - prev < 180) {
      let lo = t - step;
      let hi = t;
      for (let i = 0; i < 40 && hi - lo > 1000; i++) {
        const m = (lo + hi) / 2;
        if (elong(m) < 0) lo = m;
        else hi = m;
      }
      out.push((lo + hi) / 2);
    }
    prev = cur;
  }
  return out;
}

/**
 * Die nächste am Ort sichtbare Sonnenfinsternis.
 * @param {{lat:number, lon:number, height?:number}} site
 * @param {number} fromMs
 * @param {number} days Suchzeitraum
 */
export function nextEclipse(site, fromMs, days = 400) {
  // Eine laufende Finsternis soll nicht verpasst werden, deshalb etwas in die Vergangenheit greifen
  for (const nm of newMoons(fromMs - 6 * 3600000, days)) {
    const e = findEclipse(site, nm, 6);
    if (e.visible && (e.contacts.c4 || e.maxTime) > fromMs - 6 * 3600000) return e;
  }
  return { visible: false, site };
}

/**
 * Berechnet die Vorhersagekurve als Punktliste.
 * @param {{lat:number, lon:number, height?:number}} site
 * @param {number} fromMs
 * @param {number} toMs
 * @param {number} points Anzahl Stützstellen
 */
export function predictCurve(site, fromMs, toMs, points = 240) {
  const out = [];
  const dt = (toMs - fromMs) / (points - 1);
  for (let i = 0; i < points; i++) {
    out.push(modelAt(fromMs + i * dt, site));
  }
  return out;
}

/**
 * Skaliert die Modellkurve auf die Messung.
 *
 * Die Kamera liefert keine Lux, sondern eine willkürliche Einheit. Gesucht ist der Faktor A,
 * der die Messung in Lux überführt: Modell ≈ A · gemessen. Im Logarithmus ist das ein reiner
 * Versatz, und der Median davon ist robust gegen einzelne Ausreißer (Wolke, Hand vor der Linse).
 *
 * @param {Array<{t:number, value:number}>} samples
 * @param {(t:number)=>number} modelLux
 * @returns {number} Faktor, mit dem Messwerte multipliziert werden, oder 1 ohne brauchbare Daten
 */
export function fitScale(samples, modelLux) {
  const offsets = [];
  for (const s of samples) {
    const m = modelLux(s.t);
    if (s.value > 0 && m > 0) offsets.push(Math.log(m / s.value));
  }
  if (!offsets.length) return 1;
  offsets.sort((a, b) => a - b);
  const mid = Math.floor(offsets.length / 2);
  const median =
    offsets.length % 2 ? offsets[mid] : (offsets[mid - 1] + offsets[mid]) / 2;
  return Math.exp(median);
}
