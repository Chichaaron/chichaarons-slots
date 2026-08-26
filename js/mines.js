/**
 * MINES – zweites Minigame der Plattform.
 *
 * Ablauf: Feldgröße wählen → Minenzahl wählen → Einsatz wählen → SPIELEN →
 * Felder aufdecken → Multiplikator steigt → auszahlen oder weitermachen.
 *
 * Die Datei bringt Logik UND Oberfläche mit, greift aber für Guthaben,
 * Speichern und Statistik nur über die von app.js übergebene Schnittstelle
 * zu. Dadurch bleibt das Roulette vollständig unberührt.
 */
import { CHIPS, MAX_CHIP, MAX_BET, maxBetFor } from './bets.js';
import { money, signedMoney } from './roulette.js';

/* ==================================================================== */
/* Regeln und Mathematik                                                 */
/* ==================================================================== */

/** Auswählbare Spielfelder. */
export const BOARDS = [
  { size: 4, label: 'LEICHT' },
  { size: 5, label: 'MITTEL' },
  { size: 6, label: 'SCHWER' },
  { size: 7, label: 'EXTREM' }
];

/**
 * Auszahlungskurve.
 *
 * Der Multiplikator ist der faire Kehrwert der Überlebenswahrscheinlichkeit,
 * multipliziert mit einer Quote, die mit jedem weiteren Feld steigt:
 *
 *   rtpAt(1) = 0,845   →   rtpAt(∞) → 0,97
 *
 * Daraus folgt direkt: Wer nach genau k Feldern auszahlt, bekommt langfristig
 * `rtpAt(k)` seines Einsatzes zurück – bei einem Feld also nur 84,5 %. Ein
 * "immer ein Feld, dann Cash-Out" ist damit rechnerisch ein sicherer Verlust,
 * unabhängig von Feldgröße und Minenzahl. Wer weiter geht, spielt gegen einen
 * kleineren Hausvorteil, trägt dafür aber das echte Risiko.
 */
export const RTP_FIRST = 0.845;   // Quote nach dem ersten Feld
export const RTP_DEEP = 0.97;     // Quote bei langen Serien
export const RTP_DECAY = 0.75;    // wie schnell sich die Quote RTP_DEEP nähert

/** Rückzahlquote nach `picks` sicheren Feldern. */
export function rtpAt(picks) {
  if (picks <= 0) return 1;
  return RTP_DEEP - (RTP_DEEP - RTP_FIRST) * Math.pow(RTP_DECAY, picks - 1);
}

/** Höchstzahl Minen: es muss immer mindestens ein sicheres Feld übrig bleiben. */
export const maxMines = (total) => total - 1;

/**
 * Fairer Multiplikator: der Kehrwert der Wahrscheinlichkeit, `picks` Felder
 * hintereinander zu überleben. Enthält noch keinen Hausvorteil.
 */
export function fairMultiplier(total, mines, picks) {
  const safe = total - mines;
  if (picks <= 0 || picks > safe || safe <= 0) return 1;
  let m = 1;
  for (let i = 0; i < picks; i++) m *= (total - i) / (safe - i);
  return m;
}

/**
 * Ausgezahlter Multiplikator nach `picks` sicheren Feldern.
 * Berücksichtigt Feldgröße, Minenzahl, bereits aufgedeckte Felder und damit
 * automatisch auch das Risiko des nächsten Feldes.
 */
export function multiplierFor(total, mines, picks) {
  if (picks <= 0) return 1;
  return rtpAt(picks) * fairMultiplier(total, mines, picks);
}

/** Wahrscheinlichkeit, dass das NÄCHSTE Feld eine Mine ist (0…1). */
export function nextMineRisk(total, mines, picks) {
  const left = total - picks;
  return left > 0 ? Math.min(1, mines / left) : 0;
}

/** Auszahlung bei Cash-Out – immer auf volle Euro abgerundet. */
export const payoutFor = (bet, total, mines, picks) =>
  Math.floor(bet * multiplierFor(total, mines, picks));

/** Gleichverteilte Ganzzahl 0…max-1 aus dem kryptografischen Zufall. */
function randomInt(max) {
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const limit = Math.floor(4294967296 / max) * max;
    const buf = new Uint32Array(1);
    let v;
    do { c.getRandomValues(buf); v = buf[0]; } while (v >= limit);
    return v % max;
  }
  return Math.floor(Math.random() * max);
}

/**
 * Verteilt die Minen auf dem Feld. Fisher-Yates-Mischung – jede Anordnung
 * ist gleich wahrscheinlich. Wird EINMAL beim Rundenstart aufgerufen; die
 * Positionen stehen danach für die ganze Runde fest.
 */
export function placeMines(total, mines) {
  const idx = [...Array(total).keys()];
  for (let i = total - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return new Set(idx.slice(0, mines));
}

/* ==================================================================== */
/* Grafiken (Inline-SVG, nimmt die Farben aus dem Theme)                 */
/* ==================================================================== */

const coinSvg = (variant) => `
<svg viewBox="0 0 48 48" aria-hidden="true" class="tile-svg tile-coin-${variant}">
  <defs>
    <radialGradient id="mc${variant}" cx="35%" cy="30%" r="75%">
      <stop offset="0%" stop-color="var(--gold-bright)"/>
      <stop offset="60%" stop-color="var(--gold)"/>
      <stop offset="100%" stop-color="var(--gold-dim)"/>
    </radialGradient>
  </defs>
  <circle cx="24" cy="24" r="17" fill="url(#mc${variant})" stroke="var(--gold-dim)" stroke-width="1.5"/>
  <circle cx="24" cy="24" r="12.5" fill="none" stroke="var(--gold-dim)" stroke-width="1" opacity=".55"/>
  <text x="24" y="30.5" text-anchor="middle" font-size="15" font-weight="700"
        fill="var(--on-gold)" font-family="system-ui, sans-serif">€</text>
</svg>`;

const mineSvg = () => `
<svg viewBox="0 0 48 48" aria-hidden="true" class="tile-svg tile-mine">
  <g stroke="var(--mine-spike)" stroke-width="3.4" stroke-linecap="round">
    <path d="M24 4v8M24 36v8M4 24h8M36 24h8M10 10l5.5 5.5M32.5 32.5L38 38M38 10l-5.5 5.5M15.5 32.5L10 38"/>
  </g>
  <circle cx="24" cy="24" r="12" fill="var(--mine-body)"/>
  <circle cx="19.5" cy="19.5" r="3.6" fill="var(--mine-shine)" opacity=".75"/>
</svg>`;

/* ==================================================================== */
/* Spiel                                                                 */
/* ==================================================================== */

/**
 * @param {object} api  Schnittstelle zur App:
 *   available()          aktuelles Guthaben
 *   spend(n)             zieht n vom Guthaben ab (Prüfung erfolgt hier vorher)
 *   credit(n)            schreibt n gut (mit Obergrenze)
 *   persist()            speichert den Spielstand im Konto
 *   paintBalance()       aktualisiert alle Guthabenanzeigen
 *   recordRound(entry)   trägt die Runde in Statistik und Verlauf ein
 *   toast(msg, kind)     Meldung
 *   sound                Klangobjekt
 */
export function createMines(api) {
  const $ = (sel) => document.querySelector(sel);

  const state = {
    boardSize: null,        // 4 | 5 | 6 | 7
    mines: null,            // gewählte Minenzahl
    bet: null,              // gewählter Einsatz
    chip: null,             // gewählter Jeton (Zahl oder 'max')
    running: false,
    minePositions: null,    // Set<number> – steht beim Start fest
    revealed: new Set(),    // sicher aufgedeckte Felder
    finished: false
  };

  const fmtMult = (m) => `${m.toFixed(2).replace('.', ',')}×`;

  const total = () => (state.boardSize ?? 0) ** 2;
  const picks = () => state.revealed.size;
  const currentMultiplier = () => multiplierFor(total(), state.mines ?? 0, picks());
  const currentPayout = () => payoutFor(state.bet ?? 0, total(), state.mines ?? 0, picks());
  const safeLeft = () => total() - (state.mines ?? 0) - picks();

  /** Läuft gerade eine Runde, in der noch Geld auf dem Spiel steht? */
  const isLive = () => state.running && !state.finished;

  /* ---------------- Einsatzleiste ---------------- */

  function betAmountOf(chip) {
    return chip === MAX_CHIP ? maxBetFor(api.available()) : chip;
  }

  function buildChipRow() {
    const host = $('#mines-chips');
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
    if (isLive()) return;
    const amount = betAmountOf(chip);
    if (amount <= 0) { api.toast('Dein Guthaben ist aufgebraucht.', 'warn'); return; }
    if (amount > api.available()) { api.toast('Dafür reicht dein Guthaben nicht.', 'warn'); return; }
    state.chip = chip;
    state.bet = amount;
    api.sound.chip();
    render();
  }

  function applyCustomBet() {
    if (isLive()) return;
    const input = $('#mines-custom');
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

  /* ---------------- Einstellungen ---------------- */

  function buildBoardOptions() {
    const host = $('#mines-boards');
    host.innerHTML = '';
    for (const { size, label } of BOARDS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'board-option';
      btn.dataset.size = String(size);
      btn.innerHTML = `<b>${size} × ${size}</b><span>${label}</span>`;
      btn.onclick = () => selectBoard(size);
      host.appendChild(btn);
    }
  }

  function selectBoard(size) {
    if (isLive()) return;
    state.boardSize = size;
    const max = maxMines(size * size);
    // Minenzahl mitziehen, damit sie immer zur Feldgröße passt
    if (state.mines === null) state.mines = Math.max(1, Math.round(size * size * 0.16));
    state.mines = Math.min(Math.max(1, state.mines), max);
    api.sound.chip();
    buildGrid();
    render();
  }

  function onMinesInput(value) {
    if (isLive() || !state.boardSize) return;
    state.mines = Math.min(Math.max(1, Number(value)), maxMines(total()));
    render();
  }

  /* ---------------- Spielfeld ---------------- */

  function buildGrid() {
    const grid = $('#mines-grid');
    grid.innerHTML = '';
    if (!state.boardSize) {
      grid.classList.add('is-empty');
      grid.style.removeProperty('--cols');
      const hint = document.createElement('p');
      hint.className = 'mines-empty';
      hint.textContent = 'Wähle links eine Spielfeldgröße.';
      grid.appendChild(hint);
      return;
    }
    grid.classList.remove('is-empty');
    grid.style.setProperty('--cols', String(state.boardSize));
    for (let i = 0; i < total(); i++) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'mine-tile';
      tile.dataset.index = String(i);
      tile.disabled = true;
      tile.setAttribute('aria-label', `Feld ${i + 1}`);
      tile.innerHTML = `<span class="tile-inner">
          <span class="tile-face tile-front">${coinSvg('dim')}</span>
          <span class="tile-face tile-back"></span>
        </span>`;
      tile.onclick = () => revealTile(i);
      grid.appendChild(tile);
    }
  }

  const tileAt = (i) => document.querySelector(`.mine-tile[data-index="${i}"]`);

  function paintTile(i, kind) {
    const tile = tileAt(i);
    if (!tile) return;
    tile.querySelector('.tile-back').innerHTML = kind === 'mine' ? mineSvg() : coinSvg('win');
    tile.classList.add('is-revealed', kind === 'mine' ? 'is-mine' : 'is-safe');
    tile.disabled = true;
  }

  /* ---------------- Rundenablauf ---------------- */

  const canStart = () =>
    !state.running && state.boardSize && state.mines >= 1 && state.bet > 0 &&
    state.bet <= api.available();

  async function startRound() {
    if (!canStart()) return;
    // Einsatz wird sofort abgebucht UND gespeichert: ein Neuladen kann eine
    // laufende Runde damit nicht rückgängig machen.
    api.spend(state.bet);
    state.running = true;
    state.finished = false;
    state.revealed = new Set();
    $('#mines-result').hidden = true;      // Ergebnis der Vorrunde ausblenden
    state.minePositions = placeMines(total(), state.mines);   // steht jetzt fest
    buildGrid();
    for (const tile of document.querySelectorAll('.mine-tile')) tile.disabled = false;
    api.paintBalance();
    api.sound.spin();
    render();
    await api.persist();
  }

  function revealTile(index) {
    if (!isLive() || state.revealed.has(index)) return;

    if (state.minePositions.has(index)) {
      paintTile(index, 'mine');
      endRound(false);
      return;
    }

    state.revealed.add(index);
    paintTile(index, 'safe');
    api.sound.chip();

    // Alle sicheren Felder gefunden -> automatisch auszahlen
    if (safeLeft() <= 0) { cashOut(true); return; }
    render(true);
  }

  async function endRound(won, autoPayout = false) {
    state.running = false;
    state.finished = true;

    const payout = won ? currentPayout() : 0;
    const net = payout - state.bet;

    if (won) api.credit(payout);
    api.paintBalance();

    // alle übrigen Minen aufdecken, damit man sieht, wo sie lagen
    for (const i of state.minePositions) {
      if (!document.querySelector(`.mine-tile[data-index="${i}"].is-revealed`)) {
        const tile = tileAt(i);
        if (tile) {
          tile.querySelector('.tile-back').innerHTML = mineSvg();
          tile.classList.add('is-revealed', 'is-mine', 'is-ghost');
        }
      }
    }
    for (const tile of document.querySelectorAll('.mine-tile')) tile.disabled = true;

    api.recordRound({
      game: 'mines',
      board: `${state.boardSize}×${state.boardSize}`,
      mines: state.mines,
      picks: picks(),
      multiplier: won ? Number(currentMultiplier().toFixed(4)) : 0,
      staked: state.bet,
      net
    });

    // Ein Cash-Out unter 1,00× ist zwar ein erfolgreicher Abschluss,
    // aber kein Gewinn – der Ton richtet sich nach dem Netto.
    if (!won) api.sound.lose();
    else if (net > 0) api.sound.win();
    else api.sound.remove();
    showResult(won, payout, net, autoPayout);
    render();
    await api.persist();
  }

  function cashOut(auto = false) {
    if (!isLive() || picks() === 0) return;
    endRound(true, auto);
  }

  function showResult(won, payout, net, autoPayout) {
    const box = $('#mines-result');
    const tone = !won ? 'is-loss' : net > 0 ? 'is-win' : 'is-even';
    box.className = `mines-result ${tone}`;
    box.hidden = false;
    box.innerHTML = won
      ? `<strong>${autoPayout ? 'Alle Felder sicher!' : net > 0 ? 'Ausgezahlt!' : 'Gesichert'}</strong>
         <span>${picks()} ${picks() === 1 ? 'Feld' : 'Felder'} · ${fmtMult(currentMultiplier())} · <b>${money(payout)}</b></span>
         <span class="mines-result-net">${signedMoney(net)}</span>`
      : `<strong>MINE!</strong>
         <span>Nach ${picks()} sicheren ${picks() === 1 ? 'Feld' : 'Feldern'}</span>
         <span class="mines-result-net">${signedMoney(-state.bet)}</span>`;
  }

  /** Bereitet die nächste Runde vor. Einstellungen bleiben erhalten. */
  function newRound() {
    state.running = false;
    state.finished = false;
    state.revealed = new Set();
    state.minePositions = null;
    $('#mines-result').hidden = true;
    // Einsatz nachziehen, falls das Guthaben inzwischen kleiner ist
    if (state.chip !== null) {
      const amount = betAmountOf(state.chip);
      state.bet = amount > 0 && amount <= api.available() ? amount : null;
      if (state.bet === null) state.chip = null;
    }
    buildGrid();
    render();
  }

  /* ---------------- Anzeige ---------------- */

  function render(animateMultiplier = false) {
    if (!$('#mines-grid')) return;
    const live = isLive();

    // Feldgrößen
    for (const btn of document.querySelectorAll('.board-option')) {
      btn.classList.toggle('is-active', Number(btn.dataset.size) === state.boardSize);
      btn.disabled = live;
    }

    // Minen-Slider
    const slider = $('#mines-slider');
    const max = state.boardSize ? maxMines(total()) : 1;
    slider.max = String(max);
    slider.disabled = live || !state.boardSize;
    if (state.mines !== null) slider.value = String(state.mines);
    $('#mines-count').textContent = state.mines !== null ? String(state.mines) : '—';
    $('#mines-max').textContent = state.boardSize ? `von ${max}` : 'Feld wählen';
    slider.style.setProperty('--fill', `${state.boardSize ? ((state.mines - 1) / Math.max(1, max - 1)) * 100 : 0}%`);

    // Jetons
    for (const chip of document.querySelectorAll('#mines-chips .chip')) {
      const isMax = chip.dataset.value === MAX_CHIP;
      const value = isMax ? maxBetFor(api.available()) : Number(chip.dataset.value);
      chip.disabled = live || value <= 0 || value > api.available();
      chip.classList.toggle('is-active', !live && state.chip !== null &&
        (isMax ? state.chip === MAX_CHIP : value === state.chip));
      if (isMax) {
        const label = chip.querySelector('small');
        if (label) label.textContent = money(value);
      }
    }
    $('#mines-custom').disabled = live;
    $('#mines-custom-btn').disabled = live;
    $('#mines-bet').textContent = state.bet ? money(state.bet) : '—';

    // Startknopf
    const start = $('#mines-start');
    start.disabled = !canStart();
    start.textContent = live ? 'Runde läuft …' : 'SPIELEN';
    const missing = [];
    if (!state.boardSize) missing.push('Spielfeld');
    if (state.mines === null) missing.push('Minen');
    if (!state.bet) missing.push('Einsatz');
    $('#mines-start-hint').textContent = live
      ? 'Deck ein Feld auf oder zahle aus.'
      : missing.length ? `Fehlt noch: ${missing.join(', ')}` : 'Alles bereit – viel Glück!';

    // Laufende Runde
    const mult = currentMultiplier();
    const multEl = $('#mines-multiplier');
    const nextText = fmtMult(mult);
    if (multEl.textContent !== nextText) {
      multEl.textContent = nextText;
      if (animateMultiplier) {
        multEl.classList.remove('pulse');
        void multEl.offsetWidth;
        multEl.classList.add('pulse');
      }
    }
    const payoutEl = $('#mines-payout');
    payoutEl.textContent = live && picks() > 0 ? money(currentPayout()) : '—';
    // unter dem Einsatz = noch kein Gewinn: das soll man sehen
    payoutEl.classList.toggle('is-below', live && picks() > 0 && currentPayout() < state.bet);

    // Vorschau: was das nächste Feld bringt und was es kostet
    const preview = $('#mines-next');
    if (live && safeLeft() > 0) {
      const nextMult = multiplierFor(total(), state.mines, picks() + 1);
      const risk = nextMineRisk(total(), state.mines, picks());
      preview.innerHTML = `Nächstes Feld: <b>${fmtMult(nextMult)}</b>
        · <span class="mines-risk">${(risk * 100).toFixed(risk < 0.1 ? 1 : 0)} % Minenrisiko</span>`;
      preview.hidden = false;
    } else if (live) {
      preview.textContent = 'Letztes sicheres Feld – danach wird automatisch ausgezahlt.';
      preview.hidden = false;
    } else {
      preview.hidden = true;
    }
    $('#mines-safe').textContent = state.boardSize
      ? `${picks()} / ${total() - (state.mines ?? 0)}`
      : '—';

    const cash = $('#mines-cash');
    cash.disabled = !live || picks() === 0;
    cash.querySelector('small').textContent = live && picks() > 0 ? money(currentPayout()) : '—';

    $('#mines-new').hidden = !state.finished;
    $('#mines-panel').classList.toggle('is-locked', live);
  }

  /* ---------------- Aufbau ---------------- */

  function init() {
    buildBoardOptions();
    buildChipRow();
    buildGrid();
    $('#mines-slider').addEventListener('input', (e) => onMinesInput(e.target.value));
    $('#mines-start').addEventListener('click', startRound);
    $('#mines-cash').addEventListener('click', () => cashOut(false));
    $('#mines-new').addEventListener('click', newRound);
    $('#mines-custom-btn').addEventListener('click', applyCustomBet);
    $('#mines-custom').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCustomBet(); });
    render();
  }

  return {
    init,
    render,
    /** true, solange noch Einsatz im Spiel ist (für die Navigationswarnung) */
    isLive,
    /** bricht eine laufende Runde ab – der Einsatz ist dann verloren */
    async abandon() {
      if (!isLive()) { newRound(); return; }
      api.recordRound({
        game: 'mines',
        board: `${state.boardSize}×${state.boardSize}`,
        mines: state.mines,
        picks: picks(),
        multiplier: 0,
        staked: state.bet,
        net: -state.bet,
        abandoned: true
      });
      state.running = false;
      state.finished = false;
      state.revealed = new Set();
      state.minePositions = null;
      $('#mines-result').hidden = true;
      buildGrid();
      render();
      await api.persist();
    },
    /** Diagnose für die Tests */
    debug: () => ({
      boardSize: state.boardSize, mines: state.mines, bet: state.bet,
      picks: picks(), running: state.running, finished: state.finished,
      multiplier: currentMultiplier(), payout: currentPayout(),
      minePositions: state.minePositions ? [...state.minePositions] : null
    })
  };
}
