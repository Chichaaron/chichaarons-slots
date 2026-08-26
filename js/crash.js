/**
 * CRASH – viertes Minigame der Plattform.
 *
 * Ablauf: Einsatz wählen → SPIELEN → der Multiplikator läuft immer schneller
 * nach oben → AUSZAHLEN, bevor die Kurve abstürzt.
 *
 * Wie bei Mines und Blackjack liegen Logik und Oberfläche zusammen; Guthaben,
 * Speichern und Statistik laufen ausschließlich über die von app.js übergebene
 * Schnittstelle. Die anderen Spiele bleiben unberührt.
 *
 * Der obere Teil dieser Datei ist reine Mathematik ohne DOM und wird von
 * tests/logic.test.mjs direkt geprüft.
 */
import { CHIPS, MAX_CHIP, MAX_BET, maxBetFor } from './bets.js';
import { money, signedMoney } from './roulette.js';

/* ==================================================================== */
/* Zufallssystem                                                         */
/* ==================================================================== */

/** Höchstmöglicher Multiplikator. Erreichbar, aber außergewöhnlich selten. */
export const MAX_MULTIPLIER = 50000;

/** Kleinstmöglicher Crash – die Runde kann sofort enden. */
export const MIN_MULTIPLIER = 1;

/**
 * Hausvorteil. Genau mit dieser Wahrscheinlichkeit crasht die Runde sofort
 * bei 1,00×; das ist der einzige Grund, warum das Spiel nicht bei 100 %
 * Auszahlung liegt.
 */
export const HOUSE_EDGE = 0.03;

/**
 * Crash-Punkt aus einer Gleichverteilung `u` ∈ [0, 1).
 *
 * Es gilt exakt:  P(Crash ≥ x) = (1 − HOUSE_EDGE) / x       (für x > 1)
 *
 * Daraus folgt zweierlei:
 *   · Niedrige Multiplikatoren sind sehr viel häufiger als hohe – die
 *     Verteilung fällt mit 1/x, nicht linear.
 *   · Wer immer bei `x` aussteigt, bekommt langfristig genau
 *     x · (1 − HOUSE_EDGE)/x = 97 % zurück – egal, welches `x` er wählt.
 *     Ein "sofort bei 1,01× auscashen" ist deshalb kein Freifahrtschein.
 *
 * Ungefähre Häufigkeiten:
 *   unter 2,00×    51,5 %      ab   10×     9,7 %
 *   2× bis 5×      29,1 %      ab  100×    0,97 %
 *   5× bis 10×      9,7 %      ab 1000×   0,097 %
 *                               ab 50000× 0,0019 %  (etwa 1 von 51.500)
 */
export function crashPointFrom(u) {
  const x = Math.min(1, Math.max(0, Number(u) || 0));
  // Pareto-Verteilung, um den Hausvorteil gestaucht:
  //   roh = (1 − HOUSE_EDGE) / (1 − u)
  // Alles unter 1 wird zu einem Sofort-Crash bei 1,00× – das passiert
  // genau mit Wahrscheinlichkeit HOUSE_EDGE.
  const raw = (1 - HOUSE_EDGE) / (1 - x);
  if (!Number.isFinite(raw) || raw > MAX_MULTIPLIER) return MAX_MULTIPLIER;
  return clampMultiplier(raw);
}

/** Schneidet auf zwei Nachkommastellen ab und hält den gültigen Bereich ein. */
export function clampMultiplier(value) {
  const m = Math.floor(value * 100) / 100;
  return Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, m));
}

/** Gleichverteilte Zahl aus [0, 1) über den kryptografischen Zufall. */
function randomUnit() {
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const buf = new Uint32Array(2);
    c.getRandomValues(buf);
    // 53 nutzbare Bits – fein genug, um auch 50.000× auflösen zu können
    return ((buf[0] >>> 5) * 2 ** 26 + (buf[1] >>> 6)) / 2 ** 53;
  }
  return Math.random();
}

/** Zieht einen neuen Crash-Punkt. Wird EINMAL beim Rundenstart aufgerufen. */
export const drawCrashPoint = () => crashPointFrom(randomUnit());

/** Wahrscheinlichkeit, dass die Runde mindestens `x` erreicht. */
export const probabilityAtLeast = (x) =>
  x <= 1 ? 1 : Math.max(0, (1 - HOUSE_EDGE) / x);

/* ==================================================================== */
/* Kurve                                                                 */
/* ==================================================================== */

/**
 * Der Multiplikator wächst überexponentiell:
 *
 *     m(t) = e^(A · t^P)        t in Sekunden
 *
 * Dadurch steigt er nicht nur schneller, je höher er steht – auch die
 * Steigerungsrate selbst nimmt mit der Zeit zu. In Zahlen:
 *
 *     2×  nach etwa  4,5 s        100×  nach etwa 24 s
 *     5×  nach etwa 10,5 s       1000×  nach etwa 35 s
 *    10×  nach etwa 14,5 s      50000×  nach etwa 52 s
 */
export const GROWTH_A = 0.1286;
export const GROWTH_P = 1.12;

/** Multiplikator nach `ms` Millisekunden (ungerundet). */
export function multiplierAt(ms) {
  const t = Math.max(0, ms) / 1000;
  return Math.exp(GROWTH_A * Math.pow(t, GROWTH_P));
}

/** Umkehrung: wann ist der Multiplikator `m` erreicht? (in Millisekunden) */
export function timeForMultiplier(m) {
  const target = Math.max(MIN_MULTIPLIER, m);
  if (target <= 1) return 0;
  const t = Math.pow(Math.log(target) / GROWTH_A, 1 / GROWTH_P);
  return t * 1000;
}

/** Auszahlung bei einem Cash-Out – immer auf volle Euro abgerundet. */
export const payoutFor = (bet, multiplier) => Math.floor(bet * multiplier);

/** 2.5 -> "2,50×" */
export const fmtMult = (m) =>
  `${(Math.floor(m * 100) / 100).toLocaleString('de-DE', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  })}×`;

/* ==================================================================== */
/* Spiel                                                                 */
/* ==================================================================== */

/** Startwerte der spielinternen Statistik. */
const STAT_DEFAULTS = {
  rounds: 0, cashed: 0, crashed: 0,
  bestMultiplier: 0, bestPayout: 0, recent: []
};

/** Wie viele vergangene Runden in der Leiste stehen. */
const RECENT_MAX = 14;

/**
 * @param {object} api  Schnittstelle zur App:
 *   available()              aktuelles Guthaben
 *   spend(n)                 zieht n ab (Prüfung erfolgt hier vorher)
 *   credit(n)                schreibt n gut (mit Obergrenze)
 *   persist()                speichert den Spielstand im Konto
 *   paintBalance()           aktualisiert alle Guthabenanzeigen
 *   recordRound(entry)       trägt die Runde in Statistik und Verlauf ein
 *   gameStats(key, defaults) liefert den Statistikeimer dieses Spiels
 *   toast(msg, kind)         Meldung
 *   sound                    Klangobjekt
 */
export function createCrash(api) {
  const $ = (sel) => document.querySelector(sel);

  const state = {
    phase: 'betting',       // betting | running | ended
    bet: null,
    chip: null,
    crashPoint: 0,          // steht VOR der Animation fest
    crashTime: 0,           // Zeitpunkt in ms, an dem er erreicht ist
    startedAt: 0,
    multiplier: 1,
    cashedAt: null,         // Multiplikator beim Auszahlen
    payout: 0,
    raf: null,
    lastTickAt: 0
  };

  let graph = null;

  /* ---------------- Einsatzleiste ---------------- */

  const betAmountOf = (chip) => (chip === MAX_CHIP ? maxBetFor(api.available()) : chip);

  function buildChipRow() {
    const host = $('#crash-chips');
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
    if (state.phase === 'running') return;
    const amount = betAmountOf(chip);
    if (amount <= 0) { api.toast('Dein Guthaben ist aufgebraucht.', 'warn'); return; }
    if (amount > api.available()) { api.toast('Dafür reicht dein Guthaben nicht.', 'warn'); return; }
    state.chip = chip;
    state.bet = amount;
    api.sound.chip();
    render();
  }

  function applyCustomBet() {
    if (state.phase === 'running') return;
    const input = $('#crash-custom');
    const value = Math.floor(Number(input.value));
    if (!Number.isFinite(value) || value <= 0) {
      api.toast('Bitte einen Betrag größer als 0 eingeben.', 'warn');
      return;
    }
    if (value > MAX_BET) { api.toast(`Maximal ${money(MAX_BET)} pro Runde.`, 'warn'); return; }
    if (value > api.available()) { api.toast('Dafür reicht dein Guthaben nicht.', 'warn'); return; }
    state.chip = value;
    state.bet = value;
    input.value = '';
    api.sound.chip();
    render();
  }

  /* ---------------- Rundenablauf ---------------- */

  const canStart = () =>
    state.phase !== 'running' && state.bet > 0 && state.bet <= api.available();

  const isLive = () => state.phase === 'running';

  /** Der Multiplikator, den der Spieler in diesem Moment sieht. */
  function currentMultiplier(nowMs = performance.now()) {
    if (state.phase !== 'running') return state.multiplier;
    const elapsed = nowMs - state.startedAt;
    if (elapsed >= state.crashTime) return state.crashPoint;
    return clampMultiplier(multiplierAt(elapsed));
  }

  async function startRound() {
    if (!canStart()) return;

    // Der Crash-Punkt steht JETZT fest – vor jeder Animation. Die Darstellung
    // kann ihn danach nicht mehr beeinflussen.
    state.crashPoint = drawCrashPoint();
    state.crashTime = timeForMultiplier(state.crashPoint);
    state.phase = 'running';
    state.multiplier = 1;
    state.cashedAt = null;
    state.payout = 0;
    state.startedAt = performance.now();
    state.lastTickAt = 0;

    api.spend(state.bet);
    api.paintBalance();
    hideResult();
    graph?.reset();
    api.sound.launch();
    render();
    // Einsatz ist gebucht UND gespeichert: Neuladen macht die Runde nicht rückgängig.
    await api.persist();

    tick();
  }

  function tick() {
    if (state.phase !== 'running') return;
    const now = performance.now();
    const elapsed = now - state.startedAt;
    const reached = elapsed >= state.crashTime;
    state.multiplier = reached ? state.crashPoint : clampMultiplier(multiplierAt(elapsed));

    graph?.draw({
      elapsed: Math.min(elapsed, state.crashTime),
      multiplier: state.multiplier,
      crashed: false,
      cashed: state.cashedAt !== null
    });
    paintLive();

    // dezentes Ticken, das mit dem Multiplikator schneller wird
    if (now - state.lastTickAt > Math.max(90, 420 - state.multiplier * 12)) {
      state.lastTickAt = now;
      api.sound.rise(Math.min(1, Math.log(state.multiplier + 1) / Math.log(30)));
    }

    if (reached) { endWithCrash(); return; }
    state.raf = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = null;
  }

  /**
   * Auszahlen. Sichert sofort den Gewinn – die Runde läuft danach aber
   * WEITER, bis der vorher bestimmte Crash-Punkt erreicht ist. Der Spieler
   * sieht dadurch, wie weit die Kurve noch gekommen wäre. Eine zweite
   * Auszahlung ist ausgeschlossen (`cashedAt` ist dann gesetzt).
   */
  async function cashOut() {
    if (state.phase !== 'running' || state.cashedAt !== null) return;
    const now = performance.now();
    if (now - state.startedAt >= state.crashTime) return;   // schon gecrasht

    const multiplier = currentMultiplier(now);
    state.cashedAt = multiplier;
    state.payout = payoutFor(state.bet, multiplier);

    // Das Geld ist jetzt endgültig gutgeschrieben. Der weitere Verlauf der
    // Kurve ändert daran nichts mehr.
    api.credit(state.payout);
    api.paintBalance();
    api.sound.win();
    showSecured();
    render();
    await api.persist();
  }

  function endWithCrash() {
    stopLoop();
    state.phase = 'ended';
    state.multiplier = state.crashPoint;
    graph?.draw({ elapsed: state.crashTime, multiplier: state.crashPoint, crashed: true });
    api.sound.crash();
    finishRound();
    api.persist();
  }

  /**
   * Statistik, Verlauf und Ergebnisanzeige. Läuft immer erst beim Crash –
   * auch dann, wenn schon vorher ausgezahlt wurde. Die Auszahlung selbst ist
   * zu diesem Zeitpunkt längst gebucht und ändert sich hier nicht mehr.
   */
  function finishRound() {
    const won = state.cashedAt !== null;
    const net = state.payout - state.bet;

    const stats = api.gameStats('crash', STAT_DEFAULTS);
    stats.rounds += 1;
    if (won) stats.cashed += 1; else stats.crashed += 1;
    stats.bestMultiplier = Math.max(stats.bestMultiplier || 0, won ? state.cashedAt : 0);
    stats.bestPayout = Math.max(stats.bestPayout || 0, state.payout);
    stats.recent = [state.crashPoint, ...(Array.isArray(stats.recent) ? stats.recent : [])]
      .slice(0, RECENT_MAX);

    api.recordRound({
      game: 'crash',
      staked: state.bet,
      net,
      crashAt: state.crashPoint,
      cashedAt: won ? state.cashedAt : null,
      payout: state.payout
    });

    showResult(won, net);
    renderRecent();
    renderStats();
    render();
  }

  /** Bereitet die nächste Runde vor. Der Einsatz bleibt liegen. */
  function newRound() {
    stopLoop();
    state.phase = 'betting';
    state.multiplier = 1;
    state.cashedAt = null;
    state.payout = 0;
    state.crashPoint = 0;
    hideResult();
    graph?.reset();
    graph?.draw({ elapsed: 0, multiplier: 1, crashed: false });
    // Einsatz nachziehen, falls das Guthaben inzwischen kleiner ist
    if (state.chip !== null) {
      const amount = betAmountOf(state.chip);
      state.bet = amount > 0 && amount <= api.available() ? amount : null;
      if (state.bet === null) state.chip = null;
    }
    render();
  }

  /* ---------------- Anzeige ---------------- */

  function paintLive() {
    const multEl = $('#crash-mult');
    if (multEl) multEl.textContent = fmtMult(state.multiplier);

    // Vor der Runde gibt es noch nichts auszuzahlen; ist schon ausgezahlt,
    // steht der Betrag fest und läuft NICHT mehr mit dem Multiplikator mit.
    const live = state.phase === 'running';
    const secured = state.cashedAt !== null;
    const payoutText = secured || state.phase === 'ended'
      ? money(state.payout)
      : live
        ? money(payoutFor(state.bet || 0, state.multiplier))
        : '—';

    const label = $('#crash-payout-label');
    if (label) label.textContent = secured ? 'Ausgezahlt' : 'Mögliche Auszahlung';

    const payoutEl = $('#crash-payout');
    if (payoutEl) {
      payoutEl.textContent = payoutText;
      payoutEl.classList.toggle('is-zero', !secured && state.phase === 'ended' && state.payout === 0);
      payoutEl.classList.toggle('is-secured', secured);
    }
    const cash = $('#crash-cash');
    if (cash && !secured) {
      const small = cash.querySelector('small');
      if (small) small.textContent = live ? money(payoutFor(state.bet || 0, state.multiplier)) : '—';
    }

    // Gesichert-Schild: zeigt dauerhaft, bei welchem Wert ausgestiegen wurde
    const badge = $('#crash-secured');
    if (badge) {
      badge.hidden = !secured;
      if (secured) {
        badge.innerHTML = `<span class="crash-secured-label">Gesichert</span>
          <b>${fmtMult(state.cashedAt)}</b>
          <span class="crash-secured-net">${signedMoney(state.payout - state.bet)}</span>`;
      }
    }
  }

  /** Kurze Rückmeldung direkt beim Auszahlen – die Runde läuft dabei weiter. */
  function showSecured() {
    paintLive();
    api.toast(`${money(state.payout)} gesichert bei ${fmtMult(state.cashedAt)}.`, 'good');
  }

  function showResult(won, net) {
    const box = $('#crash-result');
    if (!box) return;
    box.hidden = false;
    box.className = `crash-result ${won ? (net > 0 ? 'is-win' : 'is-even') : 'is-loss'}`;
    box.innerHTML = won
      ? `<strong>AUSGEZAHLT</strong>
         <span>Bei <b>${fmtMult(state.cashedAt)}</b> gesichert · Crash lag bei ${fmtMult(state.crashPoint)}</span>
         <span class="crash-result-net">${signedMoney(net)}</span>`
      : `<strong>CRASH!</strong>
         <span>Crash bei <b>${fmtMult(state.crashPoint)}</b> · nicht rechtzeitig ausgezahlt</span>
         <span class="crash-result-net">${signedMoney(net)}</span>`;
  }

  function hideResult() {
    const box = $('#crash-result');
    if (box) box.hidden = true;
    const badge = $('#crash-secured');
    if (badge) badge.hidden = true;
  }

  /** Leiste der letzten Crash-Punkte – wie in echten Crash-Spielen. */
  function renderRecent() {
    const host = $('#crash-recent');
    if (!host) return;
    const stats = api.gameStats ? api.gameStats('crash', STAT_DEFAULTS) : STAT_DEFAULTS;
    const list = Array.isArray(stats.recent) ? stats.recent : [];
    if (!list.length) {
      host.innerHTML = '<span class="crash-recent-empty">Noch keine Runden gespielt.</span>';
      return;
    }
    host.innerHTML = list.map((m) => {
      const tone = m >= 10 ? 'is-high' : m >= 2 ? 'is-mid' : 'is-low';
      return `<span class="crash-pill ${tone}">${fmtMult(m)}</span>`;
    }).join('');
  }

  /** Klappt die Bilanz auf oder zu und merkt sich den Zustand. */
  function setStatsOpen(open, remember = true) {
    const wrap = $('#crash-stats-wrap');
    const toggle = $('#crash-stats-toggle');
    if (!wrap || !toggle) return;
    wrap.classList.toggle('is-open', open);
    toggle.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    wrap.setAttribute('aria-hidden', String(!open));
    if (remember && api.setPref) api.setPref('crashStatsOpen', open);
  }

  function toggleStats() {
    const open = $('#crash-stats-toggle')?.getAttribute('aria-expanded') !== 'true';
    setStatsOpen(open);
    api.sound.chip();
  }

  function renderStats() {
    const host = $('#crash-stats');
    if (!host) return;
    const s = api.gameStats ? api.gameStats('crash', STAT_DEFAULTS) : STAT_DEFAULTS;
    const rows = [
      ['Runden', s.rounds],
      ['Ausgezahlt', s.cashed],
      ['Gecrasht', s.crashed],
      ['Bester Cash-Out', s.bestMultiplier ? fmtMult(s.bestMultiplier) : '—'],
      ['Höchste Auszahlung', money(s.bestPayout || 0)]
    ];
    host.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  }

  function render() {
    if (!$('#crash-canvas')) return;
    const live = state.phase === 'running';

    for (const chip of document.querySelectorAll('#crash-chips .chip')) {
      const isMax = chip.dataset.value === MAX_CHIP;
      const value = isMax ? maxBetFor(api.available()) : Number(chip.dataset.value);
      chip.disabled = live || value <= 0 || value > api.available();
      chip.classList.toggle('is-active', !live && state.chip !== null &&
        (isMax ? state.chip === MAX_CHIP : value === state.chip));
      if (isMax) {
        const label = chip.querySelector('small');
        if (label) label.textContent = money(Math.max(0, value));
      }
    }
    const custom = $('#crash-custom');
    if (custom) custom.disabled = live;
    const customBtn = $('#crash-custom-btn');
    if (customBtn) customBtn.disabled = live;

    for (const el of document.querySelectorAll('[data-crash-bet]')) {
      el.textContent = state.bet ? money(state.bet) : '—';
    }

    const start = $('#crash-start');
    if (start) {
      start.disabled = !canStart();
      start.textContent = state.phase === 'ended' ? 'NOCHMAL SPIELEN' : 'SPIELEN';
      start.hidden = live;
    }
    // Nach dem Auszahlen verschwindet der Knopf – ein zweites Mal geht nicht.
    const cash = $('#crash-cash');
    if (cash) cash.hidden = !live || state.cashedAt !== null;

    const hint = $('#crash-hint');
    if (hint) {
      hint.textContent = live
        ? (state.cashedAt !== null
            ? 'Gewinn ist gesichert. Die Runde läuft noch bis zum Crash.'
            : 'Zahle aus, bevor die Kurve abstürzt.')
        : !state.bet ? 'Wähle einen Einsatz.'
        : state.bet > api.available() ? 'Einsatz höher als dein Guthaben.'
        : state.phase === 'ended' ? 'Der Einsatz liegt noch – einfach nochmal starten.'
        : 'Bereit – viel Glück!';
    }

    const panel = $('#crash-panel');
    if (panel) panel.classList.toggle('is-locked', live);

    const stage = $('#crash-stage');
    if (stage) {
      stage.classList.toggle('is-running', live);
      stage.classList.toggle('is-crashed', state.phase === 'ended');
      stage.classList.toggle('is-cashed', state.cashedAt !== null);
      stage.classList.toggle('is-secured-run', live && state.cashedAt !== null);
    }

    const multEl = $('#crash-mult');
    if (multEl && !live) multEl.textContent = fmtMult(state.multiplier);

    const sub = $('#crash-sub');
    if (sub) {
      sub.textContent = live
        ? (state.cashedAt !== null
            ? `Ausgestiegen bei ${fmtMult(state.cashedAt)}`
            : 'Läuft …')
        : state.phase === 'ended'
          ? (state.cashedAt !== null
              ? `Ausgestiegen bei ${fmtMult(state.cashedAt)} · Crash lag bei ${fmtMult(state.crashPoint)}`
              : `Crash bei ${fmtMult(state.crashPoint)}`)
          : 'Einsatz wählen und starten';
    }
    paintLive();
  }

  /* ---------------- Aufbau ---------------- */

  function init() {
    buildChipRow();
    graph = createCrashGraph($('#crash-canvas'));
    graph?.reset();
    graph?.draw({ elapsed: 0, multiplier: 1, crashed: false });
    $('#crash-start').addEventListener('click', startRound);
    $('#crash-cash').addEventListener('click', cashOut);
    $('#crash-custom-btn').addEventListener('click', applyCustomBet);
    $('#crash-custom').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCustomBet(); });
    setStatsOpen(api.getPref ? Boolean(api.getPref('crashStatsOpen', false)) : false, false);
    $('#crash-stats-toggle')?.addEventListener('click', toggleStats);
    render();
    renderRecent();
    renderStats();
  }

  return {
    init,
    render() { render(); renderRecent(); renderStats(); graph?.refresh(); },
    isLive,

    /** Bricht eine laufende Runde ab – der Einsatz ist dann verloren. */
    async abandon() {
      if (!isLive()) { newRound(); return; }
      stopLoop();
      state.phase = 'ended';
      // Ein bereits gesicherter Gewinn bleibt dem Spieler – nur wer noch
      // nicht ausgezahlt hat, verliert beim Verlassen seinen Einsatz.
      const won = state.cashedAt !== null;
      api.recordRound({
        game: 'crash',
        staked: state.bet,
        net: state.payout - state.bet,
        crashAt: state.crashPoint,
        cashedAt: state.cashedAt,
        payout: state.payout,
        abandoned: true
      });
      const stats = api.gameStats('crash', STAT_DEFAULTS);
      stats.rounds += 1;
      if (won) stats.cashed += 1; else stats.crashed += 1;
      stats.recent = [state.crashPoint, ...(Array.isArray(stats.recent) ? stats.recent : [])]
        .slice(0, RECENT_MAX);
      newRound();
      await api.persist();
    },

    /** Diagnose für die automatisierten Tests */
    debug: () => ({
      phase: state.phase,
      bet: state.bet,
      multiplier: state.multiplier,
      crashPoint: state.crashPoint,
      crashTime: Math.round(state.crashTime),
      cashedAt: state.cashedAt,
      payout: state.payout,
      canStart: canStart(),
      secured: state.cashedAt !== null,
      elapsed: state.phase === 'running' ? Math.round(performance.now() - state.startedAt) : 0
    }),

    /** Nur für Tests: erzwingt einen bestimmten Crash-Punkt für EINE Runde. */
    __forceCrashPoint(value) {
      const forced = clampMultiplier(value);
      state.crashPoint = forced;
      state.crashTime = timeForMultiplier(forced);
      return forced;
    }
  };
}

/* ==================================================================== */
/* Graph                                                                 */
/* ==================================================================== */

/** Farben aus dem aktiven Theme lesen – wie beim Roulette-Rad. */
function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const pick = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
  return {
    grid: pick('--crash-grid', 'rgba(255,255,255,.08)'),
    axis: pick('--crash-axis', 'rgba(255,255,255,.22)'),
    label: pick('--crash-label', '#93a49a'),
    line: pick('--crash-line', '#d4af6a'),
    lineHi: pick('--crash-line-hi', '#f2ddab'),
    fill: pick('--crash-fill', 'rgba(212,175,106,.18)'),
    ball: pick('--crash-ball', '#f2ddab'),
    crash: pick('--crash-bust', '#f8717a')
  };
}

/**
 * Zeichnet Raster, Kurve und Kugel. Die Achsen skalieren automatisch mit,
 * damit auch 50.000× noch sinnvoll dargestellt werden.
 */
export function createCrashGraph(canvas) {
  if (!canvas || !canvas.getContext) return null;
  const ctx = canvas.getContext('2d');
  let palette = readPalette();
  let W = 0;
  let H = 0;
  let last = { elapsed: 0, multiplier: 1, crashed: false, cashed: false };

  const PAD_L = 46;
  const PAD_R = 16;
  const PAD_T = 18;
  const PAD_B = 26;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(160, rect.width || 600);
    const cssH = Math.max(140, rect.height || 320);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = cssW;
    H = cssH;
    draw(last);
  }

  // Als Funktionsdeklarationen, damit resize() sie schon beim ersten Aufruf kennt.
  function plotW() { return Math.max(10, W - PAD_L - PAD_R); }
  function plotH() { return Math.max(10, H - PAD_T - PAD_B); }

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);
  resize();

  /** Hübsche Schrittweite für die Rasterlinien. */
  function niceStep(range, target = 4) {
    const raw = range / target;
    const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
    for (const f of [1, 2, 2.5, 5, 10]) {
      if (raw <= f * mag) return f * mag;
    }
    return 10 * mag;
  }

  function reset() {
    last = { elapsed: 0, multiplier: 1, crashed: false, cashed: false };
  }

  function draw(view) {
    if (!ctx || !W) return;
    last = { ...last, ...view };
    const { elapsed, multiplier, crashed, cashed } = last;

    // Achsenbereiche wachsen mit – die Kurve behält dadurch ihre Form
    const xMax = Math.max(5000, elapsed * 1.18);
    const yMin = 1;
    const yMax = Math.max(2, 1 + (multiplier - 1) * 1.3);

    const px = (ms) => PAD_L + (ms / xMax) * plotW();
    const py = (m) => PAD_T + plotH() - ((m - yMin) / (yMax - yMin)) * plotH();

    ctx.clearRect(0, 0, W, H);

    /* Raster */
    ctx.lineWidth = 1;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    const stepY = niceStep(yMax - yMin, 4);
    ctx.strokeStyle = palette.grid;
    ctx.fillStyle = palette.label;
    ctx.textAlign = 'right';
    for (let m = 1; m <= yMax + stepY * 0.5; m += stepY) {
      const y = Math.round(py(m)) + 0.5;
      if (y < PAD_T - 2 || y > H - PAD_B + 2) continue;
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(W - PAD_R, y);
      ctx.stroke();
      ctx.fillText(`${formatTick(m)}×`, PAD_L - 8, y);
    }

    const stepX = niceStep(xMax / 1000, 4) * 1000;
    ctx.textAlign = 'center';
    for (let t = stepX; t <= xMax; t += stepX) {
      const x = Math.round(px(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, PAD_T);
      ctx.lineTo(x, H - PAD_B);
      ctx.stroke();
      ctx.fillText(`${Math.round(t / 1000)}s`, x, H - PAD_B + 12);
    }

    /* Achsen */
    ctx.strokeStyle = palette.axis;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(PAD_L + 0.5, PAD_T);
    ctx.lineTo(PAD_L + 0.5, H - PAD_B + 0.5);
    ctx.lineTo(W - PAD_R, H - PAD_B + 0.5);
    ctx.stroke();

    /* Kurve */
    const steps = 90;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = (elapsed * i) / steps;
      const m = i === steps ? multiplier : Math.min(multiplier, multiplierAt(t));
      pts.push([px(t), py(m)]);
    }

    if (pts.length > 1) {
      // Fläche unter der Kurve
      ctx.beginPath();
      ctx.moveTo(pts[0][0], py(1));
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.lineTo(pts[pts.length - 1][0], py(1));
      ctx.closePath();
      ctx.fillStyle = crashed ? withAlpha(palette.crash, 0.16) : palette.fill;
      ctx.fill();

      // Linie
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.strokeStyle = crashed ? palette.crash : palette.line;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = crashed ? palette.crash : palette.lineHi;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    /* Kugel */
    const [bx, by] = pts[pts.length - 1] || [px(0), py(1)];
    const ballColor = crashed ? palette.crash : cashed ? palette.lineHi : palette.ball;
    ctx.beginPath();
    ctx.arc(bx, by, 13, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(ballColor, 0.18);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bx, by, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = ballColor;
    ctx.shadowColor = ballColor;
    ctx.shadowBlur = crashed ? 20 : 14;
    ctx.fill();
    ctx.shadowBlur = 0;

    if (crashed) {
      // kleine Explosionsstriche am Aufschlagpunkt
      ctx.strokeStyle = palette.crash;
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(bx + Math.cos(a) * 11, by + Math.sin(a) * 11);
        ctx.lineTo(bx + Math.cos(a) * 20, by + Math.sin(a) * 20);
        ctx.stroke();
      }
    }
  }

  /** 1000 -> "1k", 12.5 -> "12,5" */
  function formatTick(m) {
    if (m >= 1000) return `${Math.round(m / 1000)}k`;
    if (m >= 100) return String(Math.round(m));
    if (m >= 10) return m.toFixed(m % 1 ? 1 : 0).replace('.', ',');
    return m.toFixed(m % 1 ? 2 : 0).replace('.', ',');
  }

  /** Macht aus einer Farbe eine halbtransparente Variante. */
  function withAlpha(color, alpha) {
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
      const n = parseInt(full, 16);
      return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    }
    if (color.startsWith('rgb')) {
      return color.replace(/rgba?\(([^)]+)\)/, (_, inner) => {
        const parts = inner.split(',').map((s) => s.trim()).slice(0, 3);
        return `rgba(${parts.join(', ')}, ${alpha})`;
      });
    }
    return color;
  }

  return {
    reset,
    draw,
    /** Nach einem Designwechsel die Farben neu einlesen. */
    refresh() { palette = readPalette(); resize(); }
  };
}
