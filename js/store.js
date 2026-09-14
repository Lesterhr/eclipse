/**
 * store.js — Messreihe halten, sichern, exportieren.
 *
 * Eine Finsternis läuft über zwei Stunden. In der Zeit kann das Display abschalten, der
 * Browser die Seite entladen oder jemand versehentlich neu laden. Deshalb liegt jede
 * Messung sofort in localStorage, und beim Start wird die letzte Sitzung angeboten.
 */

const KEY = 'eclipse-session-v1';
const SAVE_INTERVAL_MS = 5000;

export class Session {
  constructor(site) {
    this.site = site;
    this.samples = [];
    this.startedAt = null;
    this.notes = [];
    this._lastSave = 0;
  }

  /**
   * @param {number} t Zeitstempel in Unix-ms
   * @param {{value:number, raw:number, saturated:number, dark:number}} reading
   */
  add(t, reading) {
    if (!this.startedAt) this.startedAt = t;
    this.samples.push({
      t,
      value: reading.value,
      raw: reading.raw,
      sat: Math.round(reading.saturated * 1000) / 1000,
      dark: Math.round(reading.dark * 1000) / 1000,
    });
    this._maybeSave(t);
  }

  /** Markierung im Verlauf, z. B. "Wolke" oder "Handy verrutscht" */
  mark(t, text) {
    this.notes.push({ t, text });
    this.save();
  }

  _maybeSave(now) {
    if (now - this._lastSave > SAVE_INTERVAL_MS) {
      this.save();
      this._lastSave = now;
    }
  }

  save() {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          site: this.site,
          startedAt: this.startedAt,
          samples: this.samples,
          notes: this.notes,
          savedAt: Date.now(),
        })
      );
    } catch {
      // Speicher voll: die Messung läuft trotzdem weiter, nur ohne Netz und doppelten Boden
    }
  }

  static load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data.samples?.length) return null;
      const s = new Session(data.site);
      s.samples = data.samples;
      s.startedAt = data.startedAt;
      s.notes = data.notes || [];
      return s;
    } catch {
      return null;
    }
  }

  static clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* egal */
    }
  }

  /** Gleitender Median über ein Zeitfenster — bügelt einzelne Aussetzer weg, ohne Flanken zu verschleifen */
  smoothed(windowSec = 20) {
    const half = (windowSec * 1000) / 2;
    const out = [];
    let lo = 0;
    for (let i = 0; i < this.samples.length; i++) {
      const t = this.samples[i].t;
      while (this.samples[lo].t < t - half) lo++;
      let hi = i;
      while (hi + 1 < this.samples.length && this.samples[hi + 1].t <= t + half) hi++;
      const win = this.samples.slice(lo, hi + 1).map((s) => s.value).sort((a, b) => a - b);
      const mid = Math.floor(win.length / 2);
      out.push({
        t,
        value: win.length % 2 ? win[mid] : (win[mid - 1] + win[mid]) / 2,
      });
    }
    return out;
  }

  toCSV() {
    const head = 'zeit_iso,unix_ms,messwert,roh_luminanz,saettigung,dunkelanteil';
    const rows = this.samples.map(
      (s) =>
        `${new Date(s.t).toISOString()},${s.t},${s.value.toExponential(6)},` +
        `${s.raw.toExponential(6)},${s.sat},${s.dark}`
    );
    const meta = [
      `# Sonnenfinsternis-Lichtkurve`,
      `# Ort: ${this.site?.lat?.toFixed(5)} N, ${this.site?.lon?.toFixed(5)} E, ${Math.round(this.site?.height || 0)} m`,
      `# Start: ${this.startedAt ? new Date(this.startedAt).toISOString() : '—'}`,
      `# Messwerte: ${this.samples.length}`,
      ...this.notes.map((n) => `# Notiz ${new Date(n.t).toISOString()}: ${n.text}`),
    ];
    return [...meta, head, ...rows].join('\n');
  }

  toJSON() {
    return JSON.stringify(
      {
        site: this.site,
        startedAt: this.startedAt,
        samples: this.samples,
        notes: this.notes,
      },
      null,
      2
    );
  }
}

/** Datei zum Download anbieten */
export function download(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
