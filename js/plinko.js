/**
 * PLINKO – fünftes Minigame der Plattform.
 *
 * Ablauf: Schwierigkeit und Einsatz wählen → KUGEL STARTEN → die Kugel fällt
 * durch 16 Reihen Stifte, wird an jedem Stift nach links oder rechts
 * abgelenkt und landet in einem von 17 Multiplikatorfeldern.
 *
 * Wichtig für die Fairness: der komplette Weg der Kugel steht fest, BEVOR die
 * Animation startet. Die Darstellung zeigt nur noch, was ohnehin feststeht –
 * sie kann das Ergebnis nicht mehr verändern. Und weil das Feld sich direkt
 * aus dem Weg ergibt (Zahl der Rechts-Ablenkungen), kann die Kugel gar nicht
 * neben einem Feld landen.
 *
 * Es gibt keine Wartezeit zwischen zwei Kugeln. Jede Kugel ist ein eigenes,
 * unabhängiges Spiel mit eigener Nummer: genau einmal abbuchen, genau einmal
 * auszahlen. Kugeln beeinflussen einander nie.
 *
 * Der obere Teil dieser Datei ist reine Mathematik ohne DOM und wird von
 * tests/logic.test.mjs direkt geprüft.
 */
import { CHIPS, MAX_CHIP, MAX_BET, maxBetFor } from './bets.js';
import { money, signedMoney } from './roulette.js';

/* ==================================================================== */
/* Spielfeld und Multiplikatoren                                         */
/* ==================================================================== */

/** Reihen mit Stiften. 16 Entscheidungen ergeben 17 mögliche Felder. */
export const ROWS = 16;

/** Anzahl der Multiplikatorfelder. */
export const SLOTS = ROWS + 1;

/**
 * Die vier Risikostufen.
 *
 * `half` beschreibt die linke Hälfte von außen nach innen; das letzte Element
 * ist das mittlere Feld. Gespiegelt ergibt das die vollen 17 Werte.
 *
 * Regel dahinter: je wahrscheinlicher ein Feld, desto kleiner sein
 * Multiplikator. Das mittlere Feld wird mit Abstand am häufigsten getroffen
 * (19,6 %) und zahlt deshalb am wenigsten, die äußeren Felder trifft man nur
 * mit 0,0015 % und sie zahlen dafür bis zu 10.000×.
 *
 * Alle vier Tabellen sind so abgestimmt, dass die Auszahlungsquote bei rund
 * 97 % liegt – genau wie bei Roulette, Blackjack und Crash. Keine Stufe ist
 * dadurch besser oder schlechter als eine andere, sie unterscheiden sich nur
 * im Risiko.
 */
export const RISKS = [
  {
    id: 'leicht',
    label: 'LEICHT',
    blurb: 'Enge Streuung, viele kleine Gewinne. Außen bis 16×.',
    half: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.4]
  },
  {
    id: 'mittel',
    label: 'MITTEL',
    blurb: 'Ausgewogen. Die Mitte kostet, außen warten bis 110×.',
    half: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.2]
  },
  {
    id: 'schwer',
    label: 'SCHWER',
    blurb: 'Breite Streuung. Die Mitte zahlt kaum, außen bis 1.000×.',
    half: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.1]
  },
  {
    id: 'extrem',
    label: 'EXTREM',
    blurb: 'Alles oder nichts. Ganz außen liegen 10.000×.',
    half: [10000, 170, 25, 7, 3, 0.5, 0.2, 0.2, 0.1]
  }
];

export const DEFAULT_RISK = 'mittel';

/** @returns {object|undefined} */
export const riskById = (id) => RISKS.find((r) => r.id === id);

/** Gültige Risiko-ID oder die Standardstufe. */
export const safeRiskId = (id) => (riskById(id) ? id : DEFAULT_RISK);

/** Spiegelt eine Hälfte zu den vollen 17 Feldern. */
export function mirror(half) {
  return [...half, ...half.slice(0, -1).reverse()];
}

/** Die 17 Multiplikatoren einer Schwierigkeit, von links nach rechts. */
export function tableFor(id) {
  return mirror(riskById(safeRiskId(id)).half);
}

/** Binomialkoeffizient C(n, k) – ohne Fakultäten, damit nichts überläuft. */
export function binomial(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  return result;
}

/**
 * Wahrscheinlichkeit für jedes der 17 Felder.
 * Bei 16 fairen Münzwürfen ist das die Binomialverteilung: die Mitte trifft
 * man oft, die Ränder fast nie.
 */
export function slotProbabilities() {
  const total = 2 ** ROWS;
  return Array.from({ length: SLOTS }, (_, k) => binomial(ROWS, k) / total);
}

/** Auszahlungsquote einer Tabelle: Summe aus Wahrscheinlichkeit × Multiplikator. */
export function rtpOf(table) {
  const p = slotProbabilities();
  return table.reduce((sum, m, i) => sum + m * p[i], 0);
}

/* ==================================================================== */
/* Zufall                                                                */
/* ==================================================================== */

/** 16 kryptografisch zufällige Bits – 0 = links, 1 = rechts. */
export function drawPath(random = cryptoBits) {
  return random(ROWS);
}

/** Liefert `count` Zufallsbits aus dem kryptografischen Zufallsgenerator. */
function cryptoBits(count) {
  const out = new Array(count);
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const buf = new Uint8Array(count);
    c.getRandomValues(buf);
    for (let i = 0; i < count; i++) out[i] = buf[i] & 1;
    return out;
  }
  for (let i = 0; i < count; i++) out[i] = Math.random() < 0.5 ? 0 : 1;
  return out;
}

/**
 * Das Feld, in dem ein Weg endet: die Anzahl der Ablenkungen nach rechts.
 * Dadurch liegt das Ergebnis immer zwischen 0 und 16 – nie daneben.
 */
export const slotOfPath = (path) => path.reduce((sum, step) => sum + (step ? 1 : 0), 0);

/** Auszahlung eines Treffers – immer auf volle Euro abgerundet. */
export const plinkoPayout = (bet, multiplier) => Math.floor(bet * multiplier);

/** 1.4 -> "1,4×"  ·  10000 -> "10.000×" */
export const fmtPlinkoMult = (m) =>
  `${Number(m).toLocaleString('de-DE', { maximumFractionDigits: 2 })}×`;

/** Kurzform für die schmalen Felder unter dem Brett: 10000 -> "10k×" */
export function fmtSlot(m) {
  const v = Number(m);
  if (v >= 1000) {
    const k = v / 1000;
    return `${k.toLocaleString('de-DE', { maximumFractionDigits: 1 })}k×`;
  }
  return `${v.toLocaleString('de-DE', { maximumFractionDigits: 2 })}×`;
}

/* ==================================================================== */
/* Spielfeld – feste Struktur                                            */
/* ==================================================================== */

/**
 * Die Stiftpyramide ist fest verdrahtet und wird NIE zufällig erzeugt:
 * Reihe `r` hat `r + 3` Stifte, Reihe 0 also 3 und Reihe 15 genau 18.
 * 18 Stifte lassen 17 Lücken – das sind die 17 Multiplikatorfelder.
 *
 * Die Schwierigkeit ändert ausschließlich die Multiplikatoren unten;
 * an der Pyramide ändert sie nichts. Auf kleinen Bildschirmen wird das
 * Muster nur proportional kleiner, nie anders angeordnet.
 */
export const pinsInRow = (r) => r + 3;

/** Gesamtzahl der Stifte – rein zur Kontrolle in den Tests. */
export const PIN_COUNT = Array.from({ length: ROWS }, (_, r) => pinsInRow(r))
  .reduce((a, b) => a + b, 0);

/**
 * Alle Maße des Bretts aus der verfügbaren Fläche. Reine Rechnung ohne DOM,
 * damit die Tests dieselbe Geometrie prüfen können, die der Browser sieht.
 *
 *   s        Abstand zweier Stifte derselben Reihe (= Breite eines Feldes)
 *   rowGap   senkrechter Abstand der Reihen (Dreiecksgitter: s · √3/2)
 *   hitR     Berührabstand Kugelmitte ↔ Stiftmitte (Stift + Kugel)
 *   padX     Rand links und rechts; die Multiplikatorleiste bekommt ihn auch
 */
export function plinkoGeometry(width, height) {
  const W = Math.max(120, Number(width) || 0);
  const H = Math.max(120, Number(height) || 0);
  const edge = Math.max(4, Math.min(10, W * 0.018));
  const sByWidth = (W - 2 * edge) / SLOTS;
  const sByHeight = H / 15.25;
  const s = Math.max(8, Math.min(sByWidth, sByHeight));
  const rowGap = s * 0.866;                       // gleichseitiges Dreiecksgitter
  // Stift und Kugel zusammen bleiben schmaler als eine Stiftweite – sonst
  // käme die Kugel gar nicht erst zwischen zwei Stiften hindurch.
  const pinR = Math.max(2, Math.min(s * 0.145, 8));
  const ballR = Math.max(4.5, Math.min(s * 0.29, 16));
  const dropZone = rowGap * 1.35;
  const topPad = ballR + rowGap;
  const used = topPad + (ROWS - 1) * rowGap + dropZone;
  // Das Brett hängt unten am Rand: die Kugel sinkt genau dort aus dem Bild,
  // wo darunter ihr Multiplikatorfeld beginnt.
  const offsetY = Math.max(0, H - used);
  return {
    W, H, s, rowGap, pinR, ballR,
    hitR: pinR + ballR,
    padX: Math.max(0, (W - SLOTS * s) / 2),
    cx: W / 2,
    top: offsetY + topPad,
    dropZone,
    bottom: offsetY + topPad + (ROWS - 1) * rowGap + dropZone
  };
}

/** Mittelpunkt des Stiftes `i` in Reihe `r`. */
export const pinX = (geo, r, i) => geo.cx + (i - (r + 2) / 2) * geo.s;
export const rowY = (geo, r) => geo.top + r * geo.rowGap;

/** Mitte des Multiplikatorfeldes `k` (0…16). */
export const slotCenterX = (geo, k) => geo.cx + (k - (SLOTS - 1) / 2) * geo.s;

/* ==================================================================== */
/* Physik                                                                */
/* ==================================================================== */

/**
 * Die Kugel wird wirklich Schritt für Schritt gerechnet: Schwerkraft,
 * Geschwindigkeit, Kollisionsradius, Abprall mit Dämpfung und Reibung.
 * Sie kann deshalb nicht durch einen Stift laufen oder in ihm stecken
 * bleiben – bei jedem Kontakt wird sie exakt auf die Stiftoberfläche
 * gesetzt und ihre Geschwindigkeit an der Berührnormalen gespiegelt.
 *
 * Damit das Ergebnis trotzdem exakt dem vorher gezogenen Weg entspricht,
 * wird an der jeweils fälligen Stiftreihe die Auftreffseite auf die
 * vorbestimmte Seite gedreht – aber nur so weit wie nötig (CONTACT_MIN).
 * Liegt die Kugel ohnehin schon richtig, bleibt die echte Normale stehen.
 * Sichtbar ist dadurch immer: fallen → auftreffen → abprallen → weiterfallen.
 */

/** Schwerkraft in Reihenabständen pro Sekunde². Bestimmt das Fall-Tempo. */
export const GRAVITY_ROWS = 110;

/** Wie viel Schwung ein Abprall senkrecht zur Oberfläche behält. */
export const RESTITUTION = 0.44;

/** Reibung entlang der Stiftoberfläche. */
export const TANGENT_LOSS = 0.2;

/** Luftwiderstand auf die Seitwärtsbewegung (dämpft Zittern). */
export const AIR_DRAG = 0.7;

/** Seitlicher Mindestimpuls beim Abprall, in Stiftweiten pro Sekunde. */
export const SIDE_KICK = 0.3;

/** Federkraft, die die Kugel auf ihrer Spur hält. */
export const GUIDE = 14;

/** Kleinster und größter Auftreffwinkel gegenüber der Senkrechten (Bogenmaß). */
export const CONTACT_MIN = 0.32;    // ≈ 18°
export const CONTACT_MAX = 1.15;    // ≈ 66°

/** Länge eines Rechenschritts und Obergrenze je Bild. */
export const SUB_DT = 1 / 240;
export const MAX_FRAME_S = 1 / 24;

/**
 * Neue Kugel über der Spitze der Pyramide.
 * `path` sind die 16 vorher gezogenen Entscheidungen (0 = links, 1 = rechts).
 */
export function createBallState(geo, path) {
  // Sollspalte nach k Entscheidungen, in Stiftweiten von der Mitte aus.
  const offsets = new Array(ROWS + 1);
  let rights = 0;
  offsets[0] = 0;
  for (let k = 1; k <= ROWS; k++) {
    rights += path[k - 1] ? 1 : 0;
    offsets[k] = rights - k / 2;
  }
  return {
    path, offsets,
    x: geo.cx,
    y: geo.top - geo.rowGap * 0.95,
    vx: 0,
    vy: geo.rowGap * 1.1,
    row: 0,                 // nächste Reihe, die eine Entscheidung bringt
    contacts: [],           // Treffer seit dem letzten Auslesen (für Klang/Blitz)
    hits: 0
  };
}

/** x-Wert, auf den die Kugel gerade zusteuert. */
export function targetX(geo, ball) {
  const k = Math.min(ball.row, ROWS);
  return geo.cx + ball.offsets[k] * geo.s;
}

/**
 * Ein Rechenschritt.
 * @returns {boolean} true, sobald die Kugel unten angekommen ist.
 */
export function advanceBall(geo, ball, dt) {
  const gravity = GRAVITY_ROWS * geo.rowGap;
  const landed = ball.row >= ROWS;

  // sanfte Führung auf die Spur; nach dem letzten Stift etwas kräftiger,
  // damit die Kugel sicher in ihrem Feld ankommt
  const pull = (targetX(geo, ball) - ball.x) * (landed ? GUIDE * 2.6 : GUIDE);
  ball.vx += pull * dt;
  ball.vx -= ball.vx * AIR_DRAG * dt;
  ball.vy += gravity * dt;

  // Seitentempo begrenzen: sonst schießt die Kugel über den nächsten Stift
  // hinweg, statt ihn zu treffen.
  const vxMax = geo.s * 3.2;
  if (ball.vx > vxMax) ball.vx = vxMax;
  if (ball.vx < -vxMax) ball.vx = -vxMax;

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  resolvePins(geo, ball);

  // Sicherheitsnetz: sollte die Kugel eine Reihe ohne Kontakt passiert haben,
  // gilt die Entscheidung trotzdem als getroffen. Sonst liefe die Führung
  // einer längst vergangenen Reihe hinterher.
  while (ball.row < ROWS && ball.y > rowY(geo, ball.row) + geo.rowGap * 0.55) {
    ball.row += 1;
  }

  // Nach dem letzten Stift darf die Kugel ihr Feld nicht mehr verlassen.
  // Erst unterhalb der letzten Stiftreihe – sonst würde die Begrenzung die
  // Kugel seitlich in einen Stift schieben.
  if (ball.row >= ROWS && ball.y > rowY(geo, ROWS - 1) + geo.hitR) {
    const centre = slotCenterX(geo, slotOfPath(ball.path));
    const limit = geo.s * 0.42;
    if (ball.x < centre - limit) { ball.x = centre - limit; ball.vx = Math.abs(ball.vx) * 0.35; }
    if (ball.x > centre + limit) { ball.x = centre + limit; ball.vx = -Math.abs(ball.vx) * 0.35; }
  }

  return ball.y >= geo.bottom;
}

/**
 * Sucht die tiefste Überschneidung mit einem Stift und löst sie auf.
 * Immer nur eine pro Durchgang – sonst könnte das Freisetzen vom einen Stift
 * die Kugel in den nächsten schieben. Drei Durchgänge reichen auch dann,
 * wenn die Kugel genau zwischen zwei Stifte gerät.
 */
function resolvePins(geo, ball) {
  for (let pass = 0; pass < 3; pass++) {
    let best = null;
    const approx = Math.floor((ball.y - geo.top) / geo.rowGap);
    const first = Math.max(0, approx - 1);
    const last = Math.min(ROWS - 1, approx + 1);
    for (let r = first; r <= last; r++) {
      const py = rowY(geo, r);
      if (Math.abs(ball.y - py) > geo.hitR) continue;
      const rel = (ball.x - geo.cx) / geo.s + (r + 2) / 2;
      const i0 = Math.max(0, Math.floor(rel) - 1);
      const i1 = Math.min(r + 2, Math.floor(rel) + 2);
      for (let i = i0; i <= i1; i++) {
        const px = pinX(geo, r, i);
        const dx = ball.x - px;
        const dy = ball.y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 >= geo.hitR * geo.hitR) continue;
        // die fällige Reihe hat Vorrang, sonst die tiefste Überschneidung
        const score = (r === ball.row ? 1e6 : 0) + (geo.hitR * geo.hitR - d2);
        if (!best || score > best.score) {
          best = { score, r, i, px, py, dx, dy, dist: Math.sqrt(d2) };
        }
      }
    }
    if (!best) return;
    bounceOffPin(geo, ball, best.r, best.i, best.px, best.py, best.dx, best.dy, best.dist);
  }
}

/** Ein einzelner Stiftkontakt. */
function bounceOffPin(geo, ball, row, index, px, py, dx, dy, dist) {
  const decisive = row === ball.row;
  const dir = decisive ? (ball.path[row] ? 1 : -1) : 0;

  // Winkel des Berührpunktes; 0 = Kugel genau über dem Stift,
  // positiv = rechte Schulter, negativ = linke Schulter.
  let angle = dist > 1e-6 ? Math.atan2(dx, -dy) : 0;
  if (decisive) {
    // nur so weit drehen, bis die Kugel sicher auf der richtigen Schulter
    // liegt – sitzt sie schon dort, bleibt die echte Normale stehen.
    // Die Begrenzung gilt NUR hier: streift die Kugel später beim
    // Vorbeifallen die Flanke, muss sie zur Seite weg dürfen und nicht
    // nach oben zurückgesetzt werden.
    angle = dir > 0 ? Math.max(angle, CONTACT_MIN) : Math.min(angle, -CONTACT_MIN);
    angle = Math.max(-CONTACT_MAX, Math.min(CONTACT_MAX, angle));
  }

  const nx = Math.sin(angle);
  const ny = -Math.cos(angle);

  // Die Kugel wird exakt auf die Stiftoberfläche gesetzt: kein Stecken,
  // kein Durchrutschen, kein Auftauchen auf der anderen Seite.
  ball.x = px + nx * geo.hitR;
  ball.y = py + ny * geo.hitR;

  const vn = ball.vx * nx + ball.vy * ny;
  if (vn < 0) {
    // Anteil senkrecht zur Oberfläche umkehren und dämpfen
    ball.vx -= (1 + RESTITUTION) * vn * nx;
    ball.vy -= (1 + RESTITUTION) * vn * ny;
    // Reibung entlang der Oberfläche
    const tx = -ny;
    const ty = nx;
    const vt = ball.vx * tx + ball.vy * ty;
    ball.vx -= vt * TANGENT_LOSS * tx;
    ball.vy -= vt * TANGENT_LOSS * ty;
  }

  if (decisive) {
    // sichtbarer Schubs zur Seite – die Kugel läuft nicht einfach weiter geradeaus
    ball.vx = dir * Math.max(Math.abs(ball.vx), SIDE_KICK * geo.s);
    ball.row += 1;
    ball.hits += 1;
    ball.contacts.push({ row, index });
  }
}

/**
 * Rechnet eine ganze Kugel durch (nur für Tests und zum Abstimmen der Werte).
 * @returns {{slot:number, seconds:number, minGap:number, hits:number}}
 */
export function simulateBall(geo, path, maxSeconds = 20) {
  const ball = createBallState(geo, path);
  let t = 0;
  let minGap = Infinity;
  while (t < maxSeconds) {
    const done = advanceBall(geo, ball, SUB_DT);
    t += SUB_DT;
    // kleinster Abstand zu irgendeinem Stift – darf nie unter hitR fallen
    const approx = Math.floor((ball.y - geo.top) / geo.rowGap);
    for (let r = Math.max(0, approx - 1); r <= Math.min(ROWS - 1, approx + 1); r++) {
      const py = rowY(geo, r);
      for (let i = 0; i <= r + 2; i++) {
        const dx = ball.x - pinX(geo, r, i);
        const dy = ball.y - py;
        minGap = Math.min(minGap, Math.hypot(dx, dy) - geo.hitR);
      }
    }
    if (done) break;
  }
  const slot = Math.round((ball.x - geo.cx) / geo.s + (SLOTS - 1) / 2);
  return { slot, seconds: t, minGap, hits: ball.hits, x: ball.x };
}

/* ==================================================================== */
/* Spiel                                                                 */
/* ==================================================================== */

/** Startwerte der spielinternen Statistik. */
const STAT_DEFAULTS = {
  balls: 0, hits: 0, misses: 0,
  bestMultiplier: 0, bestPayout: 0, recent: []
};

/** Wie viele vergangene Kugeln in der Leiste stehen. */
const RECENT_MAX = 14;

/** Mehr Kugeln gleichzeitig bringen optisch nichts und kosten nur Leistung. */
export const MAX_ACTIVE_BALLS = 40;

/**
 * @param {object} api  Schnittstelle zur App – dieselbe wie bei Mines,
 *   Blackjack und Crash:
 *   available() · spend(n) · credit(n) · persist() · paintBalance()
 *   recordRound(entry) · gameStats(key, defaults) · getPref/setPref
 *   toast(msg, kind) · sound
 */
export function createPlinko(api) {
  const $ = (sel) => document.querySelector(sel);

  const state = {
    risk: DEFAULT_RISK,
    bet: null,
    chip: null,
    lastPayout: null,
    lastNet: 0
  };

  /** Alle Kugeln, die gerade fallen. Jede hat ihre eigene Nummer. */
  const balls = [];
  let ballSeq = 0;
  let board = null;
  let raf = null;

  /* ---------------- Speichern ohne Stau ---------------- */

  // Bei zehn Kugeln gleichzeitig darf nicht zehnmal parallel gespeichert
  // werden. Deshalb läuft immer höchstens ein Speichervorgang; fällt in der
  // Zwischenzeit etwas an, wird genau einmal nachgespeichert.
  let persistBusy = false;
  let persistAgain = false;

  async function schedulePersist() {
    if (persistBusy) { persistAgain = true; return; }
    persistBusy = true;
    try {
      await api.persist();
    } finally {
      persistBusy = false;
      if (persistAgain) { persistAgain = false; schedulePersist(); }
    }
  }

  /* ---------------- Einsatzleiste ---------------- */

  const betAmountOf = (chip) => (chip === MAX_CHIP ? maxBetFor(api.available()) : chip);

  function buildChipRow() {
    const host = $('#plinko-chips');
    if (!host) return;
    host.innerHTML = '';
    for (const value of CHIPS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `chip chip-c${value}`;
      btn.dataset.value = String(value);
      btn.textContent = value >= 1000 ? `${value / 1000}k €` : `${value} €`;
      btn.setAttribute('aria-label', `Einsatz ${value} Euro`);
      btn.onclick = () => selectChip(value);
      host.appendChild(btn);
    }
    const max = document.createElement('button');
    max.type = 'button';
    max.className = 'chip chip-max';
    max.dataset.value = MAX_CHIP;
    max.setAttribute('aria-label', 'Maximalen Einsatz wählen');
    max.innerHTML = '<b>MAX</b><small>—</small>';
    max.onclick = () => selectChip(MAX_CHIP);
    host.appendChild(max);
  }

  function selectChip(chip) {
    const amount = betAmountOf(chip);
    if (amount <= 0) { api.toast('Dein Guthaben ist aufgebraucht.', 'warn'); return; }
    if (amount > api.available()) { api.toast('Dafür reicht dein Guthaben nicht.', 'warn'); return; }
    state.chip = chip;
    state.bet = amount;
    api.sound.chip();
    render();
  }

  function applyCustomBet() {
    const input = $('#plinko-custom');
    if (!input) return;
    const value = Math.floor(Number(input.value));
    if (!Number.isFinite(value) || value <= 0) {
      api.toast('Bitte einen Betrag größer als 0 eingeben.', 'warn');
      return;
    }
    if (value > MAX_BET) { api.toast(`Maximal ${money(MAX_BET)} pro Kugel.`, 'warn'); return; }
    if (value > api.available()) { api.toast('Dafür reicht dein Guthaben nicht.', 'warn'); return; }
    state.chip = value;
    state.bet = value;
    input.value = '';
    api.sound.chip();
    render();
  }

  /* ---------------- Schwierigkeit ---------------- */

  function buildRiskRow() {
    const host = $('#plinko-risks');
    if (!host) return;
    host.innerHTML = '';
    for (const risk of RISKS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'risk-option';
      btn.dataset.risk = risk.id;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      btn.textContent = risk.label;
      btn.onclick = () => selectRisk(risk.id);
      host.appendChild(btn);
    }
  }

  function selectRisk(id) {
    const risk = riskById(id);
    if (!risk || state.risk === risk.id) return;
    state.risk = risk.id;
    if (api.setPref) api.setPref('plinkoRisk', risk.id);
    api.sound.chip();
    renderSlots();
    // Die Stiftpyramide bleibt unverändert – nur die Felder unten wechseln.
    board?.redraw(balls);
    render();
  }

  /* ---------------- Kugeln ---------------- */

  const canStart = () => state.bet > 0 && state.bet <= api.available();

  /**
   * Startet eine Kugel. Der Einsatz wird sofort abgebucht, das Ergebnis steht
   * sofort fest, ausgezahlt wird erst beim Landen. Jede Kugel bekommt eine
   * eigene Nummer und ein eigenes `paid`-Kennzeichen – dadurch kann keine
   * Kugel doppelt auszahlen, egal wie schnell geklickt wird.
   */
  function launchBall() {
    if (!canStart()) return null;
    if (balls.length >= MAX_ACTIVE_BALLS) {
      api.toast('Es sind schon genug Kugeln unterwegs.', 'warn');
      return null;
    }

    // Momentaufnahme: spätere Änderungen an Einsatz oder Stufe gelten erst
    // für die nächste Kugel.
    const bet = state.bet;
    const riskId = state.risk;
    if (!(bet > 0) || bet > api.available()) return null;

    const path = drawPath();
    const slot = slotOfPath(path);
    const multiplier = tableFor(riskId)[slot];

    api.spend(bet);
    api.paintBalance();

    const now = performance.now();
    const ball = {
      id: ++ballSeq,
      bet, risk: riskId, path, slot, multiplier,
      paid: false,
      startedAt: now,
      lastTime: now,
      r: 0,
      // Startzustand der Physik: Ort, Geschwindigkeit, Sollspur
      ...(board ? board.spawn(path) : { x: 0, y: 0, vx: 0, vy: 0, row: 0, offsets: [], contacts: [], hits: 0 })
    };
    balls.push(ball);

    api.sound.chip();
    schedulePersist();
    render();
    startLoop();
    return ball;
  }

  /**
   * Landung einer Kugel. Läuft für jede Kugel genau einmal – `paid` sperrt
   * jeden zweiten Aufruf, auch wenn zwei Kugeln im selben Bild landen.
   */
  function settle(ball) {
    if (ball.paid) return;
    ball.paid = true;

    const payout = plinkoPayout(ball.bet, ball.multiplier);
    const net = payout - ball.bet;
    if (payout > 0) api.credit(payout);
    api.paintBalance();

    const stats = api.gameStats('plinko', STAT_DEFAULTS);
    stats.balls += 1;
    if (net > 0) stats.hits += 1; else stats.misses += 1;
    stats.bestMultiplier = Math.max(stats.bestMultiplier || 0, ball.multiplier);
    stats.bestPayout = Math.max(stats.bestPayout || 0, payout);
    stats.recent = [{ m: ball.multiplier, risk: ball.risk },
      ...(Array.isArray(stats.recent) ? stats.recent : [])].slice(0, RECENT_MAX);

    api.recordRound({
      game: 'plinko',
      staked: ball.bet,
      net,
      risk: ball.risk,
      slot: ball.slot,
      multiplier: ball.multiplier,
      payout
    });

    state.lastPayout = payout;
    state.lastNet = net;
    flashSlot(ball.slot, net > 0);
    showResult(ball, payout, net);
    ping(net > 0 ? 'win' : 'land');
    renderRecent();
    renderStats();
    render();
    schedulePersist();
  }

  /** Zahlt alle noch fliegenden Kugeln sofort aus – nichts geht verloren. */
  function flushBalls() {
    if (!balls.length) return;
    for (const ball of [...balls]) settle(ball);
    balls.length = 0;
    stopLoop();
    render();
  }

  /* ---------------- Animationsschleife ---------------- */

  function startLoop() {
    if (raf !== null) return;
    raf = requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
  }

  function frame() {
    raf = null;
    const now = performance.now();
    let alive = false;
    let hitSomething = false;

    for (let i = balls.length - 1; i >= 0; i--) {
      const ball = balls[i];
      const done = board ? board.step(ball, now) : true;
      // Stiftkontakte dieses Bildes: Blitz und Klang
      if (ball.contacts && ball.contacts.length) {
        for (const contact of ball.contacts) board?.flashPin(contact.row, contact.index, now);
        ball.contacts.length = 0;
        hitSomething = true;
      }
      if (done) {
        settle(ball);
        balls.splice(i, 1);
      } else {
        alive = true;
      }
    }
    if (hitSomething) ping('pin');

    board?.draw(balls, now);
    paintLive();

    if (alive || board?.needsFrame(now)) raf = requestAnimationFrame(frame);
  }

  /* ---------------- Klang, sparsam dosiert ---------------- */

  let lastPing = 0;
  function ping(kind) {
    const now = performance.now();
    if (kind === 'pin') {
      if (now - lastPing < 70) return;
      lastPing = now;
      api.sound.tick(0.3);
      return;
    }
    if (kind === 'win') api.sound.win();
    else api.sound.remove();
  }

  /* ---------------- Anzeige ---------------- */

  /** Farbe eines Feldes: außen kräftig, zur Mitte hin ruhig. */
  function slotColor(index) {
    const t = Math.abs(index - (SLOTS - 1) / 2) / ((SLOTS - 1) / 2);
    const css = getComputedStyle(document.documentElement);
    const low = css.getPropertyValue('--plinko-slot-low').trim() || '#2f6d4c';
    const mid = css.getPropertyValue('--plinko-slot-mid').trim() || '#b8862c';
    const high = css.getPropertyValue('--plinko-slot-high').trim() || '#b32127';
    return t < 0.5 ? mixHex(low, mid, t * 2) : mixHex(mid, high, (t - 0.5) * 2);
  }

  function renderSlots() {
    const host = $('#plinko-slots');
    if (!host) return;
    const table = tableFor(state.risk);
    host.innerHTML = '';
    table.forEach((m, i) => {
      const cell = document.createElement('div');
      const edge = Math.min(i, SLOTS - 1 - i);
      const label = fmtSlot(m);
      // Vier breite Zeichen (z. B. "110×") brauchen etwas kleinere Schrift,
      // damit sie auch auf dem Handy vollständig ins Feld passen.
      const wide = label.replace(/,/g, '').length >= 4;
      cell.className = `plinko-slot${edge <= 1 ? ' is-top' : ''}${wide ? ' is-wide' : ''}`;
      cell.dataset.slot = String(i);
      cell.style.setProperty('--slot-c', slotColor(i));
      cell.textContent = label;
      cell.title = `${fmtPlinkoMult(m)} – Feld ${i + 1} von ${SLOTS}`;
      host.appendChild(cell);
    });
  }

  /** Kurzes Aufleuchten des getroffenen Feldes. */
  function flashSlot(index, won) {
    const cell = document.querySelector(`#plinko-slots .plinko-slot[data-slot="${index}"]`);
    if (!cell) return;
    cell.classList.remove('is-hit', 'is-win');
    void cell.offsetWidth;              // Animation neu starten
    cell.classList.add('is-hit');
    if (won) cell.classList.add('is-win');
    setTimeout(() => cell.classList.remove('is-hit', 'is-win'), 620);
  }

  function showResult(ball, payout, net) {
    const box = $('#plinko-result');
    if (!box) return;
    box.hidden = false;
    box.className = `plinko-result ${net > 0 ? 'is-win' : net === 0 ? 'is-even' : 'is-loss'}`;
    box.innerHTML = `<strong>${fmtPlinkoMult(ball.multiplier)}</strong>
      <span>${money(ball.bet)} × ${fmtPlinkoMult(ball.multiplier)} = <b>${money(payout)}</b>
        · ${riskById(ball.risk).label}</span>
      <span class="plinko-result-net">${signedMoney(net)}</span>`;
  }

  function hideResult() {
    const box = $('#plinko-result');
    if (box) box.hidden = true;
  }

  function renderRecent() {
    const host = $('#plinko-recent');
    if (!host) return;
    const stats = api.gameStats ? api.gameStats('plinko', STAT_DEFAULTS) : STAT_DEFAULTS;
    const list = Array.isArray(stats.recent) ? stats.recent : [];
    if (!list.length) {
      host.innerHTML = '<span class="plinko-recent-empty">Noch keine Kugel gefallen.</span>';
      return;
    }
    host.innerHTML = list.map((entry) => {
      const m = typeof entry === 'object' ? entry.m : entry;
      const tone = m >= 10 ? 'is-high' : m >= 1 ? 'is-mid' : 'is-low';
      return `<span class="plinko-pill ${tone}">${fmtPlinkoMult(m)}</span>`;
    }).join('');
  }

  function setStatsOpen(open, remember = true) {
    const wrap = $('#plinko-stats-wrap');
    const toggle = $('#plinko-stats-toggle');
    if (!wrap || !toggle) return;
    wrap.classList.toggle('is-open', open);
    toggle.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    wrap.setAttribute('aria-hidden', String(!open));
    if (remember && api.setPref) api.setPref('plinkoStatsOpen', open);
  }

  function toggleStats() {
    const open = $('#plinko-stats-toggle')?.getAttribute('aria-expanded') !== 'true';
    setStatsOpen(open);
    api.sound.chip();
  }

  function renderStats() {
    const host = $('#plinko-stats');
    if (!host) return;
    const s = api.gameStats ? api.gameStats('plinko', STAT_DEFAULTS) : STAT_DEFAULTS;
    const rows = [
      ['Kugeln', s.balls],
      ['Im Plus', s.hits],
      ['Im Minus', s.misses],
      ['Bester Multiplikator', s.bestMultiplier ? fmtPlinkoMult(s.bestMultiplier) : '—'],
      ['Höchste Auszahlung', money(s.bestPayout || 0)]
    ];
    host.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  }

  function paintLive() {
    const active = $('#plinko-active');
    if (active) active.textContent = String(balls.length);
    const last = $('#plinko-last');
    if (last) {
      last.textContent = state.lastPayout === null ? '—' : money(state.lastPayout);
      last.classList.toggle('is-win', state.lastNet > 0);
      last.classList.toggle('is-zero', state.lastPayout === 0);
    }
  }

  function render() {
    if (!$('#plinko-canvas')) return;

    for (const chip of document.querySelectorAll('#plinko-chips .chip')) {
      const isMax = chip.dataset.value === MAX_CHIP;
      const value = isMax ? maxBetFor(api.available()) : Number(chip.dataset.value);
      chip.disabled = value <= 0 || value > api.available();
      chip.classList.toggle('is-active', state.chip !== null &&
        (isMax ? state.chip === MAX_CHIP : value === state.chip));
      if (isMax) {
        const label = chip.querySelector('small');
        if (label) label.textContent = money(Math.max(0, value));
      }
    }

    for (const btn of document.querySelectorAll('#plinko-risks .risk-option')) {
      const on = btn.dataset.risk === state.risk;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-checked', String(on));
    }
    const riskText = $('#plinko-risk-text');
    if (riskText) riskText.textContent = riskById(state.risk).blurb;

    for (const el of document.querySelectorAll('[data-plinko-bet]')) {
      el.textContent = state.bet ? money(state.bet) : '—';
    }

    // Der Startknopf bleibt frei, solange das Guthaben reicht – auch dann,
    // wenn schon Kugeln unterwegs sind.
    const start = $('#plinko-start');
    if (start) start.disabled = !canStart();

    const hint = $('#plinko-hint');
    if (hint) {
      hint.textContent = !state.bet ? 'Wähle einen Einsatz.'
        : api.available() <= 0 ? 'Kein Guthaben mehr – laufende Kugeln zahlen noch aus.'
        : state.bet > api.available() ? 'Einsatz höher als dein Guthaben.'
        : balls.length ? `${balls.length} Kugel${balls.length === 1 ? '' : 'n'} unterwegs – du kannst weiter starten.`
        : 'Bereit – so oft starten, wie du magst.';
    }

    const stage = $('#plinko-stage');
    if (stage) stage.classList.toggle('is-live', balls.length > 0);

    paintLive();
  }

  /* ---------------- Aufbau ---------------- */

  function init() {
    const canvas = $('#plinko-canvas');
    if (!canvas) return;
    buildRiskRow();
    buildChipRow();
    state.risk = safeRiskId(api.getPref ? api.getPref('plinkoRisk', DEFAULT_RISK) : DEFAULT_RISK);
    board = createPlinkoBoard(canvas, {
      // Das Brett muss die fliegenden Kugeln kennen: beim Größenwechsel
      // rechnet es sie mit um und zeichnet sie sofort wieder mit.
      balls: () => balls,
      onGeometry: (pad) => {
        const host = $('#plinko-board');
        if (host) host.style.setProperty('--plinko-pad', `${pad}px`);
      }
    });
    renderSlots();
    board.redraw(balls);

    $('#plinko-start').addEventListener('click', launchBall);
    $('#plinko-custom-btn').addEventListener('click', applyCustomBet);
    $('#plinko-custom').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCustomBet(); });
    setStatsOpen(api.getPref ? Boolean(api.getPref('plinkoStatsOpen', false)) : false, false);
    $('#plinko-stats-toggle')?.addEventListener('click', toggleStats);

    // Wird die Seite geschlossen oder in den Hintergrund geschoben, werden
    // fliegende Kugeln sofort abgerechnet. So kann kein Gewinn verloren gehen.
    window.addEventListener('pagehide', flushBalls);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushBalls();
    });

    render();
    renderRecent();
    renderStats();
  }

  return {
    init,
    render() {
      renderSlots();
      render();
      renderRecent();
      renderStats();
      // Farben neu einlesen, Maße prüfen und das Brett sofort zeichnen –
      // die Pyramide ist dadurch beim Öffnen, nach jedem Designwechsel und
      // nach jedem Wechsel der Schwierigkeit vollständig sichtbar.
      board?.refresh(balls);
    },

    /** Plinko hat keine offene Runde – aber fliegende Kugeln zahlen sofort aus. */
    isLive: () => false,
    async abandon() {
      flushBalls();
      await schedulePersist();
    },
    flush: flushBalls,

    /** Diagnose für die automatisierten Tests */
    debug: () => ({
      risk: state.risk,
      bet: state.bet,
      active: balls.length,
      canStart: canStart(),
      lastPayout: state.lastPayout,
      table: tableFor(state.risk),
      rtp: rtpOf(tableFor(state.risk)),
      pins: PIN_COUNT,
      geometry: board?.geometry() || null,
      balls: balls.map((b) => ({
        id: b.id, bet: b.bet, slot: b.slot, multiplier: b.multiplier, paid: b.paid,
        x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10,
        vy: Math.round(b.vy), row: b.row, hits: b.hits
      }))
    }),

    /** Nur für Tests: der Live-Zustand aller fliegenden Kugeln. */
    __balls: () => balls,

    /** Nur für Tests: eine Kugel mit vorgegebenem Weg. */
    __launchWithPath(path) {
      const ball = launchBall();
      if (!ball || !Array.isArray(path) || path.length !== ROWS) return ball;
      ball.path = path.map((v) => (v ? 1 : 0));
      ball.slot = slotOfPath(ball.path);
      ball.multiplier = tableFor(ball.risk)[ball.slot];
      return ball;
    }
  };
}

/* ==================================================================== */
/* Brett                                                                 */
/* ==================================================================== */

/** "#a1b2c3" -> [161, 178, 195] */
function hexToRgb(hex) {
  const h = String(hex).trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mischt zwei Hexfarben; t = 0 gibt `a`, t = 1 gibt `b`. */
export function mixHex(a, b, t) {
  const p = Math.min(1, Math.max(0, t));
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const mix = (x, y) => Math.round(x + (y - x) * p);
  return `rgb(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)})`;
}

/** Farben aus dem aktiven Theme lesen – wie beim Rad und beim Crash-Graphen. */
function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const pick = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
  return {
    felt1: pick('--plinko-felt-1', '#0e2a1c'),
    felt2: pick('--plinko-felt-2', '#050f08'),
    pin: pick('--plinko-pin', '#cfd8d1'),
    pinHi: pick('--plinko-pin-hi', '#ffffff'),
    pinRing: pick('--plinko-pin-ring', 'rgba(0,0,0,.45)'),
    ball: pick('--plinko-ball', '#f0cf86'),
    ballHi: pick('--plinko-ball-hi', '#fffaf0'),
    ballEdge: pick('--plinko-ball-edge', '#7d6534')
  };
}

/**
 * Zeichnet das Brett und lässt die Kugeln laufen.
 *
 * Das Stiftmuster ist fest: es ergibt sich allein aus `plinkoGeometry()` und
 * `pinX()/rowY()`, wird also bei jeder Größe identisch angeordnet und nie
 * zufällig erzeugt. Nach jeder Größenänderung wird sofort neu gezeichnet –
 * die Pyramide ist damit vom ersten Moment an sichtbar, auch bevor die erste
 * Kugel fällt.
 */
export function createPlinkoBoard(canvas, hooks = {}) {
  if (!canvas || !canvas.getContext) return null;
  const ctx = canvas.getContext('2d');
  let palette = readPalette();
  let geo = null;
  const pinHits = new Map();          // "reihe:nummer" -> Zeitpunkt

  /** Fläche vermessen, Maße neu bestimmen und sofort zeichnen. */
  function measure() {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(200, rect.width || 640);
    const cssH = Math.max(200, rect.height || 560);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const next = plinkoGeometry(cssW, cssH);
    const balls = hooks.balls ? hooks.balls() : [];
    if (geo && balls.length) rescaleBalls(balls, geo, next);
    geo = next;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hooks.onGeometry?.(geo.padX);
    // Wichtig: canvas.width zu setzen löscht das Bild. Ohne dieses Zeichnen
    // wäre das Brett nach jeder Größenänderung leer.
    draw(balls, performance.now());
  }

  /** Fliegende Kugeln beim Größenwechsel maßstabsgerecht mitnehmen. */
  function rescaleBalls(balls, from, to) {
    const fx = to.s / from.s;
    const fy = to.rowGap / from.rowGap;
    for (const ball of balls) {
      if (typeof ball.x !== 'number') continue;
      ball.x = to.cx + (ball.x - from.cx) * fx;
      ball.y = to.top + (ball.y - from.top) * fy;
      ball.vx *= fx;
      ball.vy *= fy;
    }
  }

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(canvas);
  window.addEventListener('resize', measure);
  measure();

  /** Neue Kugel: Startzustand für den vorgegebenen Weg. */
  function spawn(path) {
    return createBallState(geo || plinkoGeometry(640, 560), path);
  }

  /**
   * Rechnet eine Kugel bis zum Zeitpunkt `now` weiter – in festen kleinen
   * Schritten, damit die Kollisionen unabhängig von der Bildrate immer
   * gleich ausfallen.
   * @returns {boolean} true, sobald sie unten angekommen ist.
   */
  function step(ball, now) {
    if (!geo) return true;
    if (!ball.lastTime) ball.lastTime = now;
    let remaining = Math.min((now - ball.lastTime) / 1000, MAX_FRAME_S);
    ball.lastTime = now;
    let done = false;
    while (remaining > 1e-6 && !done) {
      const dt = Math.min(SUB_DT, remaining);
      remaining -= dt;
      done = advanceBall(geo, ball, dt);
    }
    ball.r = geo.ballR;
    return done;
  }

  /** Merkt sich einen Stifttreffer für das kurze Aufblitzen. */
  function flashPin(row, index, at) {
    pinHits.set(`${row}:${index}`, at);
  }

  /** Läuft noch eine Blitz-Animation? */
  function needsFrame(now) {
    for (const at of pinHits.values()) if (now - at < 240) return true;
    return false;
  }

  function draw(balls, now = performance.now()) {
    if (!ctx || !geo) return;
    const { W, H } = geo;
    ctx.clearRect(0, 0, W, H);

    /* Hintergrund */
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, palette.felt1);
    bg.addColorStop(1, palette.felt2);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    /* Stifte – feste Pyramide, Reihe r hat r + 3 Stifte */
    for (let r = 0; r < ROWS; r++) {
      const y = rowY(geo, r);
      for (let i = 0; i < pinsInRow(r); i++) {
        const x = pinX(geo, r, i);
        const at = pinHits.get(`${r}:${i}`);
        const age = at ? now - at : Infinity;
        const flash = age < 240 ? 1 - age / 240 : 0;
        const radius = geo.pinR * (1 + flash * 0.45);

        if (flash > 0) {
          const halo = ctx.createRadialGradient(x, y, radius, x, y, radius * 3.4);
          halo.addColorStop(0, withAlpha(palette.pinHi, 0.34 * flash));
          halo.addColorStop(1, withAlpha(palette.pinHi, 0));
          ctx.beginPath();
          ctx.arc(x, y, radius * 3.4, 0, Math.PI * 2);
          ctx.fillStyle = halo;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = palette.pin;
        ctx.fill();
        ctx.lineWidth = Math.max(0.6, geo.pinR * 0.3);
        ctx.strokeStyle = palette.pinRing;
        ctx.stroke();
        // kleines Glanzlicht oben links – die Stifte wirken dadurch rund
        ctx.beginPath();
        ctx.arc(x - radius * 0.3, y - radius * 0.32, radius * 0.36, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(palette.pinHi, 0.7);
        ctx.fill();
      }
    }

    /* Kugeln */
    for (const ball of balls) {
      if (!ball.r) continue;
      const glow = ctx.createRadialGradient(ball.x, ball.y, ball.r * 0.6, ball.x, ball.y, ball.r * 2.3);
      glow.addColorStop(0, withAlpha(palette.ball, 0.32));
      glow.addColorStop(1, withAlpha(palette.ball, 0));
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r * 2.3, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      const grad = ctx.createRadialGradient(
        ball.x - ball.r * 0.35, ball.y - ball.r * 0.4, ball.r * 0.15,
        ball.x, ball.y, ball.r
      );
      grad.addColorStop(0, palette.ballHi);
      grad.addColorStop(1, palette.ball);
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = Math.max(1, ball.r * 0.16);
      ctx.strokeStyle = palette.ballEdge;
      ctx.stroke();
    }

    // alte Treffer aufräumen, damit die Karte nicht wächst
    if (pinHits.size > 200) {
      for (const [key, at] of pinHits) if (now - at > 400) pinHits.delete(key);
    }
  }

  return {
    spawn, step, draw, needsFrame, flashPin,
    redraw(balls) { draw(balls || (hooks.balls ? hooks.balls() : []), performance.now()); },
    refresh(balls) { palette = readPalette(); measure(); },
    geometry: () => (geo ? { ...geo } : null)
  };
}

/** Setzt die Deckkraft einer Farbe – funktioniert mit Hex und rgb(). */
function withAlpha(color, alpha) {
  const c = String(color).trim();
  if (c.startsWith('#')) {
    const [r, g, b] = hexToRgb(c);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (c.startsWith('rgb(')) return c.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  return c;
}
