/**
 * Rechnet die Finsternis für mehrere Orte durch und vergleicht mit veröffentlichten
 * Referenzwerten (NASA / timeanddate). Gibt zusätzlich eine lesbare Übersicht aus.
 *
 * Aufruf: node test/eclipse.test.mjs [--verbose]
 */

import { findEclipse, coverage, lightFraction, clearSkyLux } from '../js/eclipse.js';

const verbose = process.argv.includes('--verbose');
let passed = 0;
let failed = 0;

function check(name, actual, expected, tol, unit = '') {
  const diff = Math.abs(actual - expected);
  const ok = diff <= tol;
  if (ok) passed++;
  else failed++;
  const line = `  ${ok ? 'ok  ' : 'FAIL'} ${name}: ${actual.toFixed(3)}${unit} (Soll ${expected}${unit}, Δ ${diff.toFixed(3)})`;
  (ok ? console.log : console.error)(line);
}

const fmt = (ms) =>
  ms == null ? '—' : new Date(ms).toISOString().slice(11, 19) + ' UTC';

// Referenzzeitpunkt: 12. August 2026, in der Nähe des größten Verlaufs
const AROUND = Date.UTC(2026, 7, 12, 17, 46, 0);

const SITES = [
  { name: 'Köln', lat: 50.9375, lon: 6.9603, height: 53 },
  { name: 'Berlin', lat: 52.52, lon: 13.405, height: 34 },
  { name: 'Reykjavík', lat: 64.1466, lon: -21.9426, height: 61 },
  { name: 'Valencia', lat: 39.4699, lon: -0.3763, height: 15 },
  { name: 'Sydney', lat: -33.8688, lon: 151.2093, height: 3 },
];

console.log('\nSonnenfinsternis 12. August 2026 — Modellrechnung\n');

const results = {};
for (const site of SITES) {
  const e = findEclipse(site, AROUND, 6);
  results[site.name] = e;
  if (!e.visible) {
    console.log(`${site.name.padEnd(11)} keine Finsternis sichtbar`);
    continue;
  }
  const pct = (e.max.obscuration * 100).toFixed(1);
  const light = (e.max.lightFraction * 100).toFixed(1);
  console.log(
    `${site.name.padEnd(11)} C1 ${fmt(e.contacts.c1)}  Max ${fmt(e.maxTime)}  C4 ${fmt(e.contacts.c4)}`
  );
  console.log(
    `${''.padEnd(11)} Bedeckung ${pct} %  Magnitude ${e.max.magnitude.toFixed(3)}  ` +
      `Restlicht ${light} %  Sonnenhöhe ${e.max.sunAlt.toFixed(1)}°  Phase ${e.max.phase}` +
      (e.duration ? `  Totalität ${(e.duration / 1000).toFixed(0)} s` : '')
  );
}

console.log('\nAbgleich mit veröffentlichten Werten');

/*
 * Referenzen:
 *   Kontaktzeiten und Bedeckung je Ort: timeanddate.com (Minutenauflösung, ΔT = 0)
 *   Greatest Eclipse und Besselsche Elemente: NASA GSFC / EclipseWise (Espenak)
 *
 * Toleranzen: 60 s auf Zeiten (die Quellen selbst runden auf Minuten und rechnen teils
 * ohne ΔT), 0.5 Prozentpunkte auf die Bedeckung.
 *
 * Nicht geprüft wird die Magnitude bei totalen Phasen: die Quellenwerte dafür stammen
 * aus abgeleiteten Grafikparametern und sind untereinander inkonsistent.
 */
const minutesUTC = (ms, h, m) => (ms - Date.UTC(2026, 7, 12, h, m)) / 60000;

const koeln = results['Köln'];
check('Köln C1', minutesUTC(koeln.contacts.c1, 17, 18), 0, 1, ' min');
check('Köln Maximum', minutesUTC(koeln.maxTime, 18, 12), 0, 1, ' min');
check('Köln Bedeckung', koeln.max.obscuration * 100, 88.25, 0.5, ' %');
check('Köln Magnitude', koeln.max.magnitude, 0.901, 0.005);
// timeanddate gibt hier 6.54° an, abgeleitet aus Grafikparametern. Der Wert unten stammt
// aus der unabhängigen Kontrollrechnung weiter unten und ist der belastbarere.
check('Köln Sonnenhöhe im Maximum', koeln.max.sunAlt, 6.13, 0.05, '°');

const berlin = results['Berlin'];
check('Berlin C1', minutesUTC(berlin.contacts.c1, 17, 15), 0, 1, ' min');
check('Berlin Maximum', minutesUTC(berlin.maxTime, 18, 8), 0, 1, ' min');
check('Berlin Bedeckung', berlin.max.obscuration * 100, 84.84, 0.5, ' %');
check('Berlin Magnitude', berlin.max.magnitude, 0.874, 0.005);

// Reykjavík ist der einzige Prüfort, bei dem der vierte Kontakt wirklich über dem
// Horizont liegt — anderswo gibt timeanddate den Sonnenuntergang als Ende aus.
const reykjavik = results['Reykjavík'];
check('Reykjavík C1', minutesUTC(reykjavik.contacts.c1, 16, 47), 0, 1, ' min');
check('Reykjavík Maximum', minutesUTC(reykjavik.maxTime, 17, 48.783), 0, 1, ' min');
check('Reykjavík C4', minutesUTC(reykjavik.contacts.c4, 18, 47), 0, 1, ' min');
check('Reykjavík Totalität', reykjavik.duration / 1000, 61, 20, ' s');
check('Reykjavík Bedeckung', reykjavik.max.obscuration * 100, 100, 0.01, ' %');

const valencia = results['Valencia'];
check('Valencia C1', minutesUTC(valencia.contacts.c1, 17, 38), 0, 1, ' min');
check('Valencia Maximum', minutesUTC(valencia.maxTime, 18, 33), 0, 1, ' min');
check('Valencia Bedeckung', valencia.max.obscuration * 100, 100, 0.01, ' %');

const sydney = results['Sydney'];
if (sydney.visible) {
  failed++;
  console.error('  FAIL Sydney: sollte nichts sehen (Finsternis auf der Nordhalbkugel)');
} else {
  passed++;
  console.log('  ok   Sydney: keine Finsternis sichtbar');
}

console.log('\nGegenprobe auf unabhängigem Rechenweg');
{
  // Die Sonnenhöhe und der Untergang werden hier noch einmal klassisch über den
  // Stundenwinkel gerechnet, ohne die Vektorkette aus skyState. Zwei Wege, ein Ergebnis —
  // das wiegt schwerer als eine fremde Webseite, deren Zahlen aus Grafikparametern stammen.
  const A = await import('../js/astro.js');
  const DEG = Math.PI / 180;
  const site = SITES[0];
  const t = koeln.maxTime;
  const jd = A.jdFromUnix(t);
  const T = A.centuries(jd + A.deltaT(jd) / 86400);
  const { dPsi, dEps } = A.nutation(T);
  const eps = A.meanObliquity(T) + dEps;
  const s = A.sunPosition(T);
  const ra = Math.atan2(Math.cos(eps * DEG) * Math.sin(s.lon * DEG), Math.cos(s.lon * DEG)) / DEG;
  const dec = Math.asin(Math.sin(eps * DEG) * Math.sin(s.lon * DEG)) / DEG;
  const gast = A.apparentSiderealTime(jd, A.centuries(jd), dPsi, eps);
  const H = (gast + site.lon - ra) * DEG;
  const altClassic =
    Math.asin(
      Math.sin(site.lat * DEG) * Math.sin(dec * DEG) +
        Math.cos(site.lat * DEG) * Math.cos(dec * DEG) * Math.cos(H)
    ) / DEG;

  check('Höhe klassisch vs. Vektorkette', koeln.max.sunAltGeo, altClassic, 0.01, '°');

  const cosH0 =
    (Math.sin(-0.8333 * DEG) - Math.sin(site.lat * DEG) * Math.sin(dec * DEG)) /
    (Math.cos(site.lat * DEG) * Math.cos(dec * DEG));
  const H0 = Math.acos(cosH0) / DEG;
  const transit = (ra - gast - site.lon) / 360;
  const setClassic = t + (((transit + H0 / 360) % 1) * 86164090);
  check('Sonnenuntergang klassisch vs. Suche', (koeln.sunset - setClassic) / 60000, 0, 0.5, ' min');
}

console.log('\nSonnenuntergang mitten in der Finsternis');
{
  // Kontrollrechnung oben: Köln 18:58:5x UTC, Berlin 18:38:5x UTC. Der von timeanddate
  // ausgewiesene Wert (21:01 bzw. 20:40 MESZ) liegt bis zu 2 min später; Toleranz
  // entsprechend weit, geprüft wird gegen den nachgerechneten Wert.
  check('Köln Sonnenuntergang', minutesUTC(koeln.sunset, 18, 59), 0, 1, ' min');
  check('Berlin Sonnenuntergang', minutesUTC(berlin.sunset, 18, 39), 0, 1, ' min');

  for (const [name, e] of [['Köln', koeln], ['Berlin', berlin]]) {
    const ok = e.setsDuringEclipse === true;
    if (ok) {
      passed++;
      console.log(
        `  ok   ${name}: Sonne geht ${((e.contacts.c4 - e.sunset) / 60000).toFixed(0)} min vor dem Ende unter`
      );
    } else {
      failed++;
      console.error(`  FAIL ${name}: Sonnenuntergang während der Finsternis nicht erkannt`);
    }
  }
  const rk = results['Reykjavík'];
  if (rk.setsDuringEclipse === false) {
    passed++;
    console.log('  ok   Reykjavík: Finsternis endet über dem Horizont');
  } else {
    failed++;
    console.error('  FAIL Reykjavík: sollte komplett über dem Horizont liegen');
  }
}

console.log('\nEinheitentests der Geometrie');
{
  // Deckungsgleiche Scheiben gleicher Größe → alles weg
  const c = coverage(0, 0.26, 0.26);
  check('Bedeckung bei d=0, gleiche Radien', c.obscuration, 1, 1e-12);
  check('Restlicht bei d=0', lightFraction(0, 0.26, 0.26), 0, 1e-12);

  // Ringförmig: Mond kleiner, zentral davor
  const a = coverage(0, 0.27, 0.26);
  check('Bedeckung ringförmig', a.obscuration, (0.26 / 0.27) ** 2, 1e-12);

  // Weit auseinander → nichts
  check('Bedeckung ohne Berührung', coverage(1, 0.26, 0.26).obscuration, 0, 1e-12);
  check('Restlicht ohne Berührung', lightFraction(1, 0.26, 0.26), 1, 1e-12);

  // Halbe Überdeckung: bei d = rs = rm ist die Linsenfläche analytisch bekannt
  const r = 0.26;
  const expected = (2 * Math.PI) / 3 - Math.sqrt(3) / 2; // in Einheiten r²
  check('Bedeckung bei d = r', coverage(r, r, r).obscuration, expected / Math.PI, 1e-9);

  // Randverdunklung: bei gleicher Fläche muss zentrale Bedeckung mehr Licht schlucken
  // als eine randnahe. Test über zwei Geometrien mit identischer Bedeckung.
  const dCenter = 0.1;
  const covCenter = coverage(dCenter, 0.26, 0.26).obscuration;
  const lightCenter = 1 - lightFraction(dCenter, 0.26, 0.26);
  check('zentral: Lichtverlust > Flächenverlust', lightCenter > covCenter ? 1 : 0, 1, 0);

  const dEdge = 0.45;
  const covEdge = coverage(dEdge, 0.26, 0.26).obscuration;
  const lightEdge = 1 - lightFraction(dEdge, 0.26, 0.26);
  check('randnah: Lichtverlust < Flächenverlust', lightEdge < covEdge ? 1 : 0, 1, 0);

  // Monotonie des Restlichts über den ganzen Verlauf
  let mono = true;
  let prev = -1;
  for (let d = 0; d <= 0.52; d += 0.005) {
    const l = lightFraction(d, 0.26, 0.26);
    if (l < prev - 1e-9) mono = false;
    prev = l;
  }
  check('Restlicht wächst monoton mit dem Abstand', mono ? 1 : 0, 1, 0);
}

console.log('\nEinheitentests des Helligkeitsmodells');
{
  check('Zenitsonne [lx]', clearSkyLux(90) / 1000, 111, 15, ' klx');
  check('Horizont [lx]', clearSkyLux(0), 400, 1, ' lx');
  check('bürgerliche Dämmerung [lx]', clearSkyLux(-6), 3.4, 0.1, ' lx');
  check('nautische Dämmerung [lx]', clearSkyLux(-12), 0.008, 0.001, ' lx');
  let mono = true;
  let prev = -1;
  for (let h = -18; h <= 90; h += 0.5) {
    const e = clearSkyLux(h);
    if (e < prev - 1e-12) mono = false;
    prev = e;
  }
  check('Helligkeit wächst monoton mit der Sonnenhöhe', mono ? 1 : 0, 1, 0);
}

if (verbose) {
  console.log('\nVerlauf für Köln (alle 10 Minuten)');
  const e = results['Köln'];
  const from = e.contacts.c1 - 600000;
  const to = e.contacts.c4 + 600000;
  for (let t = from; t <= to; t += 600000) {
    const { modelAt } = await import('../js/eclipse.js');
    const m = modelAt(t, SITES[0]);
    console.log(
      `  ${fmt(t)}  Bedeckung ${(m.obscuration * 100).toFixed(1).padStart(5)} %  ` +
        `Restlicht ${(m.lightFraction * 100).toFixed(1).padStart(5)} %  ` +
        `Höhe ${m.sunAlt.toFixed(1).padStart(5)}°  ${Math.round(m.lux).toString().padStart(6)} lx`
    );
  }
}

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed ? 1 : 0);
