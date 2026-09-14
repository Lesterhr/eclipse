/**
 * Prüft die Peilrechnung: Rotationsmatrix, Blickrichtung, Projektion in den Sucher.
 *
 * Alles ohne Browser, weil die Winkelrechnerei genau das Stück ist, das im Gelände
 * niemand mehr nachprüfen kann. Wenn der Kompass um 90 Grad danebenliegt, merkt man
 * das erst, wenn die Sonne woanders steht.
 *
 * Aufruf: node test/compass.test.mjs
 */

import {
  rotationMatrix,
  column,
  dot,
  fromAzAlt,
  toAzAlt,
  deltaAngle,
  orientationFrame,
  projectToScreen,
  fistHint,
  courseBand,
  spreadLabels,
} from '../js/compass.js';

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
function near(a, b, tol, name) {
  expect(Math.abs(a - b) <= tol, name, `${a} statt ${b}`);
}
/** Winkelvergleich über den Nullpunkt hinweg */
function nearAngle(a, b, tol, name) {
  expect(Math.abs(deltaAngle(a, b)) <= tol, name, `${a}° statt ${b}°`);
}

console.log('\nWinkelabstand');
{
  near(deltaAngle(10, 20), 10, 1e-9, 'nach rechts ist positiv');
  near(deltaAngle(350, 10), 20, 1e-9, 'über den Nordpunkt hinweg');
  near(deltaAngle(10, 350), -20, 1e-9, 'und zurück');
  near(Math.abs(deltaAngle(0, 180)), 180, 1e-9, 'gegenüber sind 180°');
}

console.log('\nRotationsmatrix');
{
  const R = rotationMatrix(0, 0, 0);
  // Ohne jede Drehung liegt das Handy flach, Oberkante nach Norden
  const oben = column(R, 1);
  nearAngle(toAzAlt(oben).az, 0, 1e-6, 'flach und alpha 0: Oberkante zeigt nach Norden');
  near(toAzAlt(column(R, 2)).alt, 90, 1e-6, 'der Bildschirm schaut nach oben');

  // alpha zählt gegen den Uhrzeigersinn, der Kompasskurs also andersherum
  for (const [alpha, kurs] of [[90, 270], [180, 180], [270, 90]]) {
    const top = column(rotationMatrix(alpha, 0, 0), 1);
    nearAngle(toAzAlt(top).az, kurs, 1e-6, `alpha ${alpha}° entspricht Kurs ${kurs}°`);
  }

  // Aufgestellt: beta 90 heißt Oberkante zum Zenit, Rückkamera waagerecht nach vorn
  const auf = rotationMatrix(0, 90, 0);
  near(toAzAlt(column(auf, 1)).alt, 90, 1e-6, 'beta 90°: die Oberkante zeigt zum Zenit');
  const kamera = column(auf, 2).map((v) => -v);
  near(toAzAlt(kamera).alt, 0, 1e-6, 'und die Rückkamera waagerecht');
  nearAngle(toAzAlt(kamera).az, 0, 1e-6, 'nach Norden');
}

console.log('\nBlickrichtung');
{
  // Handy hochkant, um 40° nach Osten gedreht: die Kamera muss dorthin zeigen
  const f = orientationFrame({ alpha: -40, beta: 90, gamma: 0 }, 0, 0);
  nearAngle(f.aim.az, 40, 1e-6, 'Kamera peilt nach Osten hin');
  near(f.aim.alt, 0, 1e-6, 'waagerecht gehalten');
  expect(!f.flat, 'aufgestellt gilt nicht als flach');
  nearAngle(f.facing, 40, 1e-6, 'die Blickrichtung ist die der Kamera');

  // Weiter nach hinten gekippt heißt höher gezielt: beta 90 ist die Waagerechte
  const hoch = orientationFrame({ alpha: 0, beta: 120, gamma: 0 }, 0, 0);
  near(hoch.aim.alt, 30, 1e-6, 'beta 120° peilt 30° über den Horizont');
  const tief = orientationFrame({ alpha: 0, beta: 60, gamma: 0 }, 0, 0);
  near(tief.aim.alt, -30, 1e-6, 'beta 60° entsprechend darunter');

  // Flach: dann zählt die Oberkante, nicht die zum Boden schauende Kamera
  const flach = orientationFrame({ alpha: 100, beta: 0, gamma: 0 }, 0, 0);
  expect(flach.flat, 'flach liegendes Handy wird erkannt');
  nearAngle(flach.facing, 260, 1e-6, 'gepeilt wird über die Oberkante');

  // Querformat: der Bildschirm dreht sich, die Peilung darf es nicht
  const quer = orientationFrame({ alpha: -40, beta: 90, gamma: 0 }, 90, 0);
  nearAngle(quer.aim.az, 40, 1e-6, 'im Querformat zeigt die Kamera unverändert');

  // Feinabgleich dreht alle Azimute mit
  const geeicht = orientationFrame({ alpha: -40, beta: 90, gamma: 0 }, 0, 6);
  nearAngle(geeicht.aim.az, 46, 1e-6, 'der Abgleich addiert sich auf das Azimut');
}

console.log('\nSucher');
{
  const frame = orientationFrame({ alpha: 0, beta: 90, gamma: 0 }, 0, 0); // Blick nach Norden
  const mitte = projectToScreen(fromAzAlt(0, 0), frame);
  expect(!mitte.behind, 'geradeaus liegt vor der Kamera');
  near(mitte.x, 0, 1e-9, 'und genau in der Bildmitte, waagerecht');
  near(mitte.y, 0, 1e-9, 'und senkrecht');

  const rechts = projectToScreen(fromAzAlt(20, 0), frame);
  expect(rechts.x > 0, 'weiter östlich landet rechts im Bild');
  near(rechts.x, Math.tan((20 * Math.PI) / 180), 1e-9, 'auf dem Tangens des Winkels');
  near(rechts.y, 0, 1e-9, 'ohne senkrechten Versatz');

  const oben = projectToScreen(fromAzAlt(0, 15), frame);
  expect(oben.y > 0, 'höher stehende Punkte landen oben');

  expect(projectToScreen(fromAzAlt(180, 0), frame).behind, 'hinter dem Rücken wird gemeldet');

}

console.log('\nBildachsen');
{
  // Rechts, oben und Blickrichtung müssen in jeder Lage ein sauberes Dreibein bleiben.
  // Wäre es linkshändig, stünde das Bild spiegelverkehrt — und der Pfeil schickte
  // einen im Gelände systematisch in die falsche Richtung.
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  for (const lage of [
    { alpha: 0, beta: 90, gamma: 0 },
    { alpha: 137, beta: 74, gamma: 23 },
    { alpha: 291, beta: 118, gamma: -46 },
    { alpha: 42, beta: 12, gamma: 88 },
  ]) {
    for (const winkel of [0, 90, 180, 270]) {
      const f = orientationFrame(lage, winkel, 0);
      const wo = `alpha ${lage.alpha}, Anzeige ${winkel}°`;
      near(Math.hypot(...f.right), 1, 1e-9, `Rechts ist ein Einheitsvektor (${wo})`);
      near(Math.hypot(...f.up), 1, 1e-9, `Oben ist ein Einheitsvektor (${wo})`);
      near(dot(f.right, f.up), 0, 1e-9, `Rechts und Oben stehen senkrecht (${wo})`);
      near(dot(f.right, f.fwd), 0, 1e-9, `Rechts und Blick stehen senkrecht (${wo})`);
      const c = cross(f.right, f.up);
      near(Math.hypot(c[0] + f.fwd[0], c[1] + f.fwd[1], c[2] + f.fwd[2]), 0, 1e-9,
        `das Dreibein ist rechtshändig, das Bild also nicht gespiegelt (${wo})`);
    }
  }
}

console.log('\nHöhe in Fäusten');
{
  expect(fistHint(-1).includes('unter'), 'unter dem Horizont');
  expect(fistHint(1).includes('Finger'), 'ganz tief in Fingerbreiten');
  expect(fistHint(9).includes('eine Faust'), 'knapp zehn Grad sind eine Faust');
  expect(fistHint(25).includes('2,5'), 'darüber wird gezählt');
}

console.log('\nVerlaufsband');
{
  const box = { x: 10, y: 100, w: 200, h: 40 };
  // Dreieck: leer, halb, voll bei 0.6, wieder leer — wie eine partielle Finsternis
  const path = [
    { t: 1000, obscuration: 0 },
    { t: 2000, obscuration: 0.3 },
    { t: 3000, obscuration: 0.6 },
    { t: 4000, obscuration: 0.3 },
    { t: 5000, obscuration: 0 },
  ];
  const b = courseBand(path, box, 3000);

  expect(courseBand([], box, 0) === null, 'ohne Punkte kein Band');
  expect(courseBand([path[0]], box, 0) === null, 'ein einzelner Punkt reicht nicht');

  near(b.points[0].x, 10, 1e-9, 'der erste Punkt sitzt am linken Rand');
  near(b.points[4].x, 210, 1e-9, 'der letzte am rechten');
  near(b.points[2].x, 110, 1e-9, 'die Mitte der Zeit liegt in der Mitte der Fläche');

  // Die Skala geht bis zum Maximum dieser Finsternis, nicht bis 100 %
  near(b.scale, 0.6, 1e-9, 'Skalenmaximum ist der Höchststand der Kurve');
  near(b.points[0].y, 140, 1e-9, 'unbedeckt liegt auf der Grundlinie');
  near(b.points[2].y, 100, 1e-9, 'das Maximum füllt das Band ganz aus');
  near(b.points[1].y, 120, 1e-9, 'die Hälfte davon auf halber Höhe');

  expect(b.now.inside, 'ein Zeitpunkt im Verlauf gilt als innen');
  near(b.now.x, 110, 1e-9, 'und steht an seiner Stelle');

  // Außerhalb: die Marke bleibt am Rand kleben, statt aus dem Bild zu laufen
  const vorher = courseBand(path, box, 0);
  expect(!vorher.now.inside, 'vor dem Beginn gilt der Zeitpunkt als außen');
  near(vorher.now.x, 10, 1e-9, 'und wird auf den linken Rand geklemmt');
  near(courseBand(path, box, 9999).now.x, 210, 1e-9, 'nach dem Ende auf den rechten');
  expect(courseBand(path, box, null).now === null, 'ohne Zeitpunkt keine Marke');

  // Eine ganz schwache Finsternis darf nicht auf volle Höhe hochgezogen werden
  const schwach = courseBand(
    [{ t: 0, obscuration: 0 }, { t: 10, obscuration: 0.01 }],
    box,
    10
  );
  near(schwach.scale, 0.05, 1e-9, 'unter 5 % bleibt die Skala stehen');
  expect(schwach.points[1].y > box.y + box.h * 0.5, 'die Kurve bleibt dann flach unten');
}

console.log('\nBeschriftungen auseinanderhalten');
{
  // Genau der Fall dieses Abends: Maximum und Sonnenuntergang liegen Minuten auseinander
  const eng = spreadLabels([{ x: 200 }, { x: 213 }], 30, 20, 380);
  expect(eng[1].labelX - eng[0].labelX >= 30, 'zu dichte Beschriftungen rücken auseinander');
  near(eng[0].labelX, 200, 1e-9, 'die linke bleibt an ihrem Strich');

  const weit = spreadLabels([{ x: 100 }, { x: 300 }], 30, 20, 380);
  near(weit[0].labelX, 100, 1e-9, 'genug Platz, dann rührt sich nichts');
  near(weit[1].labelX, 300, 1e-9, 'auch rechts nicht');

  const rand = spreadLabels([{ x: 370 }, { x: 375 }], 30, 20, 380);
  expect(rand[1].labelX <= 380, 'am rechten Rand bleibt die letzte im Rahmen');
  expect(rand[1].labelX - rand[0].labelX >= 30 - 1e-9, 'und der Abstand hält trotzdem');
  expect(rand[0].labelX >= 20, 'die zurückgeschobene bleibt links im Rahmen');

  // Reihenfolge darf nicht von der Eingabereihenfolge abhängen
  const verdreht = spreadLabels([{ x: 213, text: 'b' }, { x: 200, text: 'a' }], 30, 20, 380);
  expect(verdreht[0].text === 'a', 'sortiert wird nach der Lage, nicht nach der Eingabe');

  expect(spreadLabels([], 30, 20, 380).length === 0, 'nichts zu beschriften geht auch');
}

console.log('\nEinheitsvektoren');
{
  for (const [az, alt] of [[0, 0], [90, 30], [237, -12], [359, 88]]) {
    const v = fromAzAlt(az, alt);
    near(Math.hypot(...v), 1, 1e-12, `Länge 1 bei ${az}°/${alt}°`);
    const back = toAzAlt(v);
    nearAngle(back.az, az, 1e-9, `Azimut kommt zurück bei ${az}°`);
    near(back.alt, alt, 1e-9, `Höhe kommt zurück bei ${alt}°`);
  }
  near(dot(fromAzAlt(0, 0), fromAzAlt(90, 0)), 0, 1e-12, 'Nord und Ost stehen senkrecht');
}

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed ? 1 : 0);
