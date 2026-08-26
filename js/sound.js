/**
 * Sehr sparsame Klangeffekte über die Web Audio API.
 * Keine Audiodateien, keine externen Ressourcen.
 *
 * Alle Klänge laufen durch `volume` (0…1). Der Regler in den Einstellungen
 * verändert nur diesen einen Wert – die einzelnen Effekte behalten ihre
 * Lautstärkeverhältnisse zueinander.
 */
let ctx = null;
let enabled = true;
let volume = 0.7;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function blip({ freq = 440, dur = 0.06, type = 'triangle', gain = 0.05, sweep = null }) {
  if (!enabled || volume <= 0) return;
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime);
  if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweep), ac.currentTime + dur);
  amp.gain.setValueAtTime(Math.max(0.0001, gain * volume), ac.currentTime);
  amp.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  osc.connect(amp).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + dur);
}

/**
 * Kurzes Rauschen – klingt nach Papier/Karton und damit nach Spielkarte.
 * @param {{dur:number, gain:number, hp:number, lp:number}} opts
 */
function noise({ dur = 0.06, gain = 0.04, hp = 800, lp = 6000 }) {
  if (!enabled || volume <= 0) return;
  const ac = audio();
  if (!ac) return;
  const frames = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // leiser werdendes Rauschen
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;

  const high = ac.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = hp;
  const low = ac.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = lp;

  const amp = ac.createGain();
  amp.gain.setValueAtTime(Math.max(0.0001, gain * volume), ac.currentTime);
  amp.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);

  src.connect(high).connect(low).connect(amp).connect(ac.destination);
  src.start();
  src.stop(ac.currentTime + dur + 0.02);
}

export const sound = {
  setEnabled(v) { enabled = Boolean(v); },
  get enabled() { return enabled; },
  /** @param {number} v 0…1 */
  setVolume(v) {
    const n = Number(v);
    volume = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.7;
  },
  get volume() { return volume; },

  chip() { blip({ freq: 660, dur: 0.05, type: 'square', gain: 0.035 }); },
  remove() { blip({ freq: 300, dur: 0.05, type: 'square', gain: 0.03 }); },
  /** Kugel-Klick; wird während des Laufs schneller/leiser */
  tick(progressLeft) {
    blip({ freq: 900 + progressLeft * 500, dur: 0.028, type: 'square', gain: 0.02 });
  },
  spin() { blip({ freq: 220, dur: 0.35, type: 'sawtooth', gain: 0.025 }); },
  win() {
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => blip({ freq: f, dur: 0.18, type: 'triangle', gain: 0.05 }), i * 85));
  },
  lose() {
    [330, 262].forEach((f, i) =>
      setTimeout(() => blip({ freq: f, dur: 0.22, type: 'sine', gain: 0.04 }), i * 130));
  },

  /* ------------------------- Blackjack ------------------------- */
  /** Karte gleitet aus dem Schuh auf den Tisch. */
  card() { noise({ dur: 0.075, gain: 0.05, hp: 1200, lp: 7000 }); },
  /** Karte wird umgedreht – etwas heller und kürzer. */
  flip() { noise({ dur: 0.05, gain: 0.045, hp: 1800, lp: 9000 }); },
  /** Der Schuh wird neu gemischt: mehrere Riffel hintereinander. */
  shuffle() {
    for (let i = 0; i < 7; i++) {
      setTimeout(() => noise({ dur: 0.05, gain: 0.032, hp: 900, lp: 6000 }), i * 70);
    }
  },
  /** Kurzer, tiefer Ton für „Hand steht“. */
  stand() { blip({ freq: 300, dur: 0.07, type: 'sine', gain: 0.03 }); },
  /** Hand über 21. */
  bust() { blip({ freq: 240, dur: 0.28, type: 'sawtooth', gain: 0.035, sweep: 90 }); },
  /** Blackjack auf der Hand. */
  blackjack() {
    [784, 988, 1319].forEach((f, i) =>
      setTimeout(() => blip({ freq: f, dur: 0.2, type: 'triangle', gain: 0.05 }), i * 90));
  }
};
