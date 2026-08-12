/**
 * Prüft die Rechnungen, die am Abend niemand mehr nachschlagen kann:
 * Bildgröße der Sonne, Belichtung, Kimmtiefe, Ablaufplan und die Bildlage
 * des Mondes gegenüber der Sonne.
 *
 * Aufruf: node test/photo.test.mjs
 */

import {
  SENSORS,
  sunSize,
  maxShutter,
  airmass,
  extinctionStops,
  discExposure,
  shutterLabel,
  shootingAdvice,
} from '../js/photo.js';
import { horizonDip, timeline, findEclipse, modelAt } from '../js/eclipse.js';
import { skyState } from '../js/astro.js';
import { compass } from '../js/sky.js';

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
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('\nBildgröße der Sonne');
{
  const s = sunSize(300, SENSORS.apsc, 6000);
  // Faustformel unter Sonnenfotografen: Durchmesser in mm ≈ Brennweite / 108
  expect(near(s.diameterMm, 300 / 108, 0.03), 'Sonne bei 300 mm rund 2,8 mm groß', `${s.diameterMm.toFixed(3)} mm`);
  expect(near(s.px, 713, 5), 'auf 6000 px Breite gut 700 px', `${s.px.toFixed(0)} px`);

  const doppelt = sunSize(600, SENSORS.apsc, 6000);
  expect(near(doppelt.px / s.px, 2, 0.01), 'doppelte Brennweite, doppelte Bildgröße');

  const ff = sunSize(300, SENSORS.ff, 6000);
  expect(ff.px < s.px, 'am größeren Sensor nimmt die Sonne weniger Pixel ein');
  expect(near(ff.fovWidthDeg, 6.87, 0.05), 'Bildfeld 300 mm an Vollformat rund 6,9°', `${ff.fovWidthDeg.toFixed(2)}°`);
}

console.log('\nGrenze ohne Nachführung');
{
  const kurz = maxShutter(300, SENSORS.apsc, 6000);
  const lang = maxShutter(600, SENSORS.apsc, 6000);
  expect(kurz > 0 && kurz < 1, 'bei 300 mm unter einer Sekunde', `${kurz.toFixed(3)} s`);
  expect(near(lang * 2, kurz, 1e-9), 'doppelte Brennweite halbiert die erlaubte Zeit');
  expect(maxShutter(300, SENSORS.apsc, 12000) < kurz, 'mehr Pixel, strengere Grenze');
}

console.log('\nLuftmasse und Extinktion');
{
  expect(near(airmass(90), 1, 0.001), 'im Zenit ist die Luftmasse 1', airmass(90).toFixed(4));
  expect(near(airmass(30), 2, 0.02), 'bei 30° rund 2', airmass(30).toFixed(3));
  expect(near(airmass(0), 37.9, 0.5), 'am Horizont knapp 38', airmass(0).toFixed(1));
  expect(
    extinctionStops(0) > extinctionStops(45) * 8,
    'am Horizont schluckt die Luft ein Vielfaches gegenüber 45°'
  );
}

console.log('\nBelichtung der Sonnenscheibe');
{
  const anker = discExposure({ sunAlt: 60, aperture: 8, iso: 100, nd: 5, k: 0.2 });
  expect(near(anker.seconds, 1 / 125, 1 / 125 * 0.06), 'Anker: ND 5, f/8, ISO 100, hohe Sonne ≈ 1/125 s', anker.label);

  const iso200 = discExposure({ sunAlt: 60, aperture: 8, iso: 200, nd: 5, k: 0.2 });
  expect(near(iso200.seconds * 2, anker.seconds, 1e-9), 'doppelte ISO halbiert die Zeit');

  const f11 = discExposure({ sunAlt: 60, aperture: 11.3, iso: 100, nd: 5, k: 0.2 });
  expect(near(f11.seconds / anker.seconds, 2, 0.02), 'eine Blende zu, doppelte Zeit', f11.label);

  // Der Prüfstein für diesen Abend: die untergehende Sonne ohne Filter.
  // Landschaftsfotografen belichten sie bei f/8, ISO 100 im Bereich 1/250 bis 1/1000 s.
  const untergang = discExposure({ sunAlt: 0, aperture: 8, iso: 100, nd: 0, k: 0.3 });
  expect(
    untergang.seconds > 1 / 1000 && untergang.seconds < 1 / 250,
    'Sonne am Horizont ohne Filter landet im Bereich echter Sonnenuntergangsbilder',
    untergang.label
  );

  const hoch = discExposure({ sunAlt: 40, aperture: 8, iso: 100, nd: 0, k: 0.3 });
  expect(hoch.seconds < 1 / 8000, 'hohe Sonne ohne Filter ist für jede Kamera zu hell', `${hoch.seconds}`);
  expect(shutterLabel(hoch.seconds) === 'kürzer als 1/8000 s', 'und wird als unerreichbar gemeldet');
}

console.log('\nVerschlusszeiten benennen');
{
  expect(shutterLabel(1 / 125) === '1/125 s', 'krumme Sekunden werden auf die Rasterwerte gerundet');
  expect(shutterLabel(1 / 130) === '1/125 s', 'dazwischen wird auf die nächste Raste gezogen');
  expect(shutterLabel(2.5) === '2.5 s', 'lange Zeiten in Sekunden');
  expect(shutterLabel(0) === '—', 'ohne sinnvollen Wert kommt ein Strich');
}

console.log('\nFilterempfehlung');
{
  // Die Empfehlung hängt nicht an einer Uhrzeit-Schwelle, sondern daran, ob die
  // Kamera die jeweilige Zeit überhaupt einstellen kann. Grenze: 300 mm an APS-C.
  const grenze = maxShutter(300, SENSORS.apsc, 6000);
  const rat = (sunAlt, iso = 200, gone = false) =>
    shootingAdvice({ sunAlt, obscuration: 0.5, aperture: 8, iso, k: 0.3, maxSeconds: grenze, gone });

  expect(rat(20).mode === 'filter', 'hohe Sonne: Filter drauf, ohne Diskussion');
  expect(rat(6).mode === 'filter', 'auch bei 6° bleibt der Filter drauf');
  expect(rat(0.3).mode === 'wechsel', 'dicht über dem Horizont darf der Filter runter', rat(0.3).mode);
  expect(rat(-2).mode === 'weg', 'unter dem Horizont: keine Sonne mehr zu belichten');
  expect(rat(0.3, 200, true).mode === 'weg', 'hinter dem sichtbaren Horizont zählt nur noch die Dämmerung');

  // Der Filter darf nie wegen einer hohen ISO-Einstellung fallen — nur wegen der Sonnenhöhe
  expect(rat(8, 6400).mode === 'filter', 'hohe ISO macht die Sonne nicht ungefährlich');

  // Bei hoher ISO wird die Zeit ohne Filter unmöglich kurz. Dann muss die Empfehlung
  // die ISO senken statt eine Zeit zu nennen, die keine Kamera einstellt.
  const hoch = rat(0.3, 3200);
  expect(hoch.ohneZuKurz, 'bei ISO 3200 wäre die Zeit ohne Filter zu kurz');
  expect(hoch.isoHint < 3200, 'die Empfehlung senkt die ISO', `ISO ${hoch.isoHint}`);
  expect(hoch.exposure.seconds >= 1 / 8000, 'und nennt eine Zeit, die der Verschluss schafft', hoch.exposure.label);

  const normal = rat(0.3, 100);
  expect(normal.isoHint === 100 && !normal.ohneZuKurz, 'bei ISO 100 bleibt alles, wie es ist');
}

console.log('\nKimmtiefe');
{
  expect(horizonDip(0) === 0, 'auf ebener Erde keine Kimmtiefe');
  expect(near(horizonDip(170), 0.382, 0.005), 'gut 170 m über dem Umland: rund 0,38°', horizonDip(170).toFixed(3));
  expect(horizonDip(680) > horizonDip(170) * 1.9, 'viermal so hoch, doppelte Kimmtiefe');
}

console.log('\nBildlage von Sonne und Mond');
{
  const site = { lat: 48.2142, lon: 15.9456, height: 488 };
  const e = findEclipse(site, Date.UTC(2026, 7, 12, 18, 0, 0), 6);
  expect(e.visible, 'Finsternis am 12.8.2026 am Buchberg sichtbar');

  const mid = modelAt(e.maxTime, site);
  expect(
    near(Math.hypot(mid.offsetX, mid.offsetY), mid.separation, 1e-9),
    'der Versatz in x und y ergibt genau den Winkelabstand'
  );

  const anfang = modelAt(e.contacts.c1, site);
  const ende = modelAt(e.contacts.c4, site);
  expect(
    Math.sign(anfang.offsetX) !== Math.sign(ende.offsetX),
    'der Mond zieht von der einen Seite auf die andere',
    `${anfang.offsetX.toFixed(3)} → ${ende.offsetX.toFixed(3)}`
  );
  expect(
    near(Math.hypot(anfang.offsetX, anfang.offsetY), anfang.sunRadius + anfang.moonRadius, 1e-4),
    'beim ersten Kontakt berühren sich die Scheiben genau'
  );

  // Gegenprobe zur Horizontrechnung: der Mond steht beim ersten Kontakt links oder rechts
  // der Sonne, aber nie weiter weg als die Summe der Radien
  const sky = skyState(e.contacts.c1, site);
  expect(near(sky.separation, Math.hypot(sky.offsetX, sky.offsetY), 1e-9), 'skyState liefert denselben Versatz');
}

console.log('\nAblaufplan');
{
  const site = { lat: 48.2142, lon: 15.9456, height: 488, aboveTerrain: 170 };
  const e = findEclipse(site, Date.UTC(2026, 7, 12, 18, 0, 0), 6);
  const plan = timeline(e, site, 10);

  expect(plan.length > 10, 'der Plan hat genug Zeilen', String(plan.length));
  const sortiert = plan.every((r, i) => i === 0 || r.t >= plan[i - 1].t);
  expect(sortiert, 'nach Zeit sortiert');

  const labels = plan.map((r) => r.label).filter(Boolean);
  expect(labels.includes('Erster Kontakt'), 'erster Kontakt steht drin');
  expect(labels.includes('Maximum'), 'Maximum steht drin');
  expect(labels.includes('Sonnenuntergang'), 'Sonnenuntergang steht drin');
  expect(labels.includes('Letzter Kontakt'), 'letzter Kontakt steht drin');

  expect(plan.some((r) => r.belowHorizon), 'an diesem Abend läuft die Finsternis unter den Horizont weiter');

  // Die Kimmtiefe muss den Untergang nach hinten schieben
  const ohne = findEclipse({ ...site, aboveTerrain: 0 }, Date.UTC(2026, 7, 12, 18, 0, 0), 6);
  expect(
    e.sunset > ohne.sunset,
    'erhöhter Standort verlängert den Sonnenuntergang',
    `${Math.round((e.sunset - ohne.sunset) / 1000)} s gewonnen`
  );
}

console.log('\nHimmelsrichtungen');
{
  expect(compass(0) === 'N' && compass(90) === 'O' && compass(180) === 'S' && compass(270) === 'W',
    'die vier Haupthimmelsrichtungen stimmen');
  expect(compass(293) === 'WNW', '293° ist Westnordwest', compass(293));
  expect(compass(359) === 'N', 'kurz vor 360 wieder Nord');
}

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed ? 1 : 0);
