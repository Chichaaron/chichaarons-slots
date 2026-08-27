/**
 * Chichaarons Slots – Anwendungslogik.
 *
 * Ablauf einer Runde:
 *   1. Spieler wählt einen Jeton und klickt Felder an   -> Einsatz wird SOFORT
 *      vom Guthaben abgezogen (kann nie mehr sein als vorhanden).
 *   2. "LET IT RIDE"  -> Gewinnzahl wird kryptografisch bestimmt, Tisch gesperrt.
 *   3. Animation stellt genau diese Zahl dar.
 *   4. Auswertung nach europäischen Regeln, Rückzahlung = Einsatz + Gewinn.
 *   5. Guthaben und Statistik werden im Benutzerkonto gespeichert.
 */
import { APP_CONFIG } from './config.js';
import { spinNumber, resolveRound, betInfo, money, colorOf, COLOR_LABEL } from './roulette.js';
import { store, loadSettings, saveSettings } from './storage.js';
import { createLedger, MAX_BET, MAX_BALANCE, CHIPS, MAX_CHIP, maxBetFor } from './bets.js';
import { GAMES, THEMES, DEFAULT_THEME, themeById, safeThemeId } from './catalog.js';
import { buildBoard, renderBoardChips, highlightWinner, clearHighlight, renderLastNumbers } from './table.js';
import { createWheel } from './wheel.js';
import { createMines } from './mines.js';
import { createBlackjack, CARD_SPEEDS, cardSpeedById } from './blackjack.js';
import { createCrash } from './crash.js';
import { createPlinko } from './plinko.js';
import { BONUSES, bonusById, bonusStatus, nextAvailableAt, formatDuration } from './bonus.js';
import { validateGamertag, MAX_LENGTH as TAG_MAX } from './gamertag.js';
import { sound } from './sound.js';
import {
  $, $$, showScreen, getScreen, toast, paintBalance, paintUsername, renderBetList,
  showSummary, hideSummary, confirmDialog, showResultBadge, hideResultBadge, renderStats
} from './ui.js';

const SPIN_DURATION = { fast: 4200, normal: 6400, cinematic: 8600 };

/**
 * Diagnose-Objekt (window.__grandVert). Wird von den automatisierten Tests
 * gelesen und erleichtert die Fehlersuche.
 */
const debug = { landing: null, lastRound: null };

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const state = {
  profile: null,
  ledger: createLedger(),
  chipValue: 10,
  customChip: null,
  phase: 'betting',        // betting | spinning | result
  lastSnapshot: [],
  settings: loadSettings(),
  authMode: 'login',
  prevScreen: 'menu',
  wheel: null,
  mines: null,
  blackjack: null,
  crash: null,
  plinko: null
};

/* ==================================================================== */
/* Guthaben & Speichern                                                  */
/* ==================================================================== */

const available = () => state.profile?.balance ?? 0;

/** Schreibt einen Betrag gut und bleibt dabei innerhalb der Guthabengrenze. */
function credit(amount) {
  state.profile.balance = Math.min(MAX_BALANCE, state.profile.balance + amount);
}

/** Einsatz, den der MAX-Jeton gerade bedeutet: das Kleinere aus Guthaben und Limit. */
const maxBetAmount = () => maxBetFor(available());

/** Betrag des gerade gewählten Jetons (MAX wird live berechnet). */
const chipAmount = () => (state.chipValue === MAX_CHIP ? maxBetAmount() : state.chipValue);

/**
 * Speichert den Spielstand im Konto.
 *
 * Noch nicht ausgewertete Einsätze liegen zwar schon nicht mehr im Guthaben,
 * gehören dem Spieler aber weiterhin – beim Neuladen wird die Runde ja
 * verworfen. Deshalb werden sie hier wieder mitgezählt. Nach dem Wurf
 * (phase 'result') sind sie bereits verrechnet und dürfen NICHT dazukommen.
 */
async function persist() {
  if (!state.profile) return;
  const pending = state.phase === 'betting' ? state.ledger.total() : 0;
  state.profile.updatedAt = new Date().toISOString();
  try {
    await store.saveProfile({ ...state.profile, balance: state.profile.balance + pending });
  } catch (err) {
    console.error(err);
    toast('Spielstand konnte nicht gespeichert werden.', 'warn');
  }
}

/* ==================================================================== */
/* Anzeige aktualisieren                                                 */
/* ==================================================================== */

function refresh(results = null) {
  const entries = state.ledger.entries();
  const staked = state.ledger.total();

  paintBalance(available());
  $('#staked-total').textContent = money(staked);
  renderBetList(entries, results);
  renderBoardChips($('#board'), state.ledger.map);
  renderStats(state.profile.stats);
  renderLastNumbers(
    $('#last-numbers'),
    (state.profile.history || [])
      .filter((h) => h.winning !== undefined && h.winning !== null)
      .map((h) => h.winning)
  );

  // Jetons deaktivieren, für die das Guthaben nicht reicht
  for (const chip of $$('#chips .chip')) {
    const isMax = chip.dataset.value === MAX_CHIP;
    const value = isMax ? maxBetAmount() : Number(chip.dataset.value);
    chip.disabled = state.phase !== 'betting' || value <= 0 || value > available();
    chip.classList.toggle('is-active', isMax
      ? state.chipValue === MAX_CHIP
      : value === state.chipValue);
    if (isMax) {
      const label = chip.querySelector('small');
      if (label) label.textContent = money(value);
      chip.title = `Setzt ${money(value)} – das Kleinere aus Guthaben und Limit (${money(MAX_BET)})`;
    }
  }

  const betting = state.phase === 'betting';
  $('#btn-undo').disabled = !betting || staked === 0;
  $('#btn-clear').disabled = !betting || staked === 0;
  $('#btn-repeat').disabled = !betting || state.lastSnapshot.length === 0;

  const ride = $('#btn-ride');
  ride.disabled = !betting || staked === 0;
  ride.classList.toggle('is-ready', betting && staked > 0);
  $('#ride-sub').textContent = !betting
    ? 'Runde läuft …'
    : staked > 0 ? `${money(staked)} im Spiel` : 'Einsätze platzieren';

  renderBoardHint();
}

/**
 * Hinweiszeile unter dem Brett.
 * Das Notfallguthaben liegt seit Update 8 im Shop – hier steht nur noch die
 * Bedienhilfe, bei leerem Konto mit einem Verweis dorthin.
 */
function renderBoardHint() {
  const hint = $('#board-hint');
  hint.classList.remove('has-action');
  hint.innerHTML = available() <= 0 && state.ledger.total() === 0
    ? 'Guthaben aufgebraucht – im Shop wartet das Notfallguthaben.'
    : 'Jeton wählen, dann auf ein Feld klicken. Rechtsklick entfernt einen Jeton.';
}

/* ==================================================================== */
/* Einsätze                                                              */
/* ==================================================================== */

/**
 * Wechselt auf den größten noch bezahlbaren Standard-Jeton, wenn das Guthaben
 * unter den gewählten Wert gefallen ist. Wird bewusst NICHT beim manuellen
 * Auswählen aufgerufen – eine bewusste Auswahl des Spielers bleibt stehen.
 */
function ensureAffordableChip() {
  if (state.chipValue === MAX_CHIP) return;   // MAX passt sich von selbst an
  if (state.chipValue <= available() || available() <= 0) return;
  const affordable = CHIPS.filter((c) => c <= available());
  if (affordable.length) state.chipValue = affordable[affordable.length - 1];
}

function placeBet(betId) {
  if (state.phase !== 'betting') {
    toast('Nichts geht mehr – die Runde läuft.', 'warn');
    return;
  }
  const value = chipAmount();
  if (value <= 0) {
    toast('Dein Guthaben ist aufgebraucht.', 'warn');
    return;
  }
  if (value > available()) {
    toast('Dafür reicht dein Guthaben nicht.', 'warn');
    return;
  }
  const placed = state.ledger.add(betId, value, available());
  if (!placed) {
    toast('Einsatz nicht möglich.', 'warn');
    return;
  }
  state.profile.balance -= placed;    // Einsatz sofort abziehen
  sound.chip();
  ensureAffordableChip();
  refresh();
}

function removeBet(betId) {
  if (state.phase !== 'betting') return;
  const removed = state.ledger.removeFrom(betId);
  if (!removed) return;
  state.profile.balance += removed.amount;
  sound.remove();
  refresh();
}

function undoBet() {
  const removed = state.ledger.undo();
  if (!removed) return;
  state.profile.balance += removed.amount;
  sound.remove();
  refresh();
}

function clearBets() {
  const refund = state.ledger.clear();
  if (!refund) return;
  state.profile.balance += refund;
  sound.remove();
  refresh();
}

function repeatBets() {
  if (!state.lastSnapshot.length) return;
  const spent = state.ledger.restore(state.lastSnapshot, available());
  state.profile.balance -= spent;
  if (spent === 0) toast('Guthaben reicht für die Wiederholung nicht.', 'warn');
  else sound.chip();
  refresh();
}

/* ==================================================================== */
/* Runde                                                                 */
/* ==================================================================== */

async function letItRide() {
  if (state.phase !== 'betting' || state.ledger.total() === 0) return;

  // 1) Ergebnis steht vor der Animation fest
  const winning = spinNumber();
  const entries = state.ledger.entries();
  state.lastSnapshot = state.ledger.snapshot();
  state.phase = 'spinning';

  $('#board').classList.add('is-locked');
  clearHighlight($('#board'));
  refresh();

  // 2) Brett zur Seite, Rad in die Mitte
  const stage = $('#stage');
  $('#wheel-wrap').setAttribute('aria-hidden', 'false');
  state.wheel.reset();
  state.wheel.start();
  stage.classList.add('is-spinning');
  $('#wheel-status').textContent = 'Rien ne va plus — nichts geht mehr';
  sound.spin();
  await delay(680);

  // 3) Kugel läuft auf die vorher bestimmte Zahl
  const duration = SPIN_DURATION[state.settings.speed] || SPIN_DURATION.normal;
  await state.wheel.throwBall(winning, duration);
  debug.landing = { winning, ...state.wheel.debugState() };

  // 4) Auswertung
  const round = resolveRound(entries, winning);
  debug.lastRound = round;
  const resultMap = new Map(round.results.map((r) => [r.id, r]));

  showResultBadge(winning);
  $('#wheel-status').textContent = `${winning} · ${COLOR_LABEL[colorOf(winning)]}`;
  round.net > 0 ? sound.win() : sound.lose();

  state.phase = 'result';
  renderBetList(entries, resultMap);
  await delay(1700);

  // 5) Guthaben gutschreiben (Rückzahlung = Einsatz + Gewinn bei Treffern)
  credit(round.returned);
  updateStats(round);
  paintBalance(available());

  // 6) Zurück zum Brett
  hideResultBadge();
  stage.classList.remove('is-spinning');
  $('#wheel-wrap').setAttribute('aria-hidden', 'true');
  await delay(420);
  state.wheel.stop();
  state.wheel.reset();
  highlightWinner($('#board'), winning);

  await persist();

  showSummary(round, available(), {
    canRepeat: state.lastSnapshot.reduce((s, b) => s + b.amount, 0) <= available(),
    onRepeat: () => startNextRound(true),
    onNext: () => startNextRound(false)
  });
}

/**
 * Trägt eine abgeschlossene Runde in Statistik und Verlauf ein.
 * Wird von beiden Spielen benutzt; `entry.game` unterscheidet sie.
 */
function recordRound(entry) {
  if (!state.profile) return;
  const s = state.profile.stats;
  s.rounds += 1;
  s.wagered += entry.staked;
  if (entry.net > 0) s.won += entry.net;
  else s.lost += Math.abs(entry.net);
  s.biggestWin = Math.max(s.biggestWin || 0, entry.net);
  s.bestBalance = Math.max(s.bestBalance || 0, state.profile.balance);

  state.profile.history.unshift({
    at: new Date().toISOString(),
    balance: state.profile.balance,
    ...entry
  });
  state.profile.history = state.profile.history.slice(0, APP_CONFIG.maxHistory);
  renderStats(s);
}

/**
 * Liefert (und legt bei Bedarf an) den Statistikeimer eines Minigames.
 * Er liegt innerhalb von `stats` und wird dadurch ohne weitere Datenbank-
 * änderung mitgespeichert.
 */
function gameStats(key, defaults) {
  if (!state.profile) return { ...defaults };
  const s = state.profile.stats;
  s[key] = { ...defaults, ...(typeof s[key] === 'object' && s[key] ? s[key] : {}) };
  return s[key];
}

function updateStats(round) {
  recordRound({
    game: 'roulette',
    winning: round.winning,
    color: round.color,
    staked: round.staked,
    net: round.net,
    bets: round.results.map((r) => ({ id: r.id, amount: r.amount, net: r.net }))
  });
}

function startNextRound(repeat) {
  state.ledger.clear();               // bereits ausgewertet – kein Rückerstatten
  clearHighlight($('#board'));
  $('#board').classList.remove('is-locked');
  $('#wheel-status').textContent = '';
  state.phase = 'betting';
  ensureAffordableChip();
  if (repeat) repeatBets();
  else refresh();
}

/* ==================================================================== */
/* Jetons                                                                */
/* ==================================================================== */

function buildChips() {
  const host = $('#chips');
  host.innerHTML = '';
  for (const value of CHIPS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chip chip-c${value}`;
    btn.dataset.value = String(value);
    btn.textContent = value >= 1000 ? `${value / 1000}k €` : `${value} €`;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-label', `Jeton ${value} Euro`);
    btn.onclick = () => selectChip(value);
    host.appendChild(btn);
  }

  // MAX: setzt immer das Kleinere aus Guthaben und Einsatzlimit
  const max = document.createElement('button');
  max.type = 'button';
  max.className = 'chip chip-max';
  max.dataset.value = MAX_CHIP;
  max.setAttribute('role', 'radio');
  max.setAttribute('aria-label', 'Maximalen Einsatz wählen');
  max.innerHTML = '<b>MAX</b><small>—</small>';
  max.onclick = () => selectChip(MAX_CHIP);
  host.appendChild(max);
}

function selectChip(value) {
  state.chipValue = value;
  sound.chip();
  if (value === MAX_CHIP && maxBetAmount() > 0) {
    toast(`MAX gewählt: ${money(maxBetAmount())} pro Feld.`);
  }
  refresh();
}

function applyCustomChip() {
  const input = $('#custom-amount');
  const value = Math.floor(Number(input.value));
  if (!Number.isFinite(value) || value <= 0) {
    toast('Bitte einen Betrag größer als 0 eingeben.', 'warn');
    return;
  }
  if (value > MAX_BET) {
    toast(`Maximal ${money(MAX_BET)} pro Feld.`, 'warn');
    return;
  }
  if (value > available()) {
    toast('Hinweis: Dieser Betrag liegt über deinem Guthaben.', 'warn');
  }
  state.customChip = value;

  // Eigenen Jeton in die Leiste aufnehmen (nur einer gleichzeitig)
  $('#chips .chip-custom-val')?.remove();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip chip-custom-val';
  btn.dataset.value = String(value);
  btn.textContent = `${value} €`;
  btn.setAttribute('aria-label', `Eigener Jeton ${value} Euro`);
  btn.onclick = () => selectChip(value);
  $('#chips').appendChild(btn);

  selectChip(value);
  input.value = '';
}

/* ==================================================================== */
/* Boni (Tages-, Zeit- und Wochenbonus)                                  */
/* ==================================================================== */

/**
 * Zeitpunkte der letzten Abholungen – sie kommen vom Server.
 * `serverNow`/`fetchedAt` bilden den Versatz zur Gerätezeit ab, damit der
 * Countdown weiterlaufen kann, ohne den Server jede Sekunde zu fragen.
 * Entscheiden darf über eine Abholung trotzdem nur der Server.
 */
const bonusData = {
  serverNow: 0, fetchedAt: 0,
  starter: 0, daily: 0, timed: 0, weekly: 0, bailout: 0, loaded: false
};
let bonusBusy = false;

/** Aktuelle Serverzeit, geschätzt aus dem zuletzt gemeldeten Wert. */
const serverNow = () => bonusData.serverNow + (Date.now() - bonusData.fetchedAt);

function applyBonusState(data) {
  if (!data) return;
  bonusData.serverNow = data.serverNow || Date.now();
  bonusData.fetchedAt = Date.now();
  bonusData.starter = data.starter || 0;
  bonusData.daily = data.daily || 0;
  bonusData.timed = data.timed || 0;
  bonusData.weekly = data.weekly || 0;
  bonusData.bailout = data.bailout || 0;
  bonusData.loaded = true;
}

/** Holt den Bonusstatus (inklusive Serverzeit) neu. */
async function refreshBonusState() {
  if (!state.profile) return;
  try {
    applyBonusState(await store.bonusState());
  } catch (err) {
    console.warn('Bonusstatus konnte nicht geladen werden.', err);
  }
  renderBonusCards();
  updateBonusDot();
}

/** Das Notfallguthaben hängt am Kontostand, deshalb wandert er mit hinein. */
const bonusList = () => bonusStatus(bonusData, serverNow(), { balance: available() });

/** Goldener Punkt am Shop-Eintrag, sobald mindestens ein Bonus bereitsteht. */
function updateBonusDot() {
  const dot = $('#menu-shop-badge');
  if (!dot) return;
  const ready = Boolean(state.profile) && bonusData.loaded && bonusList().some((b) => b.available);
  dot.hidden = !ready;
}

/**
 * Baut bzw. aktualisiert die Bonuskarten im Shop.
 *
 * Einmal-Boni verschwinden nach dem Abholen vollständig – keine graue Karte,
 * kein "bereits abgeholt", die Karte ist einfach nicht mehr da. Ändert sich
 * dadurch die Zusammenstellung, wird das Feld neu aufgebaut.
 */
function renderBonusCards() {
  const host = $('#bonus-grid');
  if (!host || !state.profile) return;

  const visible = bonusList().filter((b) => !b.done);
  const key = visible.map((b) => b.id).join('|');

  if (host.dataset.key !== key) {
    host.dataset.key = key;
    host.innerHTML = '';
    for (const bonus of visible) {
      const card = document.createElement('article');
      card.className = 'bonus-card';
      card.dataset.bonus = bonus.id;
      card.innerHTML = `
        <div class="bonus-head">
          <span class="bonus-coin" aria-hidden="true">€</span>
          <div>
            <h3 class="bonus-title">${bonus.label}${
              bonus.badge ? `<span class="bonus-badge">${bonus.badge}</span>` : ''}</h3>
            <strong class="bonus-amount">${money(bonus.amount)}</strong>
          </div>
        </div>
        <p class="bonus-blurb">${bonus.blurb}</p>
        <p class="bonus-timer"></p>
        <button class="btn btn-gold" type="button">ABHOLEN</button>`;
      if (bonus.condition === 'broke') card.classList.add('bonus-card-bailout');
      if (bonus.once) card.classList.add('bonus-card-once');
      card.querySelector('button').onclick = () => claimBonus(bonus.id);
      host.appendChild(card);
    }
  }

  for (const status of visible) {
    const card = host.querySelector(`[data-bonus="${status.id}"]`);
    if (!card) continue;
    const button = card.querySelector('button');
    const timer = card.querySelector('.bonus-timer');

    card.classList.toggle('is-ready', status.available);
    card.classList.toggle('is-waiting', !status.available);
    button.disabled = !status.available || bonusBusy;
    button.textContent = status.available ? 'ABHOLEN' : 'NICHT VERFÜGBAR';
    timer.innerHTML = status.available
      ? 'Jetzt abholbar'
      : status.condition === 'broke'
        ? status.note
        : `Nächster Bonus in <b>${formatDuration(status.remainingMs)}</b>`;
  }
}

/**
 * Bonus abholen. Prüfung, Gutschrift und Markierung passieren serverseitig in
 * einem Schritt – mehrfaches Klicken kann denselben Bonus nicht zweimal auslösen.
 */
async function claimBonus(kind) {
  if (bonusBusy || !state.profile) return;
  const bonus = bonusById(kind);
  if (!bonus) return;

  bonusBusy = true;
  renderBonusCards();
  try {
    // Noch nicht ausgewertete Roulette-Einsätze sind im gespeicherten Stand
    // enthalten – nach der Gutschrift müssen sie wieder abgezogen werden.
    const pending = state.phase === 'betting' ? state.ledger.total() : 0;
    const result = await store.claimBonus(kind, bonus.amount, (last) => nextAvailableAt(kind, last));
    applyBonusState(result);
    state.profile.balance = Math.max(0, result.balance - pending);
    paintBalance(available());
    ensureAffordableChip();
    if (kind === 'bailout') {
      state.profile.stats.bailouts = (state.profile.stats.bailouts || 0) + 1;
      await persist();
    }
    sound.win();
    toast(`${money(result.amount ?? bonus.amount)} gutgeschrieben!`, 'good');
    renderThemes();
    if (getScreen() === 'game') refresh();
    state.mines?.render();
    state.blackjack?.render();
    state.crash?.render();
    state.plinko?.render();
    renderBoardHint();
  } catch (err) {
    toast(err.message || 'Bonus konnte nicht abgeholt werden.', 'warn');
    await refreshBonusState();
  } finally {
    bonusBusy = false;
    renderBonusCards();
    updateBonusDot();
  }
}

/* ==================================================================== */
/* Gamertag                                                              */
/* ==================================================================== */

/** Zeigt den Gamertag überall an – im Menü steht nie die E-Mail-Adresse. */
function paintIdentity() {
  const tag = state.profile?.gamertag || null;
  paintUsername(tag || 'Gast');
  const cta = $('#menu-gamertag-cta');
  if (cta) cta.hidden = Boolean(tag);
  const settingsTag = $('#settings-gamertag');
  if (settingsTag) settingsTag.textContent = tag || 'noch keiner';
  const input = $('#gamertag-input');
  if (input && document.activeElement !== input) input.value = tag || '';
}

function showGamertagMessage(text, ok) {
  const el = $('#gamertag-msg');
  el.textContent = text;
  el.className = `gamertag-msg ${ok ? 'is-ok' : 'is-error'}`;
  el.hidden = false;
}

async function saveGamertag(ev) {
  ev.preventDefault();
  if (!state.profile) return;
  const button = $('#gamertag-save');
  const check = validateGamertag($('#gamertag-input').value);
  if (!check.ok) {
    showGamertagMessage(check.message, false);
    return;
  }
  if (check.value === state.profile.gamertag) {
    showGamertagMessage('Das ist bereits dein Gamertag.', true);
    return;
  }

  button.disabled = true;
  try {
    await store.setGamertag(check.value);
    state.profile.gamertag = check.value;
    paintIdentity();
    showGamertagMessage('Gamertag gespeichert.', true);
    sound.chip();
    toast(`Du heißt jetzt ${check.value}.`, 'good');
  } catch (err) {
    showGamertagMessage(err.message || 'Speichern fehlgeschlagen.', false);
  } finally {
    button.disabled = false;
  }
}

/* ==================================================================== */
/* Designs (Themes)                                                      */
/* ==================================================================== */

/** Alle Designs, die dem Konto gehören. Das Standarddesign ist immer dabei. */
function ownedThemes() {
  const saved = state.profile?.stats?.ownedThemes;
  const list = Array.isArray(saved) ? saved.filter((id) => themeById(id)) : [];
  return [...new Set([DEFAULT_THEME, ...list])];
}

const ownsTheme = (id) => ownedThemes().includes(id);
const activeThemeId = () => safeThemeId(state.profile?.stats?.activeTheme);

/** Setzt das Design auf der ganzen Seite. */
function applyTheme(id) {
  const themeId = safeThemeId(id);
  if (themeId === DEFAULT_THEME) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = themeId;
  state.wheel?.refreshTheme();
  state.crash?.render();          // der Graph liest seine Farben neu ein
  state.plinko?.render();         // Brett, Stifte und Felder ebenso
}

/** Kauf: prüft Besitz und Guthaben, bucht ab und aktiviert das Design. */
async function buyTheme(id) {
  const theme = themeById(id);
  if (!theme || !state.profile || ownsTheme(id)) return;
  if (available() < theme.price) {
    toast('Dafür reicht dein Guthaben nicht.', 'warn');
    return;
  }
  state.profile.balance -= theme.price;
  state.profile.stats.ownedThemes = [...ownedThemes(), id];
  state.profile.stats.activeTheme = id;
  await persist();
  applyTheme(id);
  paintBalance(available());
  ensureAffordableChip();
  sound.win();
  toast(`${theme.name} gekauft und aktiviert.`, 'good');
  renderThemes();
  if (getScreen() === 'game') refresh();
}

/** Wechselt zu einem bereits gekauften Design. */
async function activateTheme(id) {
  if (!state.profile || !ownsTheme(id) || activeThemeId() === id) return;
  state.profile.stats.activeTheme = safeThemeId(id);
  applyTheme(id);
  await persist();
  sound.chip();
  toast(`${themeById(id).name} ist jetzt aktiv.`, 'good');
  renderThemes();
}

/** Baut die Design-Karten im Shop. */
function renderThemes() {
  const host = $('#theme-grid');
  if (!host || !state.profile) return;
  host.innerHTML = '';

  for (const theme of THEMES) {
    const owned = ownsTheme(theme.id);
    const active = activeThemeId() === theme.id;
    const affordable = available() >= theme.price;

    const card = document.createElement('article');
    card.className = `theme-card${active ? ' is-active' : ''}`;

    const preview = document.createElement('div');
    preview.className = 'theme-preview';
    preview.innerHTML = theme.swatch.map((c) => `<span style="background:${c}"></span>`).join('');
    card.appendChild(preview);

    const name = document.createElement('h3');
    name.className = 'theme-name';
    name.innerHTML = `${theme.name}${active ? '<span class="theme-tag">Aktiv</span>' : ''}`;
    card.appendChild(name);

    const blurb = document.createElement('p');
    blurb.className = 'theme-blurb';
    blurb.textContent = theme.blurb;
    card.appendChild(blurb);

    const button = document.createElement('button');
    button.type = 'button';
    if (active) {
      button.className = 'btn btn-ghost';
      button.textContent = 'Aktiviert';
      button.disabled = true;
    } else if (owned) {
      button.className = 'btn btn-gold';
      button.textContent = 'Aktivieren';
      button.onclick = () => activateTheme(theme.id);
    } else {
      button.className = `btn ${affordable ? 'btn-gold' : 'btn-ghost'}`;
      button.innerHTML = `Kaufen · <span class="theme-price">${money(theme.price)}</span>`;
      button.disabled = !affordable;
      button.onclick = () => buyTheme(theme.id);
    }
    card.appendChild(button);

    if (!owned && !affordable) {
      const hint = document.createElement('p');
      hint.className = 'theme-hint';
      hint.textContent = `Es fehlen noch ${money(theme.price - available())}`;
      card.appendChild(hint);
    }
    host.appendChild(card);
  }
}

/* ==================================================================== */
/* Spielauswahl                                                          */
/* ==================================================================== */

/** Baut die Karten der Spielauswahl aus dem Katalog (js/catalog.js). */
function renderGames() {
  const host = $('#game-grid');
  if (!host) return;
  host.innerHTML = '';

  for (const game of GAMES) {
    const card = document.createElement(game.available ? 'button' : 'article');
    card.className = `game-card${game.available ? '' : ' is-locked'}`;
    card.dataset.game = game.id;
    if (game.available) {
      card.type = 'button';
      card.onclick = () => openGame(game.id);
    } else {
      card.setAttribute('aria-disabled', 'true');
    }

    // Vorschaubild: eigene Grafik je Spiel, sonst das Platzhaltermuster
    const art = document.createElement('div');
    art.className = `game-art game-art-${game.available ? game.id : 'soon'}`;
    art.setAttribute('aria-hidden', 'true');
    if (game.id === 'crash') {
      art.innerHTML = `<svg viewBox="0 0 120 60" aria-hidden="true" class="art-crash">
          <path class="art-crash-fill" d="M6 54 C40 52 62 44 80 28 C92 17 100 10 114 6 L114 54 Z"/>
          <path class="art-crash-line" d="M6 54 C40 52 62 44 80 28 C92 17 100 10 114 6"/>
          <circle class="art-crash-dot" cx="114" cy="6" r="4.5"/>
        </svg>`;
    }
    if (game.id === 'blackjack') {
      art.innerHTML = `<span class="art-card art-card-1">A<i>&#9824;</i></span>
        <span class="art-card art-card-2">K<i>&#9829;</i></span>
        <span class="art-card art-card-3">10<i>&#9827;</i></span>`;
    }
    if (game.id === 'plinko') {
      // drei Stiftreihen, eine Kugel und die Multiplikatorleiste
      const pins = [[0, 3], [1, 4], [2, 5]].flatMap(([row, count]) =>
        Array.from({ length: count }, (_, i) => {
          const x = 60 + (i - (count - 1) / 2) * 15;
          return `<circle class="art-plinko-pin" cx="${x}" cy="${12 + row * 13}" r="2.6"/>`;
        }));
      const slots = [1, 2, 3, 3, 2, 1].map((tone, i) =>
        `<rect class="art-plinko-slot-${tone}" x="${16 + i * 15}" y="52" width="12.5" height="7" rx="2"/>`);
      art.innerHTML = `<svg viewBox="0 0 120 62" aria-hidden="true" class="art-plinko">
          ${pins.join('')}${slots.join('')}
          <circle class="art-plinko-ball" cx="67" cy="26" r="4.6"/>
        </svg>`;
    }
    if (game.id === 'mines') {
      const marks = { 2: 'is-coin', 4: 'is-mine', 6: 'is-coin', 7: 'is-coin' };
      art.innerHTML = Array.from({ length: 9 },
        (_, i) => `<span class="art-tile ${marks[i] || ''}"></span>`).join('');
    }
    card.appendChild(art);

    const head = document.createElement('div');
    head.innerHTML = `<h2 class="game-title">${game.title}</h2>
      <p class="game-tagline">${game.tagline}</p>`;
    card.appendChild(head);

    const facts = document.createElement('div');
    facts.className = 'game-facts';
    facts.innerHTML = (game.facts || []).map((f) => `<span class="game-fact">${f}</span>`).join('');
    card.appendChild(facts);

    if (game.available) {
      const cta = document.createElement('span');
      cta.className = 'btn btn-gold';
      cta.textContent = 'Spielen';
      card.appendChild(cta);
    } else {
      const cta = document.createElement('span');
      cta.className = 'game-cta';
      cta.textContent = 'In Arbeit';
      card.appendChild(cta);
    }
    host.appendChild(card);
  }
}

/** Öffnet ein Spiel aus dem Katalog. */
function openGame(gameId) {
  const game = GAMES.find((g) => g.id === gameId);
  if (!game?.available || !game.screen) return;
  navigate(game.screen);
}

/* ==================================================================== */
/* Konto / Navigation                                                    */
/* ==================================================================== */

function applySession(session) {
  state.profile = session.profile;
  // Im Menü erscheint der Gamertag – die E-Mail-Adresse steht nur noch in den
  // Einstellungen, wo der Spieler sein eigenes Konto verwaltet.
  paintIdentity();
  $('#settings-account-info').textContent =
    `${session.user.name} · ${store.mode === 'supabase' ? 'Server-Konto (Supabase)' : 'Lokales Konto in diesem Browser'}`;
  applyTheme(activeThemeId());
  paintBalance(available());
  renderStats(state.profile.stats);
  renderThemes();
  state.blackjack?.render();
  state.crash?.render();
  state.plinko?.render();
  $('#gamertag-msg').hidden = true;
  refreshBonusState();
}

async function handleAuthSubmit(ev) {
  ev.preventDefault();
  const errorEl = $('#auth-error');
  errorEl.hidden = true;

  const identifier = $('#auth-identifier').value.trim();
  const password = $('#auth-password').value;
  const submit = $('#auth-submit');

  const idError = store.validateIdentifier(identifier);
  if (idError) return showAuthError(idError);
  if (password.length < 6) return showAuthError('Das Passwort braucht mindestens 6 Zeichen.');
  if (state.authMode === 'register' && password !== $('#auth-password2').value) {
    return showAuthError('Die beiden Passwörter stimmen nicht überein.');
  }

  submit.disabled = true;
  submit.textContent = 'Einen Moment …';
  try {
    const session = state.authMode === 'register'
      ? await store.register(identifier, password)
      : await store.login(identifier, password);
    applySession(session);
    $('#auth-password').value = '';
    $('#auth-password2').value = '';
    showScreen('menu');
    toast(state.profile.gamertag ? `Willkommen zurück, ${state.profile.gamertag}!` : 'Willkommen!', 'good');
  } catch (err) {
    showAuthError(err.message || 'Anmeldung fehlgeschlagen.');
  } finally {
    submit.disabled = false;
    submit.textContent = state.authMode === 'register' ? 'Konto erstellen' : 'Anmelden';
  }
}

function showAuthError(message) {
  const el = $('#auth-error');
  el.textContent = message;
  el.hidden = false;
}

function setAuthMode(mode) {
  state.authMode = mode;
  for (const tab of $$('[data-auth-tab]')) {
    const active = tab.dataset.authTab === mode;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  $('#auth-password2-field').hidden = mode !== 'register';
  $('#auth-submit').textContent = mode === 'register' ? 'Konto erstellen' : 'Anmelden';
  $('#auth-password').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  $('#auth-error').hidden = true;
}

async function logout() {
  if (state.ledger.total() > 0) clearBets();
  await persist();
  await store.logout();
  state.profile = null;
  state.lastSnapshot = [];
  bonusData.loaded = false;
  updateBonusDot();
  applyTheme(DEFAULT_THEME);
  showScreen('auth');
  toast('Abgemeldet. Dein Spielstand bleibt gespeichert.');
}

/**
 * Wechselt den Bildschirm. Neue Bereiche brauchen hier nur einen Eintrag,
 * wenn sie beim Öffnen etwas vorbereiten müssen.
 */
async function navigate(target) {
  const needsAccount = ['game', 'games', 'mines', 'blackjack', 'crash', 'plinko', 'shop', 'settings'];
  if (needsAccount.includes(target) && !state.profile) return showScreen('auth');

  // Eine laufende Mines-Runde hat bereits Geld auf dem Tisch: nicht versehentlich verlassen.
  if (getScreen() === 'mines' && target !== 'mines' && state.mines?.isLive()) {
    const leave = await confirmDialog(
      'Runde läuft noch',
      'Dein Einsatz ist bereits gesetzt. Wenn du die Runde jetzt verlässt, ist er verloren.',
      'Trotzdem verlassen'
    );
    if (!leave) return;
    await state.mines.abandon();
  }

  // Eine laufende Blackjack-Runde ebenso: die Einsätze liegen schon auf dem Tisch.
  if (getScreen() === 'blackjack' && target !== 'blackjack' && state.blackjack?.isLive()) {
    const leave = await confirmDialog(
      'Runde läuft noch',
      'Deine Einsätze liegen bereits auf dem Tisch. Wenn du die Runde jetzt verlässt, sind sie verloren.',
      'Trotzdem verlassen'
    );
    if (!leave) return;
    await state.blackjack.abandon();
  }

  if (target === 'mines') {
    state.mines.render();
    showScreen('mines');
    return;
  }

  // Eine laufende Crash-Runde ebenso: der Einsatz ist schon gesetzt.
  if (getScreen() === 'crash' && target !== 'crash' && state.crash?.isLive()) {
    const leave = await confirmDialog(
      'Runde läuft noch',
      'Dein Einsatz ist bereits gesetzt. Wenn du die Runde jetzt verlässt, ist er verloren.',
      'Trotzdem verlassen'
    );
    if (!leave) return;
    await state.crash.abandon();
  }

  if (target === 'blackjack') {
    state.blackjack.render();
    showScreen('blackjack');
    return;
  }

  if (target === 'crash') {
    showScreen('crash');
    state.crash.render();
    return;
  }

  // Plinko hat keine offene Runde: fliegende Kugeln werden beim Verlassen
  // sofort abgerechnet, es kann also nichts verloren gehen.
  if (getScreen() === 'plinko' && target !== 'plinko') state.plinko?.flush();

  if (target === 'plinko') {
    showScreen('plinko');
    state.plinko.render();
    return;
  }

  if (target === 'game') {
    showScreen('game');
    state.wheel.resize();
    refresh();
    return;
  }
  if (target === 'settings') requestAnimationFrame(paintVolume);
  if (target === 'games') renderGames();
  if (target === 'shop') { renderThemes(); renderBonusCards(); refreshBonusState(); }
  if (target === 'menu') updateBonusDot();
  if (target === 'privacy') state.prevScreen = getScreen() || 'menu';
  showScreen(target);
}

/**
 * Zeigt alle gespeicherten Daten an – zum Ansehen, Kopieren und Herunterladen.
 * Der Text im Fenster ist der eigentliche Export: er funktioniert auch dort,
 * wo der Browser den Datei-Download blockiert (z. B. in eingebetteten Seiten).
 */
function exportData() {
  const payload = {
    exportiertAm: new Date().toISOString(),
    konto: store.userName,
    gamertag: state.profile.gamertag,
    modus: store.mode,
    guthaben: state.profile.balance,
    statistik: state.profile.stats,
    runden: state.profile.history
  };
  const json = JSON.stringify(payload, null, 2);
  const box = $('#export-json');
  box.value = json;
  $('#export-modal').hidden = false;
  box.focus({ preventScroll: true });
  box.select();

  $('#export-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(json);
      toast('In die Zwischenablage kopiert.', 'good');
    } catch {
      box.select();
      toast('Bitte mit Strg+C bzw. Cmd+C kopieren.', 'warn');
    }
  };

  $('#export-download').onclick = () => {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chichaarons-slots-spielstand.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  $('#export-close').onclick = () => { $('#export-modal').hidden = true; };
}

async function deleteAccount() {
  const ok = await confirmDialog(
    'Konto wirklich löschen?',
    'Konto, Guthaben, Statistik und Rundenverlauf werden unwiderruflich gelöscht. Das lässt sich nicht rückgängig machen.',
    'Endgültig löschen'
  );
  if (!ok) return;
  try {
    await store.deleteAccount();
    state.profile = null;
    state.ledger.clear();
    applyTheme(DEFAULT_THEME);
    showScreen('auth');
    toast('Konto und alle Daten wurden gelöscht.', 'good');
  } catch (err) {
    toast(err.message || 'Löschen fehlgeschlagen.', 'warn');
  }
}

/* ==================================================================== */
/* Einstellungen                                                         */
/* ==================================================================== */

function applySettings() {
  sound.setEnabled(state.settings.sound);
  sound.setVolume(volumePercent() / 100);
  $('#set-sound').checked = state.settings.sound;
  $('#set-speed').value = state.settings.speed;
  paintVolume();
  state.settings.cardSpeed = cardSpeedId();
  paintCardSpeed();
  state.blackjack?.refreshSpeed();
}

/** Lautstärke als ganze Prozent, immer innerhalb 0…100. */
function volumePercent() {
  const v = Number(state.settings.volume);
  return Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 70;
}

/**
 * Zeichnet den Lautstärkeregler – Reglerposition, goldene Linie, Prozentzahl
 * und die tatsächliche Lautstärke kommen alle aus DEMSELBEN Wert.
 *
 * Die goldene Linie wird in Pixeln gesetzt, nicht in Prozent: Der Griff
 * wandert nur zwischen `halbe Griffbreite` und `Breite − halbe Griffbreite`.
 * Mit einem Prozentwert liefe die Linie dem Griff sonst systematisch davon.
 */
function paintVolume() {
  const slider = $('#set-volume');
  const output = $('#set-volume-value');
  const pct = volumePercent();

  sound.setVolume(pct / 100);
  if (output) output.textContent = `${pct} %`;
  if (!slider) return;
  if (slider.value !== String(pct)) slider.value = String(pct);

  const width = slider.getBoundingClientRect().width;
  const thumb = VOLUME_THUMB_PX;
  slider.style.setProperty('--fill', width > thumb
    ? `${(thumb / 2) + (pct / 100) * (width - thumb)}px`
    : `${pct}%`);          // Bildschirm noch verborgen: Prozent genügt
}

/** Griffbreite des Reglers – muss zum Wert im Stylesheet passen. */
const VOLUME_THUMB_PX = 18;

/** Gewählte Kartengeschwindigkeit für Blackjack (immer eine gültige Stufe). */
function cardSpeedId() {
  return cardSpeedById(state.settings.cardSpeed).id;
}

/**
 * Kleine Merker für die Oberfläche (z. B. ob die Blackjack-Bilanz offen ist).
 * Landen in denselben lokalen Einstellungen wie Sound und Tempo.
 */
function getPref(key, fallback = null) {
  const value = state.settings[key];
  return value === undefined ? fallback : value;
}

function setPref(key, value) {
  state.settings[key] = value;
  saveSettings(state.settings);
}

/** Baut die vier Auswahlknöpfe für die Kartengeschwindigkeit. */
function buildCardSpeedOptions() {
  const host = $('#set-card-speed');
  if (!host) return;
  host.innerHTML = '';
  for (const option of CARD_SPEEDS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'speed-option';
    btn.dataset.speed = option.id;
    btn.setAttribute('role', 'radio');
    btn.innerHTML = `<b>${option.label}</b><small>${option.hint}</small>`;
    btn.onclick = () => selectCardSpeed(option.id);
    host.appendChild(btn);
  }
  paintCardSpeed();
}

function paintCardSpeed() {
  const active = cardSpeedId();
  for (const btn of $$('#set-card-speed .speed-option')) {
    const on = btn.dataset.speed === active;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-checked', String(on));
  }
}

function selectCardSpeed(id) {
  state.settings.cardSpeed = cardSpeedById(id).id;
  saveSettings(state.settings);
  paintCardSpeed();
  state.blackjack?.refreshSpeed();
  sound.card();
}

/* ==================================================================== */
/* Start                                                                 */
/* ==================================================================== */

async function boot() {
  const bootText = $('#boot-text');

  buildChips();
  renderGames();
  buildBoard($('#board'), placeBet, removeBet);
  state.wheel = createWheel($('#wheel-canvas'), {
    onTick: (left) => sound.tick(left)
  });

  // Mines bekommt nur eine schmale Schnittstelle zum Konto – die Roulette-Logik
  // bleibt davon vollständig unberührt.
  state.mines = createMines({
    available,
    spend: (n) => { state.profile.balance -= n; },
    credit,
    persist,
    paintBalance: () => paintBalance(available()),
    recordRound,
    toast,
    sound
  });
  state.mines.init();

  // Blackjack nutzt dieselbe schmale Schnittstelle wie Mines.
  state.blackjack = createBlackjack({
    available,
    spend: (n) => { state.profile.balance -= n; },
    credit,
    persist,
    paintBalance: () => paintBalance(available()),
    recordRound,
    gameStats,
    toast,
    cardSpeed: cardSpeedId,
    getPref,
    setPref,
    sound
  });
  state.blackjack.init();

  // Crash bekommt dieselbe schmale Schnittstelle wie Mines und Blackjack.
  state.crash = createCrash({
    available,
    spend: (n) => { state.profile.balance -= n; },
    credit,
    persist,
    paintBalance: () => paintBalance(available()),
    recordRound,
    gameStats,
    getPref,
    setPref,
    toast,
    sound
  });
  state.crash.init();

  // Plinko bekommt dieselbe schmale Schnittstelle wie die anderen Minigames.
  state.plinko = createPlinko({
    available,
    spend: (n) => { state.profile.balance -= n; },
    credit,
    persist,
    paintBalance: () => paintBalance(available()),
    recordRound,
    gameStats,
    getPref,
    setPref,
    toast,
    sound
  });
  state.plinko.init();

  buildCardSpeedOptions();
  applySettings();

  // Navigation
  for (const el of $$('[data-nav]')) el.addEventListener('click', () => navigate(el.dataset.nav));
  $('#privacy-back').addEventListener('click', () => showScreen(state.prevScreen || 'menu'));
  for (const tab of $$('[data-auth-tab]')) tab.addEventListener('click', () => setAuthMode(tab.dataset.authTab));
  $('#auth-form').addEventListener('submit', handleAuthSubmit);
  $('#btn-logout').addEventListener('click', logout);
  $('#btn-logout-2').addEventListener('click', logout);

  // Spielsteuerung
  $('#btn-ride').addEventListener('click', letItRide);
  $('#btn-undo').addEventListener('click', undoBet);
  $('#btn-clear').addEventListener('click', clearBets);
  $('#btn-repeat').addEventListener('click', repeatBets);
  $('#btn-custom').addEventListener('click', applyCustomChip);
  $('#gamertag-form').addEventListener('submit', saveGamertag);
  $('#gamertag-input').setAttribute('maxlength', String(TAG_MAX));
  $('#menu-gamertag-cta').addEventListener('click', () => navigate('settings'));

  // Countdown, goldener Punkt und Freischaltung laufen sekündlich weiter –
  // auch wenn der Spieler gerade Roulette oder Mines spielt.
  let wasReady = false;
  setInterval(() => {
    if (!state.profile || !bonusData.loaded) return;
    const ready = bonusList().some((b) => b.available);
    // Sobald ein Bonus frei wird, einmal beim Server rückfragen
    if (ready && !wasReady) refreshBonusState();
    wasReady = ready;
    updateBonusDot();
    if (getScreen() === 'shop') renderBonusCards();
  }, 1000);
  $('#custom-amount').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCustomChip(); });

  // Einstellungen
  $('#set-sound').addEventListener('change', (e) => {
    state.settings.sound = e.target.checked;
    saveSettings(state.settings);
    sound.setEnabled(state.settings.sound);
    if (state.settings.sound) sound.chip();
  });
  $('#set-volume').addEventListener('input', (e) => {
    state.settings.volume = Number(e.target.value);
    paintVolume();
  });
  $('#set-volume').addEventListener('change', () => {
    saveSettings(state.settings);
    if (state.settings.sound) sound.card();
  });
  // Breite ändert sich (Fenstergröße, Bildschirmwechsel) -> Linie nachziehen
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => paintVolume()).observe($('#set-volume'));
  }
  window.addEventListener('resize', paintVolume);
  $('#set-speed').addEventListener('change', (e) => {
    state.settings.speed = e.target.value;
    saveSettings(state.settings);
  });
  $('#btn-export').addEventListener('click', exportData);
  $('#btn-delete').addEventListener('click', deleteAccount);

  // Backend vorbereiten
  bootText.textContent = 'Konto wird geprüft …';
  try {
    await store.init();
  } catch (err) {
    bootText.textContent = err.message;
    return;
  }

  // Anmeldemaske an das aktive Backend anpassen
  $('#auth-id-label').textContent = store.identifierLabel;
  $('#auth-id-hint').textContent = store.identifierHint;
  $('#auth-identifier').type = store.identifierType;
  $('#auth-identifier').autocomplete = store.identifierType === 'email' ? 'email' : 'username';
  $('#auth-mode-note').textContent = store.mode === 'supabase'
    ? 'Konten liegen sicher bei Supabase.'
    : 'Konten werden in diesem Browser gespeichert.';
  $('#privacy-storage-note').textContent = store.mode === 'supabase'
    ? 'Konto und Spielstand liegen in deinem Supabase-Projekt. Die Zeilen sind per Row-Level-Security so geschützt, dass nur du selbst deinen Spielstand lesen und ändern kannst.'
    : 'Konto und Spielstand liegen ausschließlich lokal im Speicher deines Browsers (localStorage). Es werden keine Daten an einen Server übertragen.';
  setAuthMode('login');

  // Bestehende Sitzung wiederherstellen -> Guthaben bleibt erhalten
  try {
    const session = await store.restoreSession();
    if (session) {
      applySession(session);
      showScreen('menu');
    } else {
      showScreen('auth');
    }
  } catch (err) {
    console.error(err);
    showScreen('auth');
  }

  if (store.fallbackReason) toast(store.fallbackReason, 'warn');

  $('#boot').classList.add('is-gone');
  setTimeout(() => { $('#boot').hidden = true; }, 400);
}

// Escape schließt die Rundenauswertung und startet die nächste Runde
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#export-modal').hidden) { $('#export-modal').hidden = true; return; }
  if (!$('#summary-modal').hidden) {
    hideSummary();
    startNextRound(false);
  }
});

window.__grandVert = {
  get landing() { return debug.landing; },
  get lastRound() { return debug.lastRound; },
  get balance() { return available(); },
  get staked() { return state.ledger.total(); },
  get phase() { return state.phase; },
  get bets() { return [...state.ledger.map.entries()]; },
  get profile() { return state.profile; },
  wheel: () => state.wheel?.debugState(),
  mines: () => state.mines?.debug(),
  blackjack: () => state.blackjack?.debug(),
  blackjackGame: () => state.blackjack,
  crash: () => state.crash?.debug(),
  crashGame: () => state.crash,
  plinko: () => state.plinko?.debug(),
  plinkoGame: () => state.plinko,
  /** Speichert den aktuellen Stand – von den automatisierten Tests genutzt. */
  save: () => persist()
};

boot();
