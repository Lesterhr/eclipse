/**
 * meter.js — Helligkeitsmessung über die Handykamera.
 *
 * Der heikle Teil ist nicht das Messen, sondern die Automatik der Kamera. Wenn die
 * Belichtung nachregelt, hält sie das Bild konstant hell und die Finsternis verschwindet
 * aus den Daten. Dagegen zwei Verteidigungslinien:
 *
 *   1. Belichtung, ISO und Weißabgleich hart sperren (Android Chrome kann das).
 *   2. Wo das nicht geht: Belichtungszeit und ISO aus den Track-Settings auslesen und
 *      herausrechnen. Ein doppelt so lang belichtetes Bild ist bei halber Szenenhelligkeit
 *      gleich hell — die Szenenleuchtdichte ist Pixelwert / (Zeit · ISO).
 *
 * Dazu kommt die Gamma-Korrektur: Pixelwerte sind sRGB-kodiert, nicht linear. Ohne
 * Linearisierung misst man systematisch die falsche Kurvenform.
 */

/** sRGB-Kanalwert (0..255) → linearer Anteil (0..1) */
function srgbToLinear(c) {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

// Nachschlagetabelle, damit pro Frame nicht 12000 mal Math.pow läuft
const LINEAR_LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) LINEAR_LUT[i] = srgbToLinear(i);

export class LightMeter {
  constructor() {
    this.stream = null;
    this.track = null;
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.width = 64;
    this.height = 48;
    this.locked = false;
    this.lockError = null;
    this.capabilities = null;
    this.facing = 'user';
    /** Referenzwerte für die Belichtungsnormierung, beim ersten Frame gesetzt */
    this.refExposure = null;
  }

  /**
   * Kamera starten.
   * @param {'user'|'environment'} facing Frontkamera (Handy flach mit Display nach oben)
   *   oder Rückkamera.
   */
  async start(facing = 'user') {
    this.stop();
    this.facing = facing;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: facing,
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 15 },
      },
      audio: false,
    });
    this.track = this.stream.getVideoTracks()[0];

    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.srcObject = this.stream;
    await this.video.play();

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    this.capabilities = this._readCapabilities();
    await this.lockExposure();
    return this.status();
  }

  _readCapabilities() {
    try {
      return this.track.getCapabilities ? this.track.getCapabilities() : {};
    } catch {
      return {};
    }
  }

  settings() {
    try {
      return this.track && this.track.getSettings ? this.track.getSettings() : {};
    } catch {
      return {};
    }
  }

  /**
   * Versucht, Belichtung / ISO / Weißabgleich / Fokus festzunageln.
   * Schlägt auf iOS Safari fehl — dort greift die Normierung in read().
   */
  async lockExposure() {
    const caps = this.capabilities || {};
    const cur = this.settings();
    const advanced = {};

    if (caps.exposureMode && caps.exposureMode.includes('manual')) {
      advanced.exposureMode = 'manual';
      if (caps.exposureTime && cur.exposureTime) {
        advanced.exposureTime = Math.min(
          caps.exposureTime.max,
          Math.max(caps.exposureTime.min, cur.exposureTime)
        );
      }
      if (caps.iso && cur.iso) {
        advanced.iso = Math.min(caps.iso.max, Math.max(caps.iso.min, cur.iso));
      }
    }
    if (caps.whiteBalanceMode && caps.whiteBalanceMode.includes('manual')) {
      advanced.whiteBalanceMode = 'manual';
    }
    if (caps.focusMode && caps.focusMode.includes('manual')) {
      advanced.focusMode = 'manual';
    }

    if (!Object.keys(advanced).length) {
      this.locked = false;
      this.lockError = 'Kamera erlaubt keine manuelle Belichtung';
      return false;
    }
    try {
      await this.track.applyConstraints({ advanced: [advanced] });
      this.locked = true;
      this.lockError = null;
      return true;
    } catch (err) {
      this.locked = false;
      this.lockError = err.message || String(err);
      return false;
    }
  }

  /**
   * Ein Messwert aus dem aktuellen Kamerabild.
   *
   * @returns {{value:number, raw:number, saturated:number, dark:number,
   *            exposure:number|null, normalized:boolean}}
   *   value    — belichtungsnormierte Helligkeit (willkürliche, aber konsistente Einheit)
   *   raw      — mittlere lineare Leuchtdichte des Bildes, 0..1
   *   saturated— Anteil ausgefressener Pixel (Messung dort unbrauchbar)
   *   dark     — Anteil fast schwarzer Pixel (Rauschgrenze erreicht)
   */
  read() {
    if (!this.ctx || !this.video || this.video.readyState < 2) return null;
    this.ctx.drawImage(this.video, 0, 0, this.width, this.height);
    const { data } = this.ctx.getImageData(0, 0, this.width, this.height);

    let sum = 0;
    let saturated = 0;
    let dark = 0;
    const n = this.width * this.height;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // Rec.709-Luminanz auf linearisierten Kanälen
      sum += 0.2126 * LINEAR_LUT[r] + 0.7152 * LINEAR_LUT[g] + 0.0722 * LINEAR_LUT[b];
      if (r > 250 && g > 250 && b > 250) saturated++;
      if (r < 3 && g < 3 && b < 3) dark++;
    }
    const raw = sum / n;

    // Belichtungsnormierung: exposureTime kommt in 100-µs-Schritten, ISO als Zahl.
    const s = this.settings();
    let exposure = null;
    let value = raw;
    let normalized = false;
    if (s.exposureTime && s.iso) {
      exposure = s.exposureTime * s.iso;
      if (!this.refExposure) this.refExposure = exposure;
      value = (raw * this.refExposure) / exposure;
      normalized = true;
    } else if (s.exposureTime) {
      exposure = s.exposureTime;
      if (!this.refExposure) this.refExposure = exposure;
      value = (raw * this.refExposure) / exposure;
      normalized = true;
    }

    return {
      value,
      raw,
      saturated: saturated / n,
      dark: dark / n,
      exposure,
      normalized,
    };
  }

  status() {
    const s = this.settings();
    return {
      active: !!this.track && this.track.readyState === 'live',
      facing: this.facing,
      locked: this.locked,
      lockError: this.lockError,
      exposureTime: s.exposureTime || null,
      iso: s.iso || null,
      canLock: !!(this.capabilities?.exposureMode || []).includes?.('manual'),
    };
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
    if (this.video) {
      this.video.srcObject = null;
    }
    this.stream = null;
    this.track = null;
    this.video = null;
    this.refExposure = null;
  }
}

/**
 * Umgebungslichtsensor, falls das Gerät einen hat. Liefert echte Lux und ist immun
 * gegen jede Kameraautomatik — nur unterstützen ihn die wenigsten Browser.
 */
export class AmbientSensor {
  constructor() {
    this.sensor = null;
    this.lastLux = null;
    this.available = typeof window !== 'undefined' && 'AmbientLightSensor' in window;
  }

  async start() {
    if (!this.available) return false;
    try {
      const perm = await navigator.permissions.query({ name: 'ambient-light-sensor' });
      if (perm.state === 'denied') return false;
      // eslint-disable-next-line no-undef
      this.sensor = new AmbientLightSensor({ frequency: 1 });
      this.sensor.addEventListener('reading', () => {
        this.lastLux = this.sensor.illuminance;
      });
      this.sensor.start();
      return true;
    } catch {
      this.available = false;
      return false;
    }
  }

  read() {
    return this.lastLux;
  }

  stop() {
    try {
      this.sensor?.stop();
    } catch {
      /* egal */
    }
    this.sensor = null;
  }
}

/**
 * Sonifikation: Helligkeit als Ton. Je dunkler, desto tiefer.
 * Läuft nebenher und macht den Verlauf hörbar, ohne aufs Display zu schauen.
 */
export class Sonifier {
  constructor() {
    this.ctx = null;
    this.osc = null;
    this.gain = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();
    this.osc = this.ctx.createOscillator();
    this.gain = this.ctx.createGain();
    this.osc.type = 'sine';
    this.osc.frequency.value = 440;
    this.gain.gain.value = 0.0001;
    this.osc.connect(this.gain).connect(this.ctx.destination);
    this.osc.start();
    this.gain.gain.setTargetAtTime(0.08, this.ctx.currentTime, 0.3);
    this.running = true;
  }

  /**
   * @param {number} fraction Restlicht 0..1 → Tonhöhe zwischen 110 und 880 Hz,
   *   logarithmisch, damit die letzten Prozent hörbar bleiben.
   */
  update(fraction) {
    if (!this.running) return;
    const f = Math.max(0.01, Math.min(1, fraction));
    const hz = 110 * Math.pow(8, (Math.log10(f) + 2) / 2);
    this.osc.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.15);
  }

  stop() {
    if (!this.running) return;
    this.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.2);
    const ctx = this.ctx;
    const osc = this.osc;
    setTimeout(() => {
      try {
        osc.stop();
        ctx.close();
      } catch {
        /* egal */
      }
    }, 600);
    this.running = false;
  }
}
