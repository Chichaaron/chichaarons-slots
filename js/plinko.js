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
/* Bewegung                                                              */
/* ==================================================================== */

/** Sprunghöhe an jedem Stift, gemessen am Reihenabstand. */
export const HOP = 0.16;

/**
 * Wurfparabel zwischen zwei Stiften.
 *
 * y(p) = y0 + A·p² + B·p   mit   y(0) = y0, y(1) = y0 + drop
 * und einem kleinen Aufsprung der Höhe HOP·drop kurz nach dem Stift.
 * Genau so bewegt sich eine echte Kugel: erst ein Stück nach oben
 * abprallen, dann beschleunigt nach unten fallen.
 */
export function hopCoefficients(drop, hop = HOP) {
  const h = Math.max(0, hop) * drop;
  const a = (Math.sqrt(h) + Math.sqrt(h + drop)) ** 2;
  return { a, b: drop - a };
}

/** Dauer der Reihe `r` in Millisekunden – die Kugel wird nach unten schneller. */
export const rowDuration = (r, base) => base * (1 + 0.5 / (1 + r * 0.9));

/** Gesamtdauer eines kompletten Falls (ohne das Einsinken ins Feld). */
export function totalDuration(base) {
  let ms = 0;
  for (let r = 0; r < ROWS; r++) ms += rowDuration(r, base);
  return ms;
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

/** Grundtempo pro Reihe in Millisekunden. */
const BASE_ROW_MS = 105;

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

    const ball = {
      id: ++ballSeq,
      bet, risk: riskId, path, slot, multiplier,
      paid: false,
      startedAt: performance.now(),
      seg: 0,
      segStart: 0,
      x: 0, y: 0, r: 0,
      landedAt: 0
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

    for (let i = balls.length - 1; i >= 0; i--) {
      const ball = balls[i];
      const done = board ? board.step(ball, now) : true;
      if (done) {
        settle(ball);
        balls.splice(i, 1);
      } else {
        alive = true;
      }
    }

    board?.draw(balls, now);
    paintLive();

    if (alive || board?.needsFrame(now)) raf = requestAnimationFrame(frame);
  }

  /* ---------------- Klang, sparsam dosiert ---------------- */

  let lastPing = 0;
  function ping(kind) {
    const now = performance.now();
    if (kind === 'pin') {
      if (now - lastPing < 55) return;
      lastPing = now;
      api.sound.tick(0.35);
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
      onPin: () => ping('pin'),
      onGeometry: (pad) => {
        const host = $('#plinko-board');
        if (host) host.style.setProperty('--plinko-pad', `${pad}px`);
      }
    });
    renderSlots();
    board.draw(balls, performance.now());

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
      board?.refresh();
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
      balls: balls.map((b) => ({
        id: b.id, bet: b.bet, slot: b.slot, multiplier: b.multiplier, paid: b.paid
      }))
    }),

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
 * Zeichnet Stifte und Kugeln und rechnet die Flugbahn aus.
 *
 * Geometrie: Reihe `r` hat `r + 3` Stifte im Abstand `s`. Die Kugel startet
 * mittig, wird an jedem Stift um `s/2` nach links oder rechts abgelenkt und
 * steht nach 16 Reihen genau über der Mitte ihres Feldes. Feld `k` liegt bei
 *     x = Mitte + (k − 8) · s
 * – dieselbe Formel, nach der auch die Multiplikatorleiste aufgebaut ist.
 */
export function createPlinkoBoard(canvas, hooks = {}) {
  if (!canvas || !canvas.getContext) return null;
  const ctx = canvas.getContext('2d');
  let palette = readPalette();
  let W = 0;
  let H = 0;
  let geo = null;
  const pinHits = new Map();          // "r:i" -> Zeitpunkt des Treffers

  function measure() {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(200, rect.width || 640);
    const cssH = Math.max(200, rect.height || 520);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = cssW;
    H = cssH;
    layout();
  }

  /** Alle Maße neu bestimmen, sodass das Feld immer vollständig hineinpasst. */
  function layout() {
    // Waagerecht: 17 Rutschen plus ein schmaler Rand, damit die äußersten
    // Stifte nicht am Rahmen kleben.
    const edge = Math.max(4, Math.min(10, W * 0.018));
    const sByWidth = (W - 2 * edge) / SLOTS;
    // Senkrecht: Einlauf + 15 Reihenabstände + Auslauf ins Feld, in Vielfachen
    // der Stiftweite gerechnet (ein Reihenabstand ist 0,86 Stiftweiten).
    const sByHeight = H / 15.25;
    const s = Math.max(8, Math.min(sByWidth, sByHeight));
    const rowGap = s * 0.86;
    const pinR = Math.max(2.2, Math.min(s * 0.15, 6));
    const ballR = Math.max(4, Math.min(s * 0.33, 12));
    const fieldW = SLOTS * s;
    const padX = Math.max(0, (W - fieldW) / 2);
    const dropZone = rowGap * 1.3;
    const topY = ballR + rowGap;
    const height = topY + (ROWS - 1) * rowGap + dropZone;
    // Das Brett hängt unten am Rand: die Kugel sinkt am Ende genau dort aus
    // dem Bild, wo darunter ihr Multiplikatorfeld beginnt. Übrige Höhe geht
    // nach oben – dort fällt die Kugel ein.
    const offsetY = Math.max(0, H - height);

    geo = {
      s, rowGap, pinR, ballR, padX,
      cx: W / 2,
      top: offsetY + topY,
      dropZone,
      bottom: offsetY + topY + (ROWS - 1) * rowGap + dropZone
    };
    hooks.onGeometry?.(padX);
  }

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(canvas);
  window.addEventListener('resize', measure);
  measure();

  /** Mittelpunkt des Stiftes `i` in Reihe `r`. */
  const pinX = (r, i) => geo.cx + (i - (r + 2) / 2) * geo.s;
  const rowY = (r) => geo.top + r * geo.rowGap;

  /** x-Position der Kugel, nachdem sie `r` Reihen hinter sich hat. */
  function ballX(path, r) {
    let offset = 0;
    for (let i = 0; i < r; i++) offset += path[i] ? 0.5 : -0.5;
    return geo.cx + offset * geo.s;
  }

  /** Dauer des Einlaufs von oben auf den ersten Stift. */
  const ENTRY_MS = 150;

  /**
   * Anfang und Ende eines Wegabschnitts.
   *   seg = -1        Einlauf von oben auf den mittleren Stift der ersten Reihe
   *   seg = 0…14      von Stiftreihe seg zur nächsten
   *   seg = 15        letzter Stift → hinunter ins Multiplikatorfeld
   */
  function segment(ball, seg) {
    if (seg < 0) {
      return {
        x0: geo.cx, x1: geo.cx,
        y0: geo.top - geo.rowGap, drop: geo.rowGap,
        dur: ENTRY_MS, hop: 0
      };
    }
    const last = seg === ROWS - 1;
    return {
      x0: ballX(ball.path, seg),
      x1: ballX(ball.path, seg + 1),
      y0: rowY(seg),
      drop: last ? geo.dropZone : geo.rowGap,
      dur: rowDuration(seg, BASE_ROW_MS),
      hop: HOP
    };
  }

  /**
   * Rechnet eine Kugel auf den Zeitpunkt `now` vor.
   * @returns {boolean} true, sobald sie unten angekommen ist.
   */
  function step(ball, now) {
    if (!geo) return true;
    if (ball.segStart === 0) {
      ball.segStart = ball.startedAt;
      ball.seg = -1;
    }

    // Es können mehrere Abschnitte in einem Bild vergehen (etwa nach einem
    // Tabwechsel) – deshalb in einer Schleife nachziehen.
    for (let guard = 0; guard <= ROWS + 2; guard++) {
      if (ball.seg >= ROWS) return true;
      const seg = segment(ball, ball.seg);
      const t = now - ball.segStart;

      if (t >= seg.dur) {
        ball.segStart += seg.dur;
        ball.seg += 1;
        // Beginnt gerade ein Abschnitt, ist die Kugel eben auf den Stift
        // dieser Reihe getroffen.
        if (ball.seg >= 0 && ball.seg < ROWS) hitPin(ball, ball.seg, ball.segStart);
        continue;
      }

      const p = Math.max(0, t) / seg.dur;
      const { a, b } = hopCoefficients(seg.drop, seg.hop);
      ball.x = seg.x0 + (seg.x1 - seg.x0) * p;
      ball.y = seg.y0 + a * p * p + b * p;
      ball.r = geo.ballR;
      return false;
    }
    return true;
  }

  /** Merkt sich einen Stifttreffer für das kurze Aufblitzen. */
  function hitPin(ball, row, at) {
    if (row < 0 || row >= ROWS) return;
    let rights = 0;
    for (let i = 0; i < row; i++) rights += ball.path[i] ? 1 : 0;
    pinHits.set(`${row}:${rights + 1}`, at);
    hooks.onPin?.(row);
  }

  /** Läuft noch eine Blitz-Animation? */
  function needsFrame(now) {
    for (const at of pinHits.values()) if (now - at < 260) return true;
    return false;
  }

  function draw(balls, now = performance.now()) {
    if (!ctx || !geo) return;
    ctx.clearRect(0, 0, W, H);

    /* Hintergrund */
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, palette.felt1);
    bg.addColorStop(1, palette.felt2);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    /* Stifte */
    for (let r = 0; r < ROWS; r++) {
      const y = rowY(r);
      for (let i = 0; i <= r + 2; i++) {
        const x = pinX(r, i);
        const at = pinHits.get(`${r}:${i}`);
        const age = at ? now - at : Infinity;
        const flash = age < 260 ? 1 - age / 260 : 0;
        const radius = geo.pinR * (1 + flash * 0.5);

        if (flash > 0) {
          const halo = ctx.createRadialGradient(x, y, radius, x, y, radius * 3);
          halo.addColorStop(0, withAlpha(palette.pinHi, 0.3 * flash));
          halo.addColorStop(1, withAlpha(palette.pinHi, 0));
          ctx.beginPath();
          ctx.arc(x, y, radius * 3, 0, Math.PI * 2);
          ctx.fillStyle = halo;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = palette.pin;
        ctx.fill();
        ctx.lineWidth = Math.max(0.6, geo.pinR * 0.28);
        ctx.strokeStyle = palette.pinRing;
        ctx.stroke();
        // kleines Glanzlicht oben links – die Stifte wirken dadurch rund
        ctx.beginPath();
        ctx.arc(x - radius * 0.3, y - radius * 0.32, radius * 0.36, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(palette.pinHi, 0.75);
        ctx.fill();
      }
    }

    /* Kugeln */
    for (const ball of balls) {
      if (!ball.r) continue;
      // weicher Schein, damit die Kugel auf jedem Untergrund sofort auffällt
      const glow = ctx.createRadialGradient(ball.x, ball.y, ball.r * 0.6, ball.x, ball.y, ball.r * 2.4);
      glow.addColorStop(0, withAlpha(palette.ball, 0.34));
      glow.addColorStop(1, withAlpha(palette.ball, 0));
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r * 2.4, 0, Math.PI * 2);
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
    step, draw, needsFrame,
    refresh() { palette = readPalette(); measure(); },
    geometry: () => ({ ...geo })
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
