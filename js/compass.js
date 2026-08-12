/**
 * compass.js — Peilung: wo steht die Sonne, und wohin hält man das Handy gerade.
 *
 * Zwei Bilder, weil im Gelände zwei Fragen zusammenkommen:
 *
 *   AimView   Ein Sucher. Man hebt das Handy, und die Sonne sitzt im Bild dort, wo sie
 *             auch am Himmel steht — mit Horizont, Höhenskala und dem Mondbiss.
 *   RoseView  Die Rose von oben. Oben ist die eigene Blickrichtung, dazu Sonne,
 *             Untergangspunkt und der Bogen, den die Sonne bis dahin noch läuft.
 *
 * Die Lagesensoren liefern alpha/beta/gamma. Daraus wird die Rotationsmatrix nach
 * W3C gebaut, die Gerätekoordinaten (x rechts, y oben, z aus dem Schirm heraus) auf
 * die Erdachsen Ost/Nord/Oben abbildet. Damit fällt alles Weitere ab: die Richtung
 * der Rückkamera, die Bildschirmlage bei gedrehtem Gerät und die Neigung — ohne
 * Sonderfälle für Hoch- und Querformat.
 *
 * Reine Funktionen bis auf die Sensor- und Zeichenklassen, damit sich das Rechnen
 * ohne Browser prüfen lässt.
 */

import { skyColors, compass, drawEclipsedSun } from './sky.js';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

const norm360 = (x) => ((x % 360) + 360) % 360;

/** Kürzester Weg von a nach b in Grad, negativ = nach links */
export function deltaAngle(a, b) {
  return ((b - a + 540) % 360) - 180;
}

/**
 * Rotationsmatrix des Geräts (W3C DeviceOrientation, Z-X'-Y'' intrinsisch), zeilenweise.
 * R · v bildet einen Vektor in Gerätekoordinaten auf Erdkoordinaten (Ost, Nord, Oben) ab.
 */
export function rotationMatrix(alphaDeg, betaDeg, gammaDeg) {
  const a = alphaDeg * DEG;
  const b = betaDeg * DEG;
  const g = gammaDeg * DEG;
  const cA = Math.cos(a);
  const sA = Math.sin(a);
  const cB = Math.cos(b);
  const sB = Math.sin(b);
  const cG = Math.cos(g);
  const sG = Math.sin(g);
  return [
    cA * cG - sA * sB * sG, -cB * sA, cA * sG + cG * sA * sB,
    cG * sA + cA * sB * sG, cA * cB, sA * sG - cA * cG * sB,
    -cB * sG, sB, cB * cG,
  ];
}

/** Spalte i (0..2) der Matrix — das Bild der i-ten Geräteachse in Erdkoordinaten */
export function column(R, i) {
  return [R[i], R[3 + i], R[6 + i]];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function lin(a, sa, b, sb) {
  return [a[0] * sa + b[0] * sb, a[1] * sa + b[1] * sb, a[2] * sa + b[2] * sb];
}

/** Einheitsvektor aus Azimut (von Nord über Ost) und Höhe, in Erdkoordinaten */
export function fromAzAlt(azDeg, altDeg) {
  const c = Math.cos(altDeg * DEG);
  return [c * Math.sin(azDeg * DEG), c * Math.cos(azDeg * DEG), Math.sin(altDeg * DEG)];
}

/** Erdvektor → Azimut/Höhe in Grad */
export function toAzAlt([e, n, u]) {
  const len = Math.hypot(e, n, u) || 1;
  return { az: norm360(Math.atan2(e, n) * RAD), alt: Math.asin(u / len) * RAD };
}

/**
 * Blickrichtung und Bildschirmachsen aus einer Sensormessung.
 *
 * @param {{alpha:number, beta:number, gamma:number}} r Lagewinkel in Grad
 * @param {number} screenAngle Drehung der Anzeige gegen die Bauform (0/90/180/270)
 * @param {number} offsetDeg Feinabgleich in Grad, wird auf jedes Azimut addiert
 * @returns {{fwd:number[], right:number[], up:number[], aim:{az:number,alt:number},
 *            facing:number, flat:boolean, tilt:number}}
 *   fwd zeigt aus der Rückkamera, right/up sind die Bildschirmachsen (Querformat schon
 *   eingerechnet), facing ist die Richtung, in die der Nutzer schaut, flat meldet ein
 *   flach liegendes Handy.
 */
export function orientationFrame(r, screenAngle = 0, offsetDeg = 0) {
  // Die Alpha-Drehung steht in der Matrix ganz außen, ein Abzug dort dreht deshalb
  // alle Richtungen gleichmäßig um die Senkrechte — genau das soll der Abgleich.
  const R = rotationMatrix(r.alpha - offsetDeg, r.beta, r.gamma);
  const devX = column(R, 0);
  const devY = column(R, 1);
  const devZ = column(R, 2);

  // Bildschirm-Oben liegt in Gerätekoordinaten bei (sin θ, cos θ, 0), Rechts 90° davon
  const t = screenAngle * DEG;
  const up = lin(devX, Math.sin(t), devY, Math.cos(t));
  const right = lin(devX, Math.cos(t), devY, -Math.sin(t));
  const fwd = [-devZ[0], -devZ[1], -devZ[2]];

  const aim = toAzAlt(fwd);
  // Flach heißt: die Kamera schaut auf den Boden, gepeilt wird dann über die Oberkante
  const flat = aim.alt < -55;
  return {
    fwd,
    right,
    up,
    aim,
    tilt: aim.alt,
    flat,
    facing: flat ? toAzAlt(up).az : aim.az,
  };
}

/**
 * Ein Himmelspunkt im Sucherbild. Gnomonische Projektion um die Blickrichtung.
 * @returns {{x:number, y:number, behind:boolean}} x/y als Tangenswerte, rechts und oben positiv
 */
export function projectToScreen(vec, frame) {
  const z = dot(vec, frame.fwd);
  const x = dot(vec, frame.right);
  const y = dot(vec, frame.up);
  if (z <= 0.08) {
    // Hinter der Kamera: Richtung merken, damit ein Pfeil an den Rand kann
    return { x, y, z, behind: true };
  }
  return { x: x / z, y: y / z, z, behind: false };
}

/** Bildschirmwinkel aus screen.orientation, mit den alten Fällen als Rückfall */
export function screenAngle() {
  if (typeof screen !== 'undefined') {
    const a = screen.orientation?.angle;
    if (typeof a === 'number') return norm360(a);
  }
  if (typeof window !== 'undefined' && typeof window.orientation === 'number') {
    return norm360(window.orientation);
  }
  return 0;
}

/**
 * Lagesensor mit den drei Wegen, auf denen Browser die Nordrichtung herausgeben.
 *
 * iOS liefert webkitCompassHeading (rechtweisend Nord, aber erst nach ausdrücklicher
 * Erlaubnis, und die gibt es nur direkt aus einer Berührung heraus). Android hat
 * deviceorientationabsolute, magnetisch Nord. Bleibt das gewöhnliche deviceorientation,
 * das ohne absolute Referenz nur relativ zum Einschaltmoment stimmt — brauchbar zum
 * Drehen, nicht zum Peilen. Die Quellen sind gestuft, eine schlechtere überschreibt
 * keine bessere.
 */
const RANK = { ios: 3, absolut: 2, relativ: 1 };

export class CompassSensor {
  constructor() {
    this.reading = null;
    this.source = null;
    this.accuracy = null;
    this.state = 'aus';
    this.onchange = null;
    this._rank = 0;
    this._handler = null;
    this._smooth = null;
  }

  get available() {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  }

  /** @returns {Promise<string>} neuer Zustand: 'wartet' | 'abgelehnt' | 'nicht-verfuegbar' */
  async start() {
    if (!this.available) {
      this.state = 'nicht-verfuegbar';
      return this.state;
    }
    const D = window.DeviceOrientationEvent;
    if (typeof D.requestPermission === 'function') {
      let res;
      try {
        res = await D.requestPermission();
      } catch {
        res = 'denied';
      }
      if (res !== 'granted') {
        this.state = 'abgelehnt';
        return this.state;
      }
    }
    if (!this._handler) {
      this._handler = (ev) => this._onEvent(ev);
      window.addEventListener('deviceorientationabsolute', this._handler, true);
      window.addEventListener('deviceorientation', this._handler, true);
    }
    this.state = 'wartet';
    return this.state;
  }

  stop() {
    if (this._handler) {
      window.removeEventListener('deviceorientationabsolute', this._handler, true);
      window.removeEventListener('deviceorientation', this._handler, true);
      this._handler = null;
    }
    this.state = 'aus';
    this.reading = null;
    this._rank = 0;
    this._smooth = null;
  }

  _onEvent(ev) {
    let source;
    let alpha;
    if (typeof ev.webkitCompassHeading === 'number' && Number.isFinite(ev.webkitCompassHeading)) {
      source = 'ios';
      alpha = norm360(360 - ev.webkitCompassHeading);
      this.accuracy = typeof ev.webkitCompassAccuracy === 'number' ? ev.webkitCompassAccuracy : null;
    } else if (ev.type === 'deviceorientationabsolute' || ev.absolute === true) {
      source = 'absolut';
      alpha = ev.alpha;
    } else {
      source = 'relativ';
      alpha = ev.alpha;
    }
    if (alpha == null || ev.beta == null || ev.gamma == null) return;
    if (RANK[source] < this._rank) return;

    this._rank = RANK[source];
    this.source = source;
    this.state = 'laeuft';
    this.reading = this._filter({ alpha, beta: ev.beta, gamma: ev.gamma });
    this.onchange?.(this.reading);
  }

  /**
   * Tiefpass über Sinus und Kosinus jedes Winkels. Direkt auf den Gradzahlen würde
   * der Sprung von 359° auf 0° die Rose einmal komplett herumreißen.
   */
  _filter(raw) {
    const k = 0.3;
    if (!this._smooth) {
      this._smooth = {};
      for (const key of ['alpha', 'beta', 'gamma']) {
        this._smooth[key] = [Math.sin(raw[key] * DEG), Math.cos(raw[key] * DEG)];
      }
    } else {
      for (const key of ['alpha', 'beta', 'gamma']) {
        const s = this._smooth[key];
        s[0] += (Math.sin(raw[key] * DEG) - s[0]) * k;
        s[1] += (Math.cos(raw[key] * DEG) - s[1]) * k;
      }
    }
    const out = {};
    for (const key of ['alpha', 'beta', 'gamma']) {
      out[key] = Math.atan2(this._smooth[key][0], this._smooth[key][1]) * RAD;
    }
    return out;
  }
}

/* ---------------------------- Zeichnen ---------------------------- */

class CanvasView {
  constructor(canvas, fallbackH) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fallbackH = fallbackH;
    this.resize();
  }
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width || 320;
    this.h = rect.height || this.fallbackH;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

/**
 * Der Sucher. Bildfeld 60° breit, also ungefähr das, was man beim Blick über das
 * Handy hinweg auch wirklich sieht — Bild und Wirklichkeit passen dann zusammen.
 */
export class AimView extends CanvasView {
  constructor(canvas) {
    super(canvas, 300);
    this.fovDeg = 60;
  }

  /**
   * @param {object} o
   * @param {object} o.model aktueller Modellzustand (modelAt)
   * @param {object|null} o.frame Lage des Geräts, null wenn kein Kompass läuft
   * @param {number} [o.sunsetAz] Azimut des Untergangspunkts
   */
  draw({ model, frame, sunsetAz = null }) {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    if (!model) return;

    const sky = skyColors(model.sunAlt, model.lightFraction);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, sky.top);
    bg.addColorStop(1, sky.horizon);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    if (!frame) {
      this._message('Kompass ist aus', 'Oben einschalten, dann zeigt dieses Bild, wohin du hältst.');
      return;
    }
    if (frame.flat) {
      this._message(
        'Handy liegt flach',
        'Aufstellen und wie eine Kamera zum Himmel halten, dann sitzt die Sonne im Bild.'
      );
      this._crosshair();
      return;
    }

    const cx = w / 2;
    const cy = h / 2;
    // Brennweite in Pixeln: halbe Bildbreite entspricht dem halben Bildfeld
    const f = cx / Math.tan((this.fovDeg / 2) * DEG);
    const sun = fromAzAlt(model.sunAz, model.sunAlt);
    const p = projectToScreen(sun, frame);

    this._horizon(frame, cx, cy, f);
    this._altGrid(frame, cx, cy, f);

    if (sunsetAz != null) {
      const q = projectToScreen(fromAzAlt(sunsetAz, 0), frame);
      if (!q.behind) {
        const sx = cx + q.x * f;
        const sy = cy - q.y * f;
        if (sx > -40 && sx < w + 40) {
          ctx.strokeStyle = 'rgba(255, 160, 90, 0.7)';
          ctx.setLineDash([5, 5]);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(sx, Math.max(0, sy - 60));
          ctx.lineTo(sx, Math.min(h, sy + 26));
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(255, 190, 130, 0.9)';
          ctx.font = '11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText('Untergang', sx, Math.min(h - 14, sy + 30));
        }
      }
    }

    this._crosshair();

    const visible = !p.behind && Math.abs(p.x * f) < w / 2 && Math.abs(p.y * f) < h / 2;
    if (visible) {
      const sx = cx + p.x * f;
      const sy = cy - p.y * f;
      // Der Ring hat 5° Halbmesser und gibt der stark vergrößerten Scheibe einen Maßstab
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.tan(5 * DEG) * f, 0, Math.PI * 2);
      ctx.stroke();
      drawEclipsedSun(ctx, model, sx, sy, 15, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`${(model.obscuration * 100).toFixed(0)} % bedeckt`, sx, sy + 22);
    } else {
      this._pointer(p, frame, model);
    }

    // Kopfzeile: wohin gehalten wird
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(
      `du hältst nach ${compass(frame.aim.az)} ${Math.round(frame.aim.az)}° · ${frame.tilt.toFixed(0)}°`,
      12,
      10
    );
  }

  /** Der Horizont ist ein Großkreis und wird in dieser Projektion zur Geraden */
  _horizon(frame, cx, cy, f) {
    const { ctx, w, h } = this;
    const az = frame.aim.az;
    const a = projectToScreen(fromAzAlt(az - 30, 0), frame);
    const b = projectToScreen(fromAzAlt(az + 30, 0), frame);
    if (a.behind || b.behind) return;
    const ax = cx + a.x * f;
    const ay = cy - a.y * f;
    const bx = cx + b.x * f;
    const by = cy - b.y * f;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len < 1) return;
    const ext = (w + h) / len;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ax - dx * ext, ay - dy * ext);
    ctx.lineTo(bx + dx * ext, by + dy * ext);
    // Gelände unterhalb andeuten
    ctx.lineTo(bx + dx * ext, h * 3);
    ctx.lineTo(ax - dx * ext, h * 3);
    ctx.closePath();
    ctx.fillStyle = 'rgba(8, 11, 16, 0.85)';
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(ax - dx * ext, ay - dy * ext);
    ctx.lineTo(bx + dx * ext, by + dy * ext);
    ctx.stroke();
  }

  /** Höhenmarken alle 5°, an der linken Bildkante */
  _altGrid(frame, cx, cy, f) {
    const { ctx, h } = this;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let a = 5; a <= 40; a += 5) {
      const p = projectToScreen(fromAzAlt(frame.aim.az, a), frame);
      if (p.behind) continue;
      const y = cy - p.y * f;
      if (y < 8 || y > h - 8) continue;
      const x = cx + p.x * f;
      ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 26, y);
      ctx.lineTo(x + 26, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText(`${a}°`, x + 30, y);
    }
  }

  _crosshair() {
    const { ctx, w, h } = this;
    const cx = w / 2;
    const cy = h / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy);
    ctx.lineTo(cx - 4, cy);
    ctx.moveTo(cx + 4, cy);
    ctx.lineTo(cx + 12, cy);
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(cx, cy - 4);
    ctx.moveTo(cx, cy + 4);
    ctx.lineTo(cx, cy + 12);
    ctx.stroke();
  }

  /** Sonne außerhalb des Bildes: Pfeil an den Rand, dazu wie weit es noch ist */
  _pointer(p, frame, model) {
    const { ctx, w, h } = this;
    const cx = w / 2;
    const cy = h / 2;
    // Hinter der Kamera sind es die Rohkomponenten statt der Tangenswerte — für die
    // Richtung des Pfeils reicht das, eine Entfernung braucht er nicht.
    const vx = p.x;
    const vy = p.y;
    const len = Math.hypot(vx, vy) || 1;
    const r = Math.min(w, h) * 0.32;
    const px = cx + (vx / len) * r;
    const py = cy - (vy / len) * r;
    const ang = Math.atan2(-vy, vx);

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(255, 214, 130, 0.95)';
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-8, 9);
    ctx.lineTo(-8, -9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const dAz = deltaAngle(frame.aim.az, model.sunAz);
    const dAlt = model.sunAlt - frame.tilt;
    const teile = [];
    if (Math.abs(dAz) >= 3) teile.push(`${Math.round(Math.abs(dAz))}° nach ${dAz > 0 ? 'rechts' : 'links'}`);
    if (Math.abs(dAlt) >= 3) teile.push(`${Math.round(Math.abs(dAlt))}° ${dAlt > 0 ? 'höher' : 'tiefer'}`);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(teile.join(', ') || 'fast drauf', cx, cy + Math.min(h, 200) * 0.42);
  }

  _message(title, sub) {
    const { ctx, w, h } = this;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, w / 2, h / 2 - 12);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(sub, w / 2, h / 2 + 10);
  }
}

/**
 * Die Rose von oben. Sie dreht sich mit: oben ist immer, wohin man gerade schaut.
 * Ohne Kompass bleibt Nord oben, dann ist sie eine Karte statt eines Instruments.
 */
export class RoseView extends CanvasView {
  constructor(canvas) {
    super(canvas, 260);
  }

  /**
   * @param {object} o
   * @param {number} o.sunAz Azimut der Sonne
   * @param {number} o.sunAlt Höhe der Sonne
   * @param {Array} [o.path] Modellpunkte über den Verlauf, ergibt den Bogen
   * @param {number|null} [o.facing] Blickrichtung, null ohne Kompass
   * @param {number|null} [o.sunsetAz] Untergangspunkt
   */
  draw({ sunAz, sunAlt, path = [], facing = null, sunsetAz = null }) {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) / 2 - 26;
    if (!(R > 10)) return;

    const top = facing ?? 0;
    // Azimut → Bildschirmwinkel, 0 = oben, im Uhrzeigersinn
    const ang = (az) => (deltaAngle(top, az) - 90) * DEG;
    const at = (az, rad) => [cx + Math.cos(ang(az)) * rad, cy + Math.sin(ang(az)) * rad];

    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    // Bogen, den die Sonne bis zum Ende noch läuft
    if (path.length > 1) {
      ctx.strokeStyle = 'rgba(255, 210, 120, 0.35)';
      ctx.lineWidth = 8;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      path.forEach((p, i) => {
        const [x, y] = at(p.sunAz, R * 0.82);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // Gradteilung
    for (let a = 0; a < 360; a += 15) {
      const major = a % 45 === 0;
      const [x1, y1] = at(a, R);
      const [x2, y2] = at(a, R - (major ? 12 : 6));
      ctx.strokeStyle = major ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.18)';
      ctx.lineWidth = major ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Himmelsrichtungen
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [a, name] of [[0, 'N'], [90, 'O'], [180, 'S'], [270, 'W']]) {
      const [x, y] = at(a, R + 13);
      ctx.fillStyle = a === 0 ? '#ff8f6b' : 'rgba(255,255,255,0.7)';
      ctx.font = a === 0 ? '700 15px system-ui, sans-serif' : '600 13px system-ui, sans-serif';
      ctx.fillText(name, x, y);
    }

    // Untergangspunkt
    if (sunsetAz != null) {
      const [x1, y1] = at(sunsetAz, R * 0.2);
      const [x2, y2] = at(sunsetAz, R);
      ctx.strokeStyle = 'rgba(255, 150, 80, 0.65)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Sonne
    const [sx, sy] = at(sunAz, R * 0.82);
    ctx.strokeStyle = 'rgba(255, 220, 150, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(sx, sy);
    ctx.stroke();
    ctx.fillStyle = sunAlt >= 0 ? '#ffd27a' : '#8a5a3a';
    ctx.beginPath();
    ctx.arc(sx, sy, 9, 0, Math.PI * 2);
    ctx.fill();

    // Blickrichtung: fester Zeiger oben, weil sich die Rose dreht
    if (facing != null) {
      ctx.fillStyle = '#7fd4ff';
      ctx.beginPath();
      ctx.moveTo(cx, cy - R - 4);
      ctx.lineTo(cx - 7, cy - R + 10);
      ctx.lineTo(cx + 7, cy - R + 10);
      ctx.closePath();
      ctx.fill();
    }

    // Mitte: die Zahl, um die es geht
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '600 14px system-ui, sans-serif';
    if (facing == null) {
      ctx.fillText('Nord oben', cx, cy - 8);
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('kein Kompass', cx, cy + 10);
    } else {
      const d = deltaAngle(facing, sunAz);
      const txt = Math.abs(d) < 4 ? 'genau vor dir' : `${Math.round(Math.abs(d))}° nach ${d > 0 ? 'rechts' : 'links'}`;
      ctx.fillText(txt, cx, cy - 8);
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(`du: ${compass(facing)} ${Math.round(facing)}°`, cx, cy + 10);
    }
  }
}

/** Höhenangabe, wie man sie im Gelände nachmessen kann */
export function fistHint(altDeg) {
  if (altDeg < 0) return 'unter dem Horizont';
  if (altDeg < 2.5) return 'zwei Finger breit über dem Horizont';
  if (altDeg < 6) return 'eine halbe Faust über dem Horizont';
  if (altDeg < 13) return 'etwa eine Faust über dem Horizont';
  const f = altDeg / 10;
  return `etwa ${f.toFixed(1).replace('.', ',')} Fäuste über dem Horizont`;
}
