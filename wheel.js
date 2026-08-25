/**
 * Roulette-Rad auf einem Canvas: Zeichnung + Animation.
 *
 * Kernidee: Die Gewinnzahl steht VOR der Animation fest (roulette.js →
 * spinNumber()). Diese Datei berechnet die Endwinkel so, dass die Kugel exakt
 * in der Tasche dieser Zahl zum Stehen kommt. Die Animation kann das Ergebnis
 * also nicht verändern – sie stellt es nur dar.
 */
import { WHEEL_ORDER, colorOf } from './roulette.js';

const TAU = Math.PI * 2;
const SEG = TAU / WHEEL_ORDER.length;              // Winkel pro Tasche

/** Lokaler Mittelpunktwinkel der Tasche mit Index i (Index 0 liegt oben). */
const pocketAngle = (i) => (i + 0.5) * SEG - Math.PI / 2;

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function createWheel(canvas, { onTick } = {}) {
  const ctx = canvas.getContext('2d');

  let size = 0;             // Kantenlänge in CSS-Pixeln
  let R = 0;                // Außenradius
  let running = false;
  let rafId = null;

  // Darstellungszustand
  let wheelAngle = 0;
  let ballAngle = -Math.PI / 2;
  let ballRadius = 0;
  let ballVisible = false;

  // Phasen: null = nur Ruhelauf, sonst laufender Wurf
  let spin = null;
  let settledIndex = null;  // Tasche, in der die Kugel liegt
  let idleStart = 0;
  let idleWheel = 0;
  let lastTickPocket = -1;

  /* ------------------------- Größe / Retina ------------------------- */
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const css = Math.max(1, Math.min(rect.width || 400, rect.height || 400));
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(css * dpr);
    canvas.height = Math.round(css * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    size = css;
    R = css / 2 - 2;
    if (!spin) ballRadius = R * 0.815;
  }

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);

  /* ------------------------------ Zeichnen ------------------------------ */
  function draw() {
    if (!size) return;
    const c = size / 2;
    const rTrack = R * 0.815;   // Kugellaufbahn
    const rOuter = R * 0.755;   // Außenkante der Taschen
    const rInner = R * 0.50;    // Innenkante der Taschen
    const rText = R * 0.663;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(c, c);

    // Außenschale
    const bowl = ctx.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.15, 0, 0, R);
    bowl.addColorStop(0, '#2c2118');
    bowl.addColorStop(0.62, '#1a130d');
    bowl.addColorStop(1, '#0b0906');
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fillStyle = bowl; ctx.fill();

    // Goldener Außenring
    const rimW = Math.max(2, R * 0.035);
    ctx.lineWidth = rimW;
    ctx.strokeStyle = '#c39c55';
    ctx.beginPath(); ctx.arc(0, 0, R - rimW / 2, 0, TAU); ctx.stroke();

    // Vertiefte Laufbahn
    ctx.lineWidth = Math.max(3, R * 0.085);
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.beginPath(); ctx.arc(0, 0, rTrack, 0, TAU); ctx.stroke();

    // Taschen
    ctx.lineWidth = Math.max(0.6, R * 0.006);
    ctx.strokeStyle = 'rgba(212,175,106,.5)';
    for (let i = 0; i < WHEEL_ORDER.length; i++) {
      const color = colorOf(WHEEL_ORDER[i]);
      const a0 = wheelAngle + i * SEG - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(0, 0, rOuter, a0, a0 + SEG);
      ctx.arc(0, 0, rInner, a0 + SEG, a0, true);
      ctx.closePath();
      ctx.fillStyle = color === 'green' ? '#116b45' : color === 'red' ? '#b32127' : '#16181c';
      ctx.fill();
      ctx.stroke();
    }

    // Zahlen (Oberkante zeigt nach außen)
    ctx.fillStyle = '#f6f2e6';
    ctx.font = `700 ${Math.max(6.5, R * 0.068)}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < WHEEL_ORDER.length; i++) {
      ctx.save();
      ctx.rotate(wheelAngle + pocketAngle(i) + Math.PI / 2);
      ctx.translate(0, -rText);
      ctx.fillText(String(WHEEL_ORDER[i]), 0, 0);
      ctx.restore();
    }

    // Innenkegel
    const cone = ctx.createRadialGradient(-R * 0.15, -R * 0.2, R * 0.05, 0, 0, rInner);
    cone.addColorStop(0, '#3a2c1c');
    cone.addColorStop(0.55, '#241a10');
    cone.addColorStop(1, '#120d08');
    ctx.beginPath(); ctx.arc(0, 0, rInner, 0, TAU); ctx.fillStyle = cone; ctx.fill();
    ctx.lineWidth = Math.max(1.2, R * 0.014);
    ctx.strokeStyle = 'rgba(212,175,106,.7)';
    ctx.stroke();

    // Kreuz-Spindel (dreht mit dem Rad)
    ctx.save();
    ctx.rotate(wheelAngle);
    ctx.strokeStyle = 'rgba(212,175,106,.85)';
    ctx.lineWidth = Math.max(2, R * 0.026);
    ctx.lineCap = 'round';
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R * 0.06, Math.sin(a) * R * 0.06);
      ctx.lineTo(Math.cos(a) * rInner * 0.86, Math.sin(a) * rInner * 0.86);
      ctx.stroke();
    }
    ctx.restore();

    // Nabe
    const hub = ctx.createRadialGradient(-R * 0.03, -R * 0.04, 1, 0, 0, R * 0.13);
    hub.addColorStop(0, '#f2ddab');
    hub.addColorStop(1, '#8d7442');
    ctx.beginPath(); ctx.arc(0, 0, R * 0.13, 0, TAU); ctx.fillStyle = hub; ctx.fill();

    // Kugel
    if (ballVisible) {
      const bx = Math.cos(ballAngle) * ballRadius;
      const by = Math.sin(ballAngle) * ballRadius;
      const br = Math.max(3.5, R * 0.043);
      ctx.beginPath();
      ctx.arc(bx, by + br * 0.4, br * 0.95, 0, TAU);
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.fill();
      const g = ctx.createRadialGradient(bx - br * 0.35, by - br * 0.4, br * 0.1, bx, by, br);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.6, '#e9e6dc');
      g.addColorStop(1, '#a7a49b');
      ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fillStyle = g; ctx.fill();
    }

    ctx.restore();
  }

  /* --------------------------- Animationsschleife --------------------------- */
  function frame(now) {
    if (!running) return;

    if (spin) {
      const t = Math.min(1, (now - spin.start) / spin.duration);

      wheelAngle = spin.w0 + spin.wSpin * easeOutCubic(t);   // Rad läuft aus
      ballAngle = spin.b0 + spin.bSpin * easeOutQuart(t);    // Kugel gegenläufig

      if (t < spin.dropAt) {
        // Kugel liegt noch auf der Laufbahn (minimales Schwingen)
        ballRadius = spin.rimR + Math.sin(t * 70) * R * 0.004;
      } else {
        // Fall in den Taschenkranz mit abklingenden Hüpfern
        const u = (t - spin.dropAt) / (1 - spin.dropAt);
        const base = spin.rimR + (spin.pocketR - spin.rimR) * easeInOut(u);
        const hop = Math.abs(Math.sin(u * Math.PI * 3.2)) * Math.pow(1 - u, 2.2) * R * 0.07;
        ballRadius = base + hop;

        // Klick, sobald die Kugel eine Tasche weiterspringt
        if (onTick) {
          const rel = (((ballAngle - wheelAngle) % TAU) + TAU) % TAU;
          const idx = Math.floor(rel / SEG);
          if (idx !== lastTickPocket) {
            lastTickPocket = idx;
            onTick(1 - t);
          }
        }
      }

      if (t >= 1) {
        // Endzustand exakt setzen – hier landet die Kugel garantiert richtig
        wheelAngle = spin.w0 + spin.wSpin;
        settledIndex = spin.index;
        ballAngle = wheelAngle + pocketAngle(settledIndex);
        ballRadius = spin.pocketR;
        idleStart = now;
        idleWheel = wheelAngle;
        const finish = spin.resolve;
        spin = null;
        finish();
      }
    } else if (settledIndex !== null) {
      // Ruhelauf: Rad dreht langsam weiter, die Kugel liegt in ihrer Tasche
      const dt = (now - idleStart) / 1000;
      wheelAngle = idleWheel + dt * 0.14;
      ballAngle = wheelAngle + pocketAngle(settledIndex);
    } else {
      // Leerlauf vor dem Wurf
      wheelAngle += 0.0016;
    }

    draw();
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    resize();
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  /**
   * Wirft die Kugel auf eine BEREITS feststehende Zahl.
   * @param {number} winning   Gewinnzahl 0–36
   * @param {number} duration  Animationsdauer in ms
   * @returns {Promise<void>}  erfüllt, sobald die Kugel liegt
   */
  function throwBall(winning, duration = 6200) {
    const index = WHEEL_ORDER.indexOf(winning);
    if (index < 0) throw new Error(`Zahl ${winning} liegt nicht auf dem Rad`);

    resize();
    settledIndex = null;
    ballVisible = true;
    lastTickPocket = -1;

    const w0 = wheelAngle;
    const wSpin = (4 + Math.random() * 2) * TAU;            // Umdrehungen des Rades
    const target = w0 + wSpin + pocketAngle(index);         // Weltwinkel der Zieltasche am Ende

    const b0 = Math.random() * TAU;                          // zufälliger Einwurfpunkt
    const bTurns = 7 + Math.floor(Math.random() * 4);        // Umläufe der Kugel
    const rawDelta = (((target - b0) % TAU) + TAU) % TAU;
    const bSpin = rawDelta - TAU * (bTurns + 1);             // negativ => Gegenrichtung

    return new Promise((resolve) => {
      spin = {
        start: performance.now(),
        duration,
        index,
        w0, wSpin, b0, bSpin,
        rimR: R * 0.815,
        pocketR: R * 0.63,
        dropAt: 0.55 + Math.random() * 0.08,
        resolve
      };
      start();
    });
  }

  /** Setzt das Rad für die nächste Runde zurück (Kugel wird abgenommen). */
  function reset() {
    spin = null;
    settledIndex = null;
    ballVisible = false;
    ballRadius = R * 0.815;
    draw();
  }

  /** Nur für Tests/Diagnose: aktueller Animationszustand. */
  function debugState() {
    return {
      wheelAngle, ballAngle, ballRadius, settledIndex, R,
      pocketWorldAngle: settledIndex === null ? null : wheelAngle + pocketAngle(settledIndex)
    };
  }

  return { start, stop, draw, resize, throwBall, reset, debugState };
}
