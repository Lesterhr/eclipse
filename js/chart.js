/**
 * chart.js — die Lichtkurve zeichnen.
 *
 * Zwei Kurven auf einer Achse: die berechnete Vorhersage für den Standort und die
 * eigene Messung. Die Y-Achse ist logarithmisch, weil zwischen "Sonne scheint" und
 * "kurz vor Totalität" gut drei Größenordnungen liegen — linear würde man vom
 * spannenden Teil nichts sehen.
 */

const PAD = { top: 18, right: 14, bottom: 30, left: 46 };

export class Chart {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{night?:boolean}} opts
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.night = !!opts.night;
    this.mode = 'light'; // 'light' = Helligkeit, 'obsc' = Bedeckungsgrad
    this.resize();
  }

  get colors() {
    return this.night
      ? {
          bg: '#0a0000',
          grid: '#3a1010',
          text: '#c05050',
          model: '#8a2020',
          measured: '#ff5a5a',
          accent: '#ff8080',
          now: '#ff3030',
        }
      : {
          bg: '#0d1117',
          grid: '#232b36',
          text: '#8b98a8',
          model: '#3f6ea8',
          measured: '#ffcc55',
          accent: '#7fd0ff',
          now: '#ff6b5a',
        };
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * @param {object} state
   * @param {Array} state.model  Vorhersagepunkte aus predictCurve
   * @param {Array} state.measured  Messpunkte [{t, value}]
   * @param {number} state.scale  Skalenfaktor Messung → Lux
   * @param {object} state.eclipse  Ergebnis von findEclipse
   * @param {number} state.now  aktueller Zeitpunkt
   * @param {Array} state.notes  Markierungen [{t, text}]
   */
  draw(state) {
    const { ctx, w, h } = this;
    const c = this.colors;
    const { model, measured, scale, eclipse, now, notes } = state;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, w, h);
    if (!model?.length) return;

    const plotW = w - PAD.left - PAD.right;
    const plotH = h - PAD.top - PAD.bottom;
    const t0 = model[0].t;
    const t1 = model[model.length - 1].t;
    const x = (t) => PAD.left + ((t - t0) / (t1 - t0)) * plotW;

    // Y-Bereich bestimmen
    let yMin;
    let yMax;
    let yOf;
    if (this.mode === 'obsc') {
      yMin = 0;
      yMax = 100;
      yOf = (v) => PAD.top + plotH - (v / 100) * plotH;
    } else {
      const vals = model.map((m) => m.lux);
      for (const s of measured || []) vals.push(s.value * scale);
      const lo = Math.max(0.05, Math.min(...vals) * 0.6);
      const hi = Math.max(...vals) * 1.6;
      yMin = Math.log10(lo);
      yMax = Math.log10(hi);
      yOf = (v) =>
        PAD.top + plotH - ((Math.log10(Math.max(v, 10 ** yMin)) - yMin) / (yMax - yMin)) * plotH;
    }

    // Gitter und Achsenbeschriftung
    ctx.strokeStyle = c.grid;
    ctx.fillStyle = c.text;
    ctx.lineWidth = 1;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    if (this.mode === 'obsc') {
      for (let v = 0; v <= 100; v += 25) {
        const y = yOf(v);
        ctx.beginPath();
        ctx.moveTo(PAD.left, y);
        ctx.lineTo(w - PAD.right, y);
        ctx.stroke();
        ctx.fillText(`${v} %`, PAD.left - 6, y);
      }
    } else {
      for (let e = Math.ceil(yMin); e <= Math.floor(yMax); e++) {
        const y = yOf(10 ** e);
        ctx.beginPath();
        ctx.moveTo(PAD.left, y);
        ctx.lineTo(w - PAD.right, y);
        ctx.stroke();
        const lux = 10 ** e;
        ctx.fillText(lux >= 1000 ? `${lux / 1000}k` : `${lux}`, PAD.left - 6, y);
      }
      ctx.save();
      ctx.translate(11, PAD.top + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText('Lux', 0, 0);
      ctx.restore();
    }

    // Zeitachse: volle Viertelstunden
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const step = (t1 - t0) / 3600000 > 2.5 ? 1800000 : 900000;
    const first = Math.ceil(t0 / step) * step;
    for (let t = first; t <= t1; t += step) {
      const px = x(t);
      ctx.strokeStyle = c.grid;
      ctx.beginPath();
      ctx.moveTo(px, PAD.top);
      ctx.lineTo(px, PAD.top + plotH);
      ctx.stroke();
      ctx.fillStyle = c.text;
      ctx.fillText(
        new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
        px,
        PAD.top + plotH + 6
      );
    }

    // Nach Sonnenuntergang ist nichts mehr zu sehen — den Bereich abdunkeln
    if (eclipse?.sunset && eclipse.sunset > t0 && eclipse.sunset < t1) {
      const px = x(eclipse.sunset);
      ctx.fillStyle = c.bg;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(px, PAD.top, PAD.left + plotW - px, plotH);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c.text;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(px, PAD.top);
      ctx.lineTo(px, PAD.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = c.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('Sonne unter', px + 4, PAD.top + 4);
    }

    // Kontaktzeiten markieren
    if (eclipse?.visible) {
      const marks = [
        [eclipse.contacts.c1, 'C1'],
        [eclipse.contacts.c2, 'C2'],
        [eclipse.maxTime, 'Max'],
        [eclipse.contacts.c3, 'C3'],
        [eclipse.contacts.c4, 'C4'],
      ];
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = c.accent;
      ctx.fillStyle = c.accent;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const [t, label] of marks) {
        if (t == null || t < t0 || t > t1) continue;
        const px = x(t);
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(px, PAD.top);
        ctx.lineTo(px, PAD.top + plotH);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillText(label, px, PAD.top - 14);
      }
      ctx.setLineDash([]);
    }

    // Vorhersagekurve
    ctx.strokeStyle = c.model;
    ctx.lineWidth = 2;
    ctx.beginPath();
    model.forEach((m, i) => {
      const px = x(m.t);
      const py = yOf(this.mode === 'obsc' ? m.obscuration * 100 : m.lux);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // Messkurve
    if (measured?.length > 1 && this.mode !== 'obsc') {
      ctx.strokeStyle = c.measured;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      for (const s of measured) {
        if (s.t < t0 || s.t > t1) continue;
        const px = x(s.t);
        const py = yOf(s.value * scale);
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // letzter Punkt hervorgehoben
      const last = measured[measured.length - 1];
      if (last.t >= t0 && last.t <= t1) {
        ctx.fillStyle = c.measured;
        ctx.beginPath();
        ctx.arc(x(last.t), yOf(last.value * scale), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Notizen
    for (const n of notes || []) {
      if (n.t < t0 || n.t > t1) continue;
      ctx.fillStyle = c.text;
      ctx.beginPath();
      ctx.arc(x(n.t), PAD.top + plotH - 4, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Jetzt-Linie
    if (now >= t0 && now <= t1) {
      ctx.strokeStyle = c.now;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x(now), PAD.top);
      ctx.lineTo(x(now), PAD.top + plotH);
      ctx.stroke();
    }
  }
}

/**
 * Ergebnisbild zum Herzeigen: Kurve plus die wichtigsten Zahlen, quadratisch.
 * @returns {Promise<Blob>}
 */
export function renderShareCard(state, opts = {}) {
  const W = 1080;
  const H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);

  const { model, measured, scale, eclipse, site } = state;
  const title = opts.title || 'Meine Messung der Sonnenfinsternis';
  const date = new Date(eclipse?.maxTime || Date.now());

  ctx.fillStyle = '#f0f6fc';
  ctx.font = 'bold 46px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(title, 60, 96);

  ctx.fillStyle = '#8b98a8';
  ctx.font = '28px system-ui, sans-serif';
  ctx.fillText(
    date.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }) +
      `  ·  ${site.lat.toFixed(3)}° N  ${site.lon.toFixed(3)}° E`,
    60,
    142
  );

  // Kurvenbereich
  const box = { x: 60, y: 190, w: W - 120, h: 560 };
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(box.x, box.y, box.w, box.h);

  if (model?.length) {
    const t0 = model[0].t;
    const t1 = model[model.length - 1].t;
    const vals = model.map((m) => m.lux);
    for (const s of measured || []) vals.push(s.value * scale);
    const lo = Math.max(0.05, Math.min(...vals) * 0.6);
    const hi = Math.max(...vals) * 1.6;
    const yMin = Math.log10(lo);
    const yMax = Math.log10(hi);
    const x = (t) => box.x + ((t - t0) / (t1 - t0)) * box.w;
    const y = (v) =>
      box.y + box.h - ((Math.log10(Math.max(v, lo)) - yMin) / (yMax - yMin)) * box.h;

    ctx.strokeStyle = '#232b36';
    ctx.lineWidth = 1;
    for (let e = Math.ceil(yMin); e <= Math.floor(yMax); e++) {
      const py = y(10 ** e);
      ctx.beginPath();
      ctx.moveTo(box.x, py);
      ctx.lineTo(box.x + box.w, py);
      ctx.stroke();
    }

    ctx.strokeStyle = '#3f6ea8';
    ctx.lineWidth = 4;
    ctx.beginPath();
    model.forEach((m, i) => (i ? ctx.lineTo(x(m.t), y(m.lux)) : ctx.moveTo(x(m.t), y(m.lux))));
    ctx.stroke();

    if (measured?.length > 1) {
      ctx.strokeStyle = '#ffcc55';
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      measured.forEach((s, i) =>
        i ? ctx.lineTo(x(s.t), y(s.value * scale)) : ctx.moveTo(x(s.t), y(s.value * scale))
      );
      ctx.stroke();
    }
  }

  // Legende
  ctx.font = '26px system-ui, sans-serif';
  ctx.fillStyle = '#ffcc55';
  ctx.fillText('■ gemessen', 60, 800);
  ctx.fillStyle = '#3f6ea8';
  ctx.fillText('■ berechnet', 260, 800);

  // Kennzahlen
  const stats = [
    ['Bedeckung', eclipse?.max ? `${(eclipse.max.obscuration * 100).toFixed(1)} %` : '—'],
    ['Restlicht', eclipse?.max ? `${(eclipse.max.lightFraction * 100).toFixed(1)} %` : '—'],
    [
      'Maximum',
      eclipse?.maxTime
        ? new Date(eclipse.maxTime).toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '—',
    ],
    ['Messpunkte', String(measured?.length || 0)],
  ];
  stats.forEach(([label, value], i) => {
    const cx = 60 + (i % 2) * 500;
    const cy = 880 + Math.floor(i / 2) * 100;
    ctx.fillStyle = '#8b98a8';
    ctx.font = '24px system-ui, sans-serif';
    ctx.fillText(label, cx, cy);
    ctx.fillStyle = '#f0f6fc';
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.fillText(value, cx, cy + 44);
  });

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
