/**
 * photo.js — Rechnungen für den, der danebensteht und fotografiert.
 *
 * Drei Fragen entscheiden über brauchbare Bilder, und zwei davon beantwortet keine
 * allgemeine Tabelle im Netz:
 *
 *   1. Wie groß wird die Sonne im Bild? Reine Optik, hängt nur an der Brennweite.
 *   2. Wie lange darf belichtet werden, bevor die Erddrehung die Sichel verschmiert?
 *   3. Welche Belichtung passt — und zwar für DIESEN Abend, an dem die Sonne im
 *      Maximum am Horizont steht. Die Luft schluckt dann über zehn Größenklassen.
 *      Wer mit der Standardtabelle für hoch stehende Sonne anfängt, hat schwarze Bilder.
 *
 * Wichtig und wenig bekannt: der Bedeckungsgrad ändert die Belichtung NICHT. Der Mond
 * nimmt Fläche weg, nicht Flächenhelligkeit. Die verbleibende Sichel ist genauso hell
 * wie die volle Sonne — belichtet wird auf die Sichel, nicht auf die Gesamtmenge Licht.
 */

/** Scheinbarer Sonnendurchmesser in Grad (Mittelwert, für die Bildgröße genau genug) */
export const SUN_DIAMETER_DEG = 0.533;

/** Größenordnung der Erddrehung am Himmel: 15 Bogensekunden pro Sekunde */
const SKY_RATE_ARCSEC = 15.041;

/** Ein Blendenschritt in Größenklassen */
const MAG_PER_STOP = 2.5 * Math.LOG10E * Math.LN2; // = 0.7526

export const SENSORS = {
  ff: { name: 'Vollformat', width: 36, height: 24 },
  apsc: { name: 'APS-C', width: 23.5, height: 15.6 },
  apscCanon: { name: 'APS-C Canon', width: 22.3, height: 14.9 },
  mft: { name: 'MFT', width: 17.3, height: 13 },
  type1: { name: '1 Zoll', width: 13.2, height: 8.8 },
};

/**
 * Bildgröße der Sonne.
 *
 * @param {number} focalMm Brennweite
 * @param {{width:number, height:number}} sensor
 * @param {number} pixelsWide Auflösung in der Breite
 */
export function sunSize(focalMm, sensor, pixelsWide) {
  const diameterMm = 2 * focalMm * Math.tan((SUN_DIAMETER_DEG / 2) * (Math.PI / 180));
  const px = (diameterMm / sensor.width) * pixelsWide;
  return {
    diameterMm,
    px,
    /** Anteil der Bildhöhe, den die Sonne einnimmt */
    frameHeight: diameterMm / sensor.height,
    fovWidthDeg: 2 * Math.atan(sensor.width / (2 * focalMm)) * (180 / Math.PI),
    fovHeightDeg: 2 * Math.atan(sensor.height / (2 * focalMm)) * (180 / Math.PI),
  };
}

/**
 * Längste Belichtung ohne Nachführung, bevor die Bewegung sichtbar wird.
 *
 * @param {number} focalMm
 * @param {{width:number}} sensor
 * @param {number} pixelsWide
 * @param {number} tolerancePx erlaubte Verschmierung in Pixeln
 */
export function maxShutter(focalMm, sensor, pixelsWide, tolerancePx = 2) {
  const arcsecPerPx = ((sensor.width / focalMm) * 206265) / pixelsWide;
  return (arcsecPerPx * tolerancePx) / SKY_RATE_ARCSEC;
}

/**
 * Luftmasse nach Kasten-Young. Am Horizont knapp 38 — deshalb ist die untergehende
 * Sonne so viel dunkler als die mittags.
 */
export function airmass(altDeg) {
  const h = Math.max(altDeg, -0.9);
  return 1 / (Math.sin(h * (Math.PI / 180)) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
}

/**
 * Extinktion der Sonnenscheibe in Blendenstufen gegenüber hoch stehender Sonne.
 *
 * @param {number} altDeg Sonnenhöhe
 * @param {number} k Extinktionskoeffizient in mag/Luftmasse (0.2 klar, 0.3 normal, 0.45 dunstig)
 */
export function extinctionStops(altDeg, k = 0.3) {
  return (k * airmass(altDeg)) / MAG_PER_STOP;
}

/**
 * Belichtungszeit für die Sonnenscheibe selbst.
 *
 * Verankert an einem Wert, den jeder Sonnenfotograf kennt: Baader-Folie ND 5.0,
 * f/8, ISO 100, hoch stehende Sonne, rund 1/125 s. Alles andere folgt aus der
 * Belichtungsgleichung — Blende quadratisch, ISO linear, Filterdichte und
 * Luftmasse in Blendenstufen.
 *
 * @param {object} p
 * @param {number} p.sunAlt Sonnenhöhe in Grad
 * @param {number} p.aperture Blendenzahl
 * @param {number} p.iso
 * @param {number} p.nd optische Dichte des Sonnenfilters (0 = kein Filter, 5 = ND 5.0)
 * @param {number} [p.k] Extinktionskoeffizient
 * @returns {{seconds:number, label:string, stops:number}}
 */
export function discExposure({ sunAlt, aperture, iso, nd, k = 0.3 }) {
  const ND_STOPS = 3.32193; // Blendenstufen je Dichte-Einheit
  // Referenz: unbedämpfte Sonnenscheibe, f/8, ISO 100, ohne Atmosphärenverlust
  const anchorStops = 5 * ND_STOPS + extinctionStops(60, 0.2);
  const tRef = (1 / 125) / Math.pow(2, anchorStops);

  const stops = nd * ND_STOPS + extinctionStops(sunAlt, k);
  const seconds =
    tRef * Math.pow(2, stops) * Math.pow(aperture / 8, 2) * (100 / iso);
  return { seconds, label: shutterLabel(seconds), stops };
}

/** Sekunden → Verschlusszeit, wie sie auf dem Rad steht */
export function shutterLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds >= 1) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  const denom = 1 / seconds;
  const rungs = [
    1, 1.3, 1.6, 2, 2.5, 3, 4, 5, 6, 8, 10, 13, 15, 20, 25, 30, 40, 50, 60, 80, 100, 125, 160, 200,
    250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000,
  ];
  let best = rungs[0];
  for (const r of rungs) {
    if (Math.abs(Math.log(r / denom)) < Math.abs(Math.log(best / denom))) best = r;
  }
  if (denom > 9000) return 'kürzer als 1/8000 s';
  return `1/${best} s`;
}

/**
 * Empfehlung für einen Zeitpunkt: welcher Filter, welche Zeit, worauf achten.
 *
 * Die Filterentscheidung hängt allein an der Sonnenhöhe. Solange die Sonne blendet,
 * gehört der Filter davor — für die Kamera und erst recht fürs Auge. Erst wenn sie
 * als tiefrote Scheibe im Dunst steht, wird sie schwach genug für den freien Blick.
 * Die Grenze ist eine Faustregel, kein Freibrief: entscheidend ist, was man sieht.
 */
/** Kürzeste Verschlusszeit, die eine übliche Kamera hergibt */
const FASTEST_SHUTTER = 1 / 8000;

/**
 * @param {object} p
 * @param {number} p.sunAlt Sonnenhöhe in Grad
 * @param {number} p.obscuration Bedeckungsgrad (nur zur Weitergabe)
 * @param {number} p.aperture Blendenzahl
 * @param {number} p.iso
 * @param {number} [p.k] Extinktionskoeffizient
 * @param {number} [p.maxSeconds] längste Zeit ohne sichtbare Bewegungsunschärfe
 * @param {boolean} [p.gone] Sonne steht unter dem sichtbaren Horizont
 */
export function shootingAdvice({
  sunAlt,
  obscuration,
  aperture,
  iso,
  k = 0.3,
  maxSeconds = Infinity,
  gone = false,
}) {
  const filtered = discExposure({ sunAlt, aperture, iso, nd: 5, k });
  const bare = discExposure({ sunAlt, aperture, iso, nd: 0, k });

  // Die Filterfrage entscheidet nicht die Uhrzeit, sondern die Physik: der Filter
  // muss so lange drauf, wie die Sonne ohne ihn jede Kamera überfordert. Erst wenn
  // die Luft so viel schluckt, dass eine echte Verschlusszeit übrig bleibt, wird der
  // Wechsel überhaupt möglich — und nötig wird er, sobald die gefilterte Zeit so lang
  // ist, dass die Erddrehung die Sichel verschmiert.
  //
  // Geprüft wird bei ISO 100, denn die ISO lässt sich jederzeit senken. Sonst hinge
  // die Filterempfehlung an einer Einstellung, die man in zwei Sekunden ändert.
  const bareMoeglich =
    sunAlt <= 3 && discExposure({ sunAlt, aperture, iso: 100, nd: 0, k }).seconds >= FASTEST_SHUTTER;
  const gefiltertZuLang = filtered.seconds > maxSeconds;
  const ohneZuKurz = bare.seconds < FASTEST_SHUTTER;

  // Wenn es ohne Filter zu kurz würde: die höchste ISO suchen, die noch eine Zeit
  // übrig lässt, die der Verschluss auch schafft.
  let isoHint = iso;
  if (ohneZuKurz) {
    isoHint = 100;
    for (const stufe of [100, 200, 400, 800, 1600, 3200, 6400]) {
      if (stufe > iso) break;
      if (discExposure({ sunAlt, aperture, iso: stufe, nd: 0, k }).seconds >= FASTEST_SHUTTER) {
        isoHint = stufe;
      }
    }
  }
  const bareUsable = ohneZuKurz
    ? discExposure({ sunAlt, aperture, iso: isoHint, nd: 0, k })
    : bare;

  let mode;
  let primary;
  let note;
  if (gone || sunAlt <= -0.5) {
    mode = 'weg';
    primary = null;
    note =
      'Sonne unter dem Horizont. Jetzt zählt die Dämmerung: Landschaft, Schattenfarben, der Himmel im Westen. Normal messen und belichten.';
  } else if (!bareMoeglich) {
    mode = 'filter';
    primary = 'filtered';
    note = gefiltertZuLang
      ? 'Filter bleibt drauf — ohne ihn wäre die Sonne für jede Kamera zu hell. Die Zeit ist aber schon zu lang für die Erddrehung: ISO hoch und Blende auf, bis sie wieder passt.'
      : 'Sonnenfilter vor dem Objektiv, ohne Ausnahme. Live-View benutzen, nie durch den optischen Sucher.';
  } else if (gefiltertZuLang) {
    mode = 'wechsel';
    primary = 'bare';
    note =
      'Jetzt kann der Filter runter. Entscheidend ist nicht die Uhr, sondern der Anblick: sobald die Sonne als rote Scheibe dasteht, in die man ohne Blenden schauen kann, ohne Filter weitermachen. Blendet sie noch, bleibt er drauf und die Zeit wird über ISO geholt.' +
      (ohneZuKurz
        ? ` Dafür die ISO auf ${isoHint} zurücknehmen, sonst wird es kürzer, als der Verschluss kann.`
        : '');
  } else {
    mode = 'beides';
    primary = 'filtered';
    note =
      'Beides geht gerade. Mit Filter bleibt die Sichel sauber gezeichnet, ohne Filter bekommst du die Farbe der tief stehenden Sonne. Wenn zwei Kameras da sind: je eine.';
  }

  return {
    mode,
    primary,
    /** die Empfehlung, auf die es gerade ankommt — ohne Filter ggf. bei gesenkter ISO */
    exposure: primary === 'filtered' ? filtered : primary === 'bare' ? bareUsable : null,
    note,
    filtered,
    bare,
    bareUsable,
    /** ISO, bei der die Zeit ohne Filter überhaupt einstellbar ist */
    isoHint,
    bareMoeglich,
    gefiltertZuLang,
    ohneZuKurz,
    airmass: airmass(sunAlt),
    extinctionMag: k * airmass(sunAlt),
    obscuration,
  };
}
