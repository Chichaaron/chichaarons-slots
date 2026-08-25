/**
 * DOM-Hilfen: Bildschirmwechsel, Toasts, Einsatzübersicht,
 * Rundenauswertung und Bestätigungsdialog.
 * Enthält keine Spiellogik – die steckt in app.js.
 */
import { colorOf, money, signedMoney, COLOR_LABEL } from './roulette.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let currentScreen = null;

/**
 * Zeigt genau einen Bildschirm. Die Liste wird aus dem DOM gelesen – ein neuer
 * <section class="screen" id="screen-xyz"> funktioniert dadurch sofort, ohne
 * dass hier etwas nachgetragen werden muss.
 */
export function showScreen(name) {
  for (const el of document.querySelectorAll('.screen')) {
    el.hidden = el.id !== `screen-${name}`;
  }
  currentScreen = name;
  window.scrollTo({ top: 0 });
}

export const getScreen = () => currentScreen;

/* ------------------------------ Toasts ------------------------------ */
export function toast(message, kind = '') {
  const host = $('#toast-host');
  // Höchstens drei Meldungen gleichzeitig
  while (host.children.length >= 3) host.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = `toast ${kind}`.trim();
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 300);
  }, 2400);
}

/* ------------------------- Guthaben-Anzeige ------------------------- */
export function paintBalance(value) {
  for (const el of $$('[data-balance]')) {
    const next = money(value);
    if (el.textContent !== next) {
      el.textContent = next;
      el.classList.remove('pulse');
      void el.offsetWidth;          // Reflow erzwingen, damit die Animation neu startet
      el.classList.add('pulse');
    }
  }
}

export function paintUsername(name) {
  for (const el of $$('[data-username]')) el.textContent = name;
}

/* ----------------------- Farbpunkt je Wettart ----------------------- */
function dotClass(info, id) {
  if (id.startsWith('straight:')) return colorOf(info.number);
  if (id === 'red') return 'red';
  if (id === 'black') return 'black';
  return 'gold';
}

/**
 * Zeichnet die Einsatzübersicht rechts.
 * @param {Array<{id:string, amount:number, info:object}>} entries
 * @param {Map<string, {won:boolean, net:number}>|null} results
 */
export function renderBetList(entries, results = null) {
  const list = $('#bet-list');
  list.innerHTML = '';

  if (!entries.length) {
    const p = document.createElement('p');
    p.className = 'bet-empty';
    p.textContent = 'Noch keine Einsätze platziert.';
    list.appendChild(p);
  }

  let total = 0;
  let net = 0;
  for (const entry of entries) {
    total += entry.amount;
    const res = results?.get(entry.id);
    if (res) net += res.net;

    const row = document.createElement('div');
    row.className = `bet-row${res ? (res.won ? ' is-win' : ' is-loss') : ''}`;
    row.setAttribute('role', 'row');
    row.innerHTML = `
      <span class="bet-name"><i class="bet-dot ${dotClass(entry.info, entry.id)}"></i>${entry.info.label}</span>
      <span class="bet-amount ta-right">${money(entry.amount)}</span>
      <span class="bet-result ta-right ${res ? (res.won ? 'win' : 'loss') : 'pending'}">${
        res ? signedMoney(res.net) : '—'
      }</span>`;
    list.appendChild(row);
  }

  $('#bet-total').textContent = money(total);
  const totalEl = $('#bet-result-total');
  if (results && entries.length) {
    totalEl.textContent = signedMoney(net);
    totalEl.className = `ta-right ${net >= 0 ? 'win' : 'loss'}`;
  } else {
    totalEl.textContent = '—';
    totalEl.className = 'ta-right';
  }
}

/* ------------------------- Rundenauswertung ------------------------- */
export function showSummary(round, newBalance, { onRepeat, onNext, canRepeat }) {
  $('#summary-ball').textContent = String(round.winning);
  $('#summary-ball').className = `summary-ball ${round.color}`;
  $('#summary-title').textContent =
    round.net > 0 ? 'Gewonnen!' : round.net < 0 ? 'Verloren' : 'Einsatz zurück';
  $('#summary-sub').textContent =
    `Gewinnzahl ${round.winning} · ${COLOR_LABEL[round.color]}`;

  const list = $('#summary-list');
  list.innerHTML = '';
  // Gewinner zuerst, dann Verluste – innerhalb absteigend nach Betrag
  const sorted = [...round.results].sort((a, b) => (b.won - a.won) || (b.amount - a.amount));
  for (const r of sorted) {
    const item = document.createElement('div');
    item.className = `summary-item ${r.won ? 'win' : 'loss'}`;
    item.innerHTML = `
      <span>${r.label}</span>
      <span class="amt">${money(r.amount)}</span>
      <span class="net">${signedMoney(r.net)}</span>`;
    list.appendChild(item);
  }

  $('#summary-staked').textContent = money(round.staked);
  $('#summary-returned').textContent = money(round.returned);
  $('#summary-net').textContent = signedMoney(round.net);
  $('#summary-net').parentElement.className =
    `summary-net ${round.net > 0 ? 'win' : round.net < 0 ? 'loss' : ''}`;
  $('#summary-balance').textContent = money(newBalance);

  const repeatBtn = $('#summary-repeat');
  repeatBtn.disabled = !canRepeat;
  repeatBtn.onclick = () => { hideSummary(); onRepeat(); };
  $('#summary-next').onclick = () => { hideSummary(); onNext(); };

  $('#summary-modal').hidden = false;
  $('#summary-next').focus({ preventScroll: true });
}

export function hideSummary() {
  $('#summary-modal').hidden = true;
}

/* ------------------------ Bestätigungsdialog ------------------------ */
export function confirmDialog(title, text, confirmLabel = 'Ja, löschen') {
  return new Promise((resolve) => {
    const modal = $('#confirm-modal');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#confirm-yes').textContent = confirmLabel;
    modal.hidden = false;

    const close = (value) => {
      modal.hidden = true;
      $('#confirm-yes').onclick = null;
      $('#confirm-no').onclick = null;
      resolve(value);
    };
    $('#confirm-yes').onclick = () => close(true);
    $('#confirm-no').onclick = () => close(false);
    $('#confirm-no').focus({ preventScroll: true });
  });
}

/* --------------------------- Ergebnis-Badge --------------------------- */
export function showResultBadge(winning) {
  const badge = $('#result-badge');
  $('#result-number').textContent = String(winning);
  const color = colorOf(winning);
  const colorEl = $('#result-color');
  colorEl.textContent = COLOR_LABEL[color];
  colorEl.className = `result-color ${color}`;
  badge.hidden = false;
}

export function hideResultBadge() {
  $('#result-badge').hidden = true;
}

/* ------------------------------ Statistik ------------------------------ */
export function renderStats(stats) {
  const el = $('#panel-stats');
  const rows = [
    ['Runden gespielt', stats.rounds],
    ['Gesamteinsatz', money(stats.wagered)],
    ['Höchster Gewinn', money(stats.biggestWin)],
    ['Bestes Guthaben', money(stats.bestBalance)]
  ];
  el.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}
