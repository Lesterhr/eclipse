/**
 * sky.js — die Finsternis so zeichnen, wie sie am Himmel steht.
 *
 * Zwei Bilder, weil zwei Fragen dahinterstehen:
 *
 *   SunView     Wie sieht die Sonne gerade aus? Nahaufnahme der beiden Scheiben,
 *               maßstäblich aus Winkelradien und Mittenabstand.
 *   HorizonView Wo am Himmel steht sie? Der Weg der Sonne über den Westhorizont —
 *               die Frage, an der an diesem Abend alles hängt, weil sie mitten in
 *               der Finsternis untergeht.
 *
 * Der Mondversatz kommt in Horizontkoordinaten aus astro.js (+x rechts, +y oben).
 * Damit ist die Bildlage automatisch richtig: die Sichel zeigt auf dem Schirm
 * dorthin, wo sie auch am Himmel hinzeigt.
 */

/** Himmelsfarbe nach Sonnenhöhe und verbliebenem Licht: oben dunkler, unten wärmer. */
export function skyColors(sunAltDeg, lightFraction) {
  // Dämmerungsanteil: 1 bei hoher Sonne, 0 tief unter dem Horizont
  const day = clamp((sunAltDeg + 6) / 12, 0, 1);
  // Die Finsternis dimmt zusätzlich. Der Kubikwurzel-Verlauf entspricht grob dem,
  // was das Auge sieht — der Helligkeitsabfall wirkt lange geringer als er ist.
  const dim = clamp(Math.cbrt(Math.max(lightFraction, 0.001)), 0.12, 1);
  const f = day * dim;

  const top = mix([8, 10, 20], [30, 70, 140], f);
  const horizon = mix([20, 14, 18], [235, 150, 90], Math.pow(f, 0.7));
  return { top: rgb(top), horizon: rgb(horizon), f };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function rgb([r, g, b]) {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/** Azimut in Grad → Himmelsrichtung als Kürzel */
export function compass(azDeg) {
  const names = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return names[Math.round(((azDeg % 360) + 360) % 360 / 22.5) % 16];
}

/**
 * Nahaufnahme: Sonnenscheibe, davor der Mond.
 */
export class SunView {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width || 320;
    this.h = rect.height || 240;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * @param {object} m Modellzustand aus modelAt
   * @param {{measuredLux?:number|null}} opts
   */
  draw(m, opts = {}) {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    if (!m) return;

    const sky = skyColors(m.sunAlt, m.lightFraction);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, sky.top);
    bg.addColorStop(1, sky.horizon);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Maßstab: die Sonne füllt gut ein Drittel der kürzeren Kante. Der Mond ist fast
    // gleich groß, deshalb reicht der Sonnenradius als Bezug.
    const rs = m.sunRadius;
    const rm = m.moonRadius;
    const ppd = (Math.min(w, h) * 0.34) / rs; // Pixel pro Grad
    const cx = w / 2;
    const cy = h / 2;
    const sunR = rs * ppd;
    const moonR = rm * ppd;
    const mx = cx + (m.offsetX || 0) * ppd;
    const my = cy - (m.offsetY || 0) * ppd;

    // Streulichthof. Er schrumpft mit dem Restlicht, sonst leuchtet eine zu 90 %
    // bedeckte Sonne genauso aggressiv wie eine unbedeckte.
    const glowStrength = clamp(m.lightFraction, 0.02, 1);
    const glow = ctx.createRadialGradient(cx, cy, sunR * 0.9, cx, cy, sunR * 3.2);
    glow.addColorStop(0, `rgba(255, 232, 170, ${0.55 * glowStrength})`);
    glow.addColorStop(0.4, `rgba(255, 190, 110, ${0.18 * glowStrength})`);
    glow.addColorStop(1, 'rgba(255, 170, 90, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // Sonnenscheibe mit Randverdunklung: zur Mitte hin fast weiß, am Rand orange.
    // Tief stehende Sonne wird zusätzlich rot, das macht den Untergang erkennbar.
    const low = clamp(1 - m.sunAlt / 8, 0, 1);
    const core = mix([255, 250, 235], [255, 190, 120], low);
    const limb = mix([255, 200, 110], [225, 105, 45], low);
    const disc = ctx.createRadialGradient(cx, cy, 0, cx, cy, sunR);
    disc.addColorStop(0, rgb(core));
    disc.addColorStop(0.75, rgb(mix(core, limb, 0.6)));
    disc.addColorStop(1, rgb(limb));
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(cx, cy, sunR, 0, Math.PI * 2);
    ctx.fill();

    // Der Mond ist nicht schwarz, sondern so dunkel wie der Himmel dahinter —
    // sonst sieht die Scheibe aus wie ein aufgeklebter Kreis.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, sunR + 0.5, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = sky.top;
    ctx.beginPath();
    ctx.arc(mx, my, moonR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Mondrand außerhalb der Sonne nur andeuten, damit man sieht, woher er kommt
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.arc(mx, my, moonR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Beschriftung
    const pct = (m.obscuration * 100).toFixed(1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillText(`${pct} % bedeckt`, 12, 10);

    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    const alt = m.sunAlt >= 0 ? `${m.sunAlt.toFixed(1)}° hoch` : 'unter dem Horizont';
    ctx.fillText(`${alt}  ·  ${compass(m.sunAz)} ${Math.round(m.sunAz)}°`, 12, 30);

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.fillText(
      new Date(m.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
      w - 12,
      10
    );
    if (opts.measuredLux != null) {
      ctx.fillText(`gemessen ${fmtLux(opts.measuredLux)}`, w - 12, 28);
    }

    if (m.sunAlt < 0) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('Von hier aus nicht mehr zu sehen', w / 2, h - 22);
    }
  }
}

function fmtLux(v) {
  if (v == null) return '—';
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k lx`;
  if (v >= 10) return `${Math.round(v)} lx`;
  return `${v.toFixed(1)} lx`;
}

/**
 * Der Weg der Sonne über den Horizont, mit Kompass und Höhenskala.
 *
 * Azimut geht auf die x-Achse, Höhe auf die y-Achse, beide in Grad und beide linear —
 * so, wie man den Himmel wirklich sieht. Der Ausschnitt richtet sich nach dem Bogen,
 * den die Sonne zwischen erstem und letztem Kontakt zurücklegt.
 */
export class HorizonView {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width || 320;
    this.h = rect.height || 160;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * @param {object} opts
   * @param {Array} opts.path Modellpunkte über den Finsternisverlauf
   * @param {object} opts.current aktueller Modellzustand
   * @param {number} [opts.dip] Kimmtiefe in Grad (erhöhter Standort)
   */
  draw({ path, current, dip = 0 }) {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    if (!path?.length) return;

    const azs = path.map((p) => p.sunAz);
    const az0 = Math.min(...azs) - 4;
    const az1 = Math.max(...azs) + 4;
    const altMax = Math.max(6, Math.max(...path.map((p) => p.sunAlt)) + 2);
    const altMin = -3;

    const padB = 20;
    const x = (az) => ((az - az0) / (az1 - az0)) * w;
    const y = (alt) => (h - padB) - ((alt - altMin) / (altMax - altMin)) * (h - padB - 6);

    const sky = skyColors(current?.sunAlt ?? 5, current?.lightFraction ?? 1);
    const bg = ctx.createLinearGradient(0, 0, 0, y(0));
    bg.addColorStop(0, sky.top);
    bg.addColorStop(1, sky.horizon);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, y(0));

    // Gelände unter dem sichtbaren Horizont
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(0, y(-dip), w, h - y(-dip));

    // Höhenlinien alle 2 Grad. Eine Faust am ausgestreckten Arm sind rund 10 Grad,
    // deshalb ist die 10er-Linie extra beschriftet.
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let a = 0; a <= altMax; a += 2) {
      const py = y(a);
      if (py < 4) continue;
      ctx.strokeStyle = a === 0 ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = a === 0 ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.textAlign = 'left';
      ctx.fillText(a === 10 ? '10° (eine Faust)' : `${a}°`, 4, py - 7);
    }

    // Kimmtiefe: auf einem Turm liegt der sichtbare Horizont tiefer als die Waagerechte
    if (dip > 0.02) {
      ctx.strokeStyle = 'rgba(120, 220, 255, 0.55)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, y(-dip));
      ctx.lineTo(w, y(-dip));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Kompass am unteren Rand
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const azStep = az1 - az0 > 40 ? 10 : 5;
    for (let a = Math.ceil(az0 / azStep) * azStep; a <= az1; a += azStep) {
      const px = x(a);
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h - padB);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(`${compass(a)} ${Math.round(a)}°`, px, h - 6);
    }

    // Bahn der Sonne
    ctx.strokeStyle = 'rgba(255, 210, 120, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    path.forEach((p, i) => (i ? ctx.lineTo(x(p.sunAz), y(p.sunAlt)) : ctx.moveTo(x(p.sunAz), y(p.sunAlt))));
    ctx.stroke();

    // Sonnenscheibchen entlang der Bahn, damit der Verlauf der Bedeckung sichtbar wird
    const every = Math.max(1, Math.round(path.length / 9));
    for (let i = 0; i < path.length; i += every) {
      this._miniSun(path[i], x(path[i].sunAz), y(path[i].sunAlt), 6, 0.5);
    }

    if (current) {
      this._miniSun(current, x(current.sunAz), y(current.sunAlt), 11, 1);
    }
  }

  /** Kleine Sonne mit Mondbiss — dieselbe Geometrie wie in der Nahaufnahme, nur winzig. */
  _miniSun(m, px, py, r, alpha) {
    const { ctx } = this;
    const ppd = r / m.sunRadius;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = m.sunAlt < 0 ? '#8a5a3a' : '#ffd27a';
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px, py, r + 0.5, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#121826';
    ctx.beginPath();
    ctx.arc(px + (m.offsetX || 0) * ppd, py - (m.offsetY || 0) * ppd, m.moonRadius * ppd, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
