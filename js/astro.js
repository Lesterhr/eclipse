/**
 * astro.js — Sonnen- und Mondpositionen nach Jean Meeus, "Astronomical Algorithms" (2. Aufl.)
 *
 * Genauigkeit: Sonne ~0.01" (Kap. 25), Mond ~10" in Länge / ~4" in Breite (Kap. 47).
 * Das reicht, um Kontaktzeiten einer Finsternis auf wenige Sekunden genau zu treffen.
 *
 * Alle Funktionen sind rein (keine Zeitquelle, kein DOM) und laufen in Browser und Node.
 */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/** Erdradius (Äquator) in km, WGS84 */
export const R_EARTH = 6378.137;
/** Sonnenradius in km (IAU 2015 nominal) */
export const R_SUN = 695700;
/**
 * Mondradius in km. Für Finsternisse ist der Standard k = 0.2725076 (mittlerer Radius,
 * NASA/Espenak für partielle Phasen und Kontaktzeiten) → k * R_EARTH.
 */
export const R_MOON = 0.2725076 * R_EARTH;
/** Astronomische Einheit in km */
export const AU = 149597870.7;

const norm360 = (x) => ((x % 360) + 360) % 360;

/** Unix-Millisekunden → Julianisches Datum */
export function jdFromUnix(ms) {
  return ms / 86400000 + 2440587.5;
}

/** Julianisches Datum → Unix-Millisekunden */
export function unixFromJd(jd) {
  return (jd - 2440587.5) * 86400000;
}

/** Julianische Jahrhunderte seit J2000.0 */
export function centuries(jd) {
  return (jd - 2451545.0) / 36525;
}

/**
 * ΔT (TT − UT) in Sekunden. Näherung nach Espenak/Meeus für 2005–2050.
 * Ohne diese Korrektur wandern Kontaktzeiten um ~70 s.
 */
export function deltaT(jd) {
  const year = 2000 + (jd - 2451545.0) / 365.25;
  if (year >= 2005 && year < 2050) {
    const t = year - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t * t;
  }
  if (year >= 2050 && year < 2150) {
    const u = (year - 1820) / 100;
    return -20 + 32 * u * u - 0.5628 * (2150 - year);
  }
  const u = (year - 1820) / 100;
  return -20 + 32 * u * u;
}

/**
 * Nutation in Länge (Δψ) und Schiefe (Δε), beide in Grad.
 * Kurzform nach Meeus Kap. 22, Genauigkeit ~0.5".
 */
export function nutation(T) {
  const omega = (125.04452 - 1934.136261 * T) * DEG;
  const Ls = (280.4665 + 36000.7698 * T) * DEG;
  const Lm = (218.3165 + 481267.8813 * T) * DEG;
  const dPsi =
    (-17.2 * Math.sin(omega) -
      1.32 * Math.sin(2 * Ls) -
      0.23 * Math.sin(2 * Lm) +
      0.21 * Math.sin(2 * omega)) /
    3600;
  const dEps =
    (9.2 * Math.cos(omega) +
      0.57 * Math.cos(2 * Ls) +
      0.1 * Math.cos(2 * Lm) -
      0.09 * Math.cos(2 * omega)) /
    3600;
  return { dPsi, dEps };
}

/** Mittlere Schiefe der Ekliptik in Grad (Meeus 22.2) */
export function meanObliquity(T) {
  const U = T / 100;
  return (
    23.43929111 +
    (-4680.93 * U -
      1.55 * U ** 2 +
      1999.25 * U ** 3 -
      51.38 * U ** 4 -
      249.67 * U ** 5 -
      39.05 * U ** 6 +
      7.12 * U ** 7 +
      27.87 * U ** 8 +
      5.79 * U ** 9 +
      2.45 * U ** 10) /
      3600
  );
}

/** Scheinbare Sternzeit in Greenwich, in Grad (Meeus Kap. 12) */
export function apparentSiderealTime(jdUT, T, dPsi, eps) {
  const theta0 =
    280.46061837 +
    360.98564736629 * (jdUT - 2451545.0) +
    0.000387933 * T * T -
    (T * T * T) / 38710000;
  return norm360(theta0 + dPsi * Math.cos(eps * DEG));
}

/**
 * Geozentrische scheinbare Position der Sonne.
 * @returns {{lon:number, lat:number, dist:number}} Länge/Breite in Grad, Distanz in km
 */
export function sunPosition(T) {
  const L0 = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const M = norm360(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  const Mr = M * DEG;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mr) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * Mr) +
    0.000289 * Math.sin(3 * Mr);
  const trueLon = L0 + C;
  const nu = M + C;
  const R = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(nu * DEG));

  // Scheinbare Länge: Nutation + Aberration (Meeus 25.10)
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLon - 0.00569 - 0.00478 * Math.sin(omega * DEG);

  return { lon: norm360(lambda), lat: 0, dist: R * AU };
}

// Meeus Tabelle 47.A — Argumente (D, M, M', F) und Koeffizienten für Σl (1e-6 Grad) und Σr (1e-3 km)
const TERMS_LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968], [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733], [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0], [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824], [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403], [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751], [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958],
  [0, 0, 2, 2, -1110, 0], [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0], [2, -1, 0, -2, 596, 0],
  [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739],
  [2, 1, 0, -2, -399, 0], [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165], [1, 1, -1, 0, 299, 0],
  [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752],
];

// Meeus Tabelle 47.B — Argumente und Koeffizienten für Σb (1e-6 Grad)
const TERMS_B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211], [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794], [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107], [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
  [0, 0, 1, -3, 777], [4, 0, -2, 1, 671], [2, 0, 0, -3, 607],
  [2, 0, 2, -1, 596], [2, -1, 1, -1, 491], [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439], [2, 0, 2, 1, 422], [2, 0, -3, -1, 421],
  [2, 1, -1, 1, -366], [2, 1, 0, 1, -351], [4, 0, 0, 1, 331],
  [2, -1, 1, 1, 315], [2, -2, 0, -1, 302], [0, 0, 1, 3, -283],
  [2, 1, 1, -1, -229], [1, 1, 0, -1, 223], [1, 1, 0, 1, 223],
  [0, 1, -2, -1, -220], [2, 1, -1, -1, -220], [1, 0, 1, 1, -185],
  [2, -1, -2, -1, 181], [0, 1, 2, 1, -177], [4, 0, -2, -1, 176],
  [4, -1, -1, -1, 166], [1, 0, 1, -1, -164], [4, 0, 1, -1, 132],
  [1, 0, -1, -1, -119], [4, -1, 0, -1, 115], [2, -2, 0, 1, 107],
];

/**
 * Geozentrische Position des Mondes (Meeus Kap. 47).
 * @returns {{lon:number, lat:number, dist:number}} Länge/Breite in Grad, Distanz in km
 */
export function moonPosition(T) {
  const Lp = norm360(
    218.3164477 + 481267.88123421 * T - 0.0015786 * T ** 2 + T ** 3 / 538841 - T ** 4 / 65194000
  );
  const D = norm360(
    297.8501921 + 445267.1114034 * T - 0.0018819 * T ** 2 + T ** 3 / 545868 - T ** 4 / 113065000
  );
  const M = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T ** 2 + T ** 3 / 24490000);
  const Mp = norm360(
    134.9633964 + 477198.8675055 * T + 0.0087414 * T ** 2 + T ** 3 / 69699 - T ** 4 / 14712000
  );
  const F = norm360(
    93.272095 + 483202.0175233 * T - 0.0036539 * T ** 2 - T ** 3 / 3526000 + T ** 4 / 863310000
  );
  const A1 = norm360(119.75 + 131.849 * T);
  const A2 = norm360(53.09 + 479264.29 * T);
  const A3 = norm360(313.45 + 481266.484 * T);
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;

  let sumL = 0;
  let sumR = 0;
  let sumB = 0;

  for (const [d, m, mp, f, cl, cr] of TERMS_LR) {
    const arg = (d * D + m * M + mp * Mp + f * F) * DEG;
    // Terme mit M = ±1 skalieren mit E, mit M = ±2 mit E² (Meeus, Exzentrizität der Erdbahn)
    const ecc = m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E;
    sumL += cl * ecc * Math.sin(arg);
    sumR += cr * ecc * Math.cos(arg);
  }
  for (const [d, m, mp, f, cb] of TERMS_B) {
    const arg = (d * D + m * M + mp * Mp + f * F) * DEG;
    const ecc = m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E;
    sumB += cb * ecc * Math.sin(arg);
  }

  // Additive Terme durch Venus, Jupiter und die Abplattung der Erde
  sumL += 3958 * Math.sin(A1 * DEG) + 1962 * Math.sin((Lp - F) * DEG) + 318 * Math.sin(A2 * DEG);
  sumB +=
    -2235 * Math.sin(Lp * DEG) +
    382 * Math.sin(A3 * DEG) +
    175 * Math.sin((A1 - F) * DEG) +
    175 * Math.sin((A1 + F) * DEG) +
    127 * Math.sin((Lp - Mp) * DEG) -
    115 * Math.sin((Lp + Mp) * DEG);

  return {
    lon: norm360(Lp + sumL / 1e6),
    lat: sumB / 1e6,
    dist: 385000.56 + sumR / 1000,
  };
}

/**
 * Ekliptikale Kugelkoordinaten → äquatorialer kartesischer Vektor (km).
 * Bezugsebene: mittleres Äquinoktium des Datums, um ε gedreht.
 */
export function eclipticToEquatorialVector({ lon, lat, dist }, eps) {
  const l = lon * DEG;
  const b = lat * DEG;
  const e = eps * DEG;
  const cb = Math.cos(b);
  return {
    x: dist * cb * Math.cos(l),
    y: dist * (cb * Math.sin(l) * Math.cos(e) - Math.sin(b) * Math.sin(e)),
    z: dist * (cb * Math.sin(l) * Math.sin(e) + Math.sin(b) * Math.cos(e)),
  };
}

/**
 * Geozentrischer Ortsvektor des Beobachters (km, äquatorial, Äquinoktium des Datums).
 * Berücksichtigt die Abplattung der Erde (Meeus Kap. 11).
 * @param {number} lat geodätische Breite in Grad (Nord positiv)
 * @param {number} lonEast Länge in Grad (Ost positiv)
 * @param {number} heightM Höhe über dem Ellipsoid in Metern
 * @param {number} gast scheinbare Sternzeit Greenwich in Grad
 */
export function observerVector(lat, lonEast, heightM, gast) {
  const phi = lat * DEG;
  const u = Math.atan(0.99664719 * Math.tan(phi));
  const h = heightM / (R_EARTH * 1000);
  const rhoSin = 0.99664719 * Math.sin(u) + h * Math.sin(phi);
  const rhoCos = Math.cos(u) + h * Math.cos(phi);
  const lst = (gast + lonEast) * DEG;
  return {
    x: rhoCos * R_EARTH * Math.cos(lst),
    y: rhoCos * R_EARTH * Math.sin(lst),
    z: rhoSin * R_EARTH,
  };
}

/** Kartesischer Vektor → Rektaszension (Grad), Deklination (Grad), Distanz */
export function vectorToSpherical({ x, y, z }) {
  const dist = Math.hypot(x, y, z);
  return {
    ra: norm360(Math.atan2(y, x) * RAD),
    dec: Math.asin(z / dist) * RAD,
    dist,
  };
}

/**
 * Winkelabstand zweier Punkte am Himmel in Grad.
 * Nutzt die Vektorform (numerisch stabil auch bei kleinen Abständen).
 */
export function angularSeparation(a, b) {
  const c1 = Math.cos(a.dec * DEG);
  const c2 = Math.cos(b.dec * DEG);
  const v1 = [c1 * Math.cos(a.ra * DEG), c1 * Math.sin(a.ra * DEG), Math.sin(a.dec * DEG)];
  const v2 = [c2 * Math.cos(b.ra * DEG), c2 * Math.sin(b.ra * DEG), Math.sin(b.dec * DEG)];
  const cross = Math.hypot(
    v1[1] * v2[2] - v1[2] * v2[1],
    v1[2] * v2[0] - v1[0] * v2[2],
    v1[0] * v2[1] - v1[1] * v2[0]
  );
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  return Math.atan2(cross, dot) * RAD;
}

/** Äquatoriale Koordinaten → Horizont (Höhe/Azimut in Grad, Azimut von Nord über Ost) */
export function equatorialToHorizontal(ra, dec, lat, lonEast, gast) {
  const H = (gast + lonEast - ra) * DEG;
  const phi = lat * DEG;
  const d = dec * DEG;
  const alt = Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H));
  const az = Math.atan2(
    Math.sin(H),
    Math.cos(H) * Math.sin(phi) - Math.tan(d) * Math.cos(phi)
  );
  return { alt: alt * RAD, az: norm360(az * RAD + 180) };
}

/**
 * Refraktion in Grad für eine scheinbare Höhe (Bennett, Meeus 16.3).
 * Nur für die Anzeige der Sonnenhöhe relevant.
 */
export function refraction(altDeg) {
  if (altDeg < -1) return 0;
  const r = 1.02 / Math.tan((altDeg + 10.3 / (altDeg + 5.11)) * DEG) / 60;
  return r;
}

/**
 * Vollständiger topozentrischer Zustand von Sonne und Mond für einen Zeitpunkt und Ort.
 *
 * @param {number} unixMs Zeitpunkt (UT)
 * @param {{lat:number, lon:number, height?:number}} site Beobachterort, lon Ost-positiv
 */
export function skyState(unixMs, site) {
  const jdUT = jdFromUnix(unixMs);
  // Ephemeriden laufen in Terrestrischer Zeit, die Erdrotation in UT
  const jdTT = jdUT + deltaT(jdUT) / 86400;
  const T = centuries(jdTT);
  const { dPsi, dEps } = nutation(T);
  const eps = meanObliquity(T) + dEps;
  const gast = apparentSiderealTime(jdUT, centuries(jdUT), dPsi, eps);

  const sunEcl = sunPosition(T);
  const moonEcl = moonPosition(T);
  // Nutation auf die Mondlänge (bei der Sonne steckt sie schon in der scheinbaren Länge)
  moonEcl.lon += dPsi;

  const sunGeo = eclipticToEquatorialVector(sunEcl, eps);
  const moonGeo = eclipticToEquatorialVector(moonEcl, eps);
  const obs = observerVector(site.lat, site.lon, site.height || 0, gast);

  const sunTopo = vectorToSpherical({
    x: sunGeo.x - obs.x,
    y: sunGeo.y - obs.y,
    z: sunGeo.z - obs.z,
  });
  const moonTopo = vectorToSpherical({
    x: moonGeo.x - obs.x,
    y: moonGeo.y - obs.y,
    z: moonGeo.z - obs.z,
  });

  const sunRadius = Math.asin(R_SUN / sunTopo.dist) * RAD;
  const moonRadius = Math.asin(R_MOON / moonTopo.dist) * RAD;
  const sep = angularSeparation(sunTopo, moonTopo);
  const horiz = equatorialToHorizontal(sunTopo.ra, sunTopo.dec, site.lat, site.lon, gast);
  const moonHoriz = equatorialToHorizontal(moonTopo.ra, moonTopo.dec, site.lat, site.lon, gast);

  // Versatz des Mondes gegen die Sonne so, wie er am Himmel wirklich aussieht:
  // wer zur Sonne schaut, hat wachsenden Azimut rechts und wachsende Höhe oben.
  // Damit braucht es keinen Positions- oder parallaktischen Winkel, die Horizont-
  // koordinaten liefern die Bildlage direkt.
  const dAzRaw = ((moonHoriz.az - horiz.az + 540) % 360) - 180;
  let offsetX = dAzRaw * Math.cos(horiz.alt * DEG);
  let offsetY = moonHoriz.alt - horiz.alt;
  // Kleinwinkelnäherung gegen den exakten Abstand normieren
  const approx = Math.hypot(offsetX, offsetY);
  if (approx > 1e-9) {
    const k = sep / approx;
    offsetX *= k;
    offsetY *= k;
  }

  return {
    unixMs,
    sun: { ...sunTopo, radius: sunRadius },
    moon: { ...moonTopo, radius: moonRadius },
    separation: sep,
    sunAlt: horiz.alt + refraction(horiz.alt),
    /** geometrische Höhe ohne Refraktion — Bezug für die Auf- und Untergangsrechnung */
    sunAltGeo: horiz.alt,
    sunAz: horiz.az,
    moonAlt: moonHoriz.alt,
    moonAz: moonHoriz.az,
    /** Mondmitte relativ zur Sonnenmitte in Grad, aus Sicht des Beobachters: +x rechts, +y oben */
    offsetX,
    offsetY,
    gast,
  };
}
