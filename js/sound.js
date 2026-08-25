/**
 * Sehr sparsame Klangeffekte über die Web Audio API.
 * Keine Audiodateien, keine externen Ressourcen.
 */
let ctx = null;
let enabled = true;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function blip({ freq = 440, dur = 0.06, type = 'triangle', gain = 0.05 }) {
  if (!enabled) return;
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime);
  amp.gain.setValueAtTime(gain, ac.currentTime);
  amp.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  osc.connect(amp).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + dur);
}

export const sound = {
  setEnabled(v) { enabled = Boolean(v); },
  get enabled() { return enabled; },
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
  }
};
