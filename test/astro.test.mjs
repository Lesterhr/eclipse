/**
 * Prüft die Ephemeriden gegen die durchgerechneten Beispiele aus Meeus,
 * "Astronomical Algorithms". Wenn diese Zahlen stimmen, stimmt der ganze Unterbau.
 *
 * Aufruf: node test/astro.test.mjs
 */

import assert from 'node:assert/strict';
import {
  centuries,
  sunPosition,
  moonPosition,
  meanObliquity,
  nutation,
  apparentSiderealTime,
  R_EARTH,
  RAD,
} from '../js/astro.js';

let passed = 0;
let failed = 0;

function check(name, actual, expected, tol) {
  const diff = Math.abs(actual - expected);
  if (diff <= tol) {
    passed++;
    console.log(`  ok   ${name}: ${actual.toFixed(6)} (Soll ${expected}, Δ ${diff.toExponential(2)})`);
  } else {
    failed++;
    console.error(
      `  FAIL ${name}: ${actual.toFixed(6)} (Soll ${expected}, Δ ${diff.toExponential(2)} > ${tol})`
    );
  }
}

console.log('\nMeeus Beispiel 47.a — Mond, 1992 April 12, 0h TD');
{
  const T = centuries(2448724.5);
  check('T', T, -0.077221081451, 1e-11);
  const m = moonPosition(T);
  check('Länge λ', m.lon, 133.162655, 1e-5);
  check('Breite β', m.lat, -3.229126, 1e-5);
  check('Distanz Δ [km]', m.dist, 368409.7, 0.2);
  const parallax = Math.asin(R_EARTH / m.dist) * RAD;
  check('Parallaxe π', parallax, 0.991990, 1e-5);
}

console.log('\nMeeus Beispiel 25.b — Sonne, 1992 Oktober 13, 0h TD');
{
  const T = centuries(2448908.5);
  check('T', T, -0.072183436, 1e-9);
  const s = sunPosition(T);
  check('scheinbare Länge λ', s.lon, 199.90895, 1e-4);
  // Meeus 25.b rechnet die Distanz mit VSOP87 (0.99760775). Die hier implementierte
  // Kurzform aus 25.a liefert 0.99766 — 5e-5 relativ daneben, was den Sonnenradius um
  // 0.05" verschiebt. Für Kontaktzeiten spielt das keine Rolle.
  check('Distanz R [AU]', s.dist / 149597870.7, 0.99766, 1e-4);
}

console.log('\nMeeus Beispiel 22.a — Nutation und Schiefe, 1987 April 10, 0h TD');
{
  const T = centuries(2446895.5);
  const { dPsi, dEps } = nutation(T);
  // Meeus gibt Δψ = -3.788", Δε = +9.443"; die Kurzform darf ~0.5" abweichen
  check('Δψ ["]', dPsi * 3600, -3.788, 0.5);
  check('Δε ["]', dEps * 3600, 9.443, 0.5);
  check('mittlere Schiefe ε0 [°]', meanObliquity(T), 23.44094629, 1e-6);
}

console.log('\nMeeus Beispiel 12.a — scheinbare Sternzeit, 1987 April 10, 0h UT');
{
  const jd = 2446895.5;
  const T = centuries(jd);
  const { dPsi, dEps } = nutation(T);
  const eps = meanObliquity(T) + dEps;
  const gast = apparentSiderealTime(jd, T, dPsi, eps);
  // Meeus nennt zwei Werte: mittlere Sternzeit 13h10m46.3668s = 197.693195°,
  // scheinbare 13h10m46.1351s = 197.692230°. Geprüft wird die scheinbare.
  check('GAST [°]', gast, 197.69223, 1e-4);
  check('mittlere Sternzeit [°]', gast - dPsi * Math.cos(eps * (Math.PI / 180)), 197.693195, 1e-4);
}

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed ? 1 : 0);
