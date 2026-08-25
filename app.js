/**
 * Grand Vert Roulette – Anwendungslogik.
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
import { createLedger } from './bets.js';
import { buildBoard, renderBoardChips, highlightWinner, clearHighlight, renderLastNumbers } from './table.js';
import { createWheel } from './wheel.js';
import { sound } from './sound.js';
import {
  $, $$, showScreen, getScreen, toast, paintBalance, paintUsername, renderBetList,
  showSummary, hideSummary, confirmDialog, showResultBadge, hideResultBadge, renderStats
} from './ui.js';

const SPIN_DURATION = { fast: 4200, normal: 6400, cinematic: 8600 };

/**
 * Diagnose-Objekt (window.__grandVert). Wird von den automatisierten Tests
 * gelesen und erleichtert die Fehlersuche. Enthält keine Geheimnisse:
 * der Spielstand liegt ohnehin im Browser bzw. im eigenen Supabase-Konto.
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
  wheel: null
};

/* ==================================================================== */
/* Guthaben & Speichern                                                  */
/* ==================================================================== */

const available = () => state.profile?.balance ?? 0;

/** Speichert den Spielstand im Konto. Nur aufrufen, wenn keine Einsätze offen sind. */
async function persist() {
  if (!state.profile) return;
  state.profile.updatedAt = new Date().toISOString();
  try {
    await store.saveProfile(state.profile);
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
  renderLastNumbers($('#last-numbers'), (state.profile.history || []).map((h) => h.winning));

  // Jetons deaktivieren, für die das Guthaben nicht reicht
  for (const chip of $$('#chips .chip')) {
    chip.disabled = Number(chip.dataset.value) > available() || state.phase !== 'betting';
    chip.classList.toggle('is-active', Number(chip.dataset.value) === state.chipValue);
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

/** Hinweiszeile unter dem Brett – zeigt bei 0 € das Notfall-Guthaben an. */
function renderBoardHint() {
  const hint = $('#board-hint');
  const broke = available() <= 0 && state.ledger.total() === 0 && state.phase === 'betting';
  if (!broke) {
    hint.classList.remove('has-action');
    hint.innerHTML = 'Jeton wählen, dann auf ein Feld klicken. Rechtsklick entfernt einen Jeton.';
    return;
  }
  hint.classList.add('has-action');
  hint.innerHTML = '';
  const btn = document.createElement('button');
  btn.className = 'btn btn-gold btn-sm';
  btn.textContent = `Notfall-Guthaben: +${money(APP_CONFIG.bailout)} virtuelles Spielgeld`;
  btn.onclick = async () => {
    state.profile.balance += APP_CONFIG.bailout;
    state.profile.stats.bailouts = (state.profile.stats.bailouts || 0) + 1;
    await persist();
    toast(`${money(APP_CONFIG.bailout)} gutgeschrieben.`, 'good');
    refresh();
  };
  hint.appendChild(btn);
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
  if (state.chipValue <= available() || available() <= 0) return;
  const affordable = APP_CONFIG.chips.filter((c) => c <= available());
  if (affordable.length) state.chipValue = affordable[affordable.length - 1];
}

function placeBet(betId) {
  if (state.phase !== 'betting') {
    toast('Nichts geht mehr – die Runde läuft.', 'warn');
    return;
  }
  const value = state.chipValue;
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
  state.profile.balance += round.returned;
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

function updateStats(round) {
  const s = state.profile.stats;
  s.rounds += 1;
  s.wagered += round.staked;
  if (round.net > 0) s.won += round.net;
  else s.lost += Math.abs(round.net);
  s.biggestWin = Math.max(s.biggestWin || 0, round.net);
  s.bestBalance = Math.max(s.bestBalance || 0, state.profile.balance);

  state.profile.history.unshift({
    at: new Date().toISOString(),
    winning: round.winning,
    color: round.color,
    staked: round.staked,
    net: round.net,
    balance: state.profile.balance,
    bets: round.results.map((r) => ({ id: r.id, amount: r.amount, net: r.net }))
  });
  state.profile.history = state.profile.history.slice(0, APP_CONFIG.maxHistory);
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
  for (const value of APP_CONFIG.chips) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chip chip-c${value}`;
    btn.dataset.value = String(value);
    btn.textContent = `${value} €`;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-label', `Jeton ${value} Euro`);
    btn.onclick = () => selectChip(value);
    host.appendChild(btn);
  }
}

function selectChip(value) {
  state.chipValue = value;
  sound.chip();
  refresh();
}

function applyCustomChip() {
  const input = $('#custom-amount');
  const value = Math.floor(Number(input.value));
  if (!Number.isFinite(value) || value <= 0) {
    toast('Bitte einen Betrag größer als 0 eingeben.', 'warn');
    return;
  }
  if (value > APP_CONFIG.maxBetPerField) {
    toast(`Maximal ${money(APP_CONFIG.maxBetPerField)} pro Feld.`, 'warn');
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
/* Konto / Navigation                                                    */
/* ==================================================================== */

function applySession(session) {
  state.profile = session.profile;
  paintUsername(session.user.name);
  $('#settings-account-info').textContent =
    `${session.user.name} · ${store.mode === 'supabase' ? 'Server-Konto (Supabase)' : 'Lokales Konto in diesem Browser'}`;
  paintBalance(available());
  renderStats(state.profile.stats);
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
    toast(`Willkommen, ${session.user.name}!`, 'good');
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
  showScreen('auth');
  toast('Abgemeldet. Dein Spielstand bleibt gespeichert.');
}

function navigate(target) {
  if (target === 'game') {
    if (!state.profile) return showScreen('auth');
    showScreen('game');
    state.wheel.resize();
    refresh();
    return;
  }
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
    a.download = 'grand-vert-spielstand.json';
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
  $('#set-sound').checked = state.settings.sound;
  $('#set-speed').value = state.settings.speed;
}

/* ==================================================================== */
/* Start                                                                 */
/* ==================================================================== */

async function boot() {
  const bootText = $('#boot-text');

  buildChips();
  buildBoard($('#board'), placeBet, removeBet);
  state.wheel = createWheel($('#wheel-canvas'), {
    onTick: (left) => sound.tick(left)
  });
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
  $('#custom-amount').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCustomChip(); });

  // Einstellungen
  $('#set-sound').addEventListener('change', (e) => {
    state.settings.sound = e.target.checked;
    saveSettings(state.settings);
    sound.setEnabled(state.settings.sound);
    if (state.settings.sound) sound.chip();
  });
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
  wheel: () => state.wheel?.debugState()
};

boot();
