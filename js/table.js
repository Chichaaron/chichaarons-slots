/**
 * Baut das europäische Roulette-Brett als CSS-Grid auf und hält die
 * Jeton-Darstellung auf den Feldern aktuell.
 *
 * Rasteraufbau (14 Spalten × 5 Zeilen):
 *   Spalte 1        -> 0 (über drei Zeilen)
 *   Spalte 2–13     -> die Zahlen 1–36, spaltenweise von unten nach oben
 *   Spalte 14       -> die drei "2 to 1"-Kolonnenwetten
 *   Zeile 4         -> 1st 12 / 2nd 12 / 3rd 12
 *   Zeile 5         -> 1-18 / EVEN / ROT / SCHWARZ / ODD / 19-36
 */
import { colorOf, betInfo } from './roulette.js';

const nfShort = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

/**
 * Kompakte Beschriftung für den Jeton auf dem Feld.
 * 1250 -> "1,3k" · 250000 -> "250k" · 12000000 -> "12M" · 999999999 -> "1Mrd"
 * Der genaue Betrag steht im Tooltip des Jetons.
 */
function chipLabel(value) {
  // ab 10 ganze Zahlen, darunter eine Nachkommastelle ohne unnötige ",0"
  const short = (v) => String(v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).replace('.', ',');
  if (value >= 999.5e6) return `${short(value / 1e9)}Mrd`;
  if (value >= 999.5e3) return `${short(value / 1e6)}M`;
  if (value >= 999.5) return `${short(value / 1e3)}k`;
  return nfShort.format(value);
}

function makeCell({ id, text, className = '', col, row, colSpan = 1, rowSpan = 1, aria }) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `cell ${className}`.trim();
  el.dataset.bet = id;
  el.style.gridColumn = `${col} / span ${colSpan}`;
  el.style.gridRow = `${row} / span ${rowSpan}`;
  el.setAttribute('aria-label', aria || text);
  if (text) {
    const span = document.createElement('span');
    span.className = 'cell-text';
    span.textContent = text;
    el.appendChild(span);
  }
  return el;
}

/**
 * Erzeugt das Brett.
 * @param {HTMLElement} boardEl
 * @param {(betId:string, ev:MouseEvent)=>void} onPlace   Linksklick
 * @param {(betId:string)=>void} onRemove                 Rechtsklick
 */
export function buildBoard(boardEl, onPlace, onRemove) {
  boardEl.innerHTML = '';
  const frag = document.createDocumentFragment();

  // 0 – links, über alle drei Zahlenzeilen
  frag.appendChild(makeCell({
    id: 'straight:0', text: '0', className: 'green cell-zero', col: 1, row: 1, rowSpan: 3, aria: 'Zahl 0'
  }));

  // 1–36
  for (let n = 1; n <= 36; n++) {
    const col = 2 + Math.floor((n - 1) / 3);   // 12 Zahlenspalten
    const row = 3 - ((n - 1) % 3);             // unten 1,4,7… / oben 3,6,9…
    frag.appendChild(makeCell({
      id: `straight:${n}`, text: String(n), className: colorOf(n), col, row, aria: `Zahl ${n}`
    }));
  }

  // "2 to 1" – Kolonnen. Zeile 1 = Zahlen 3,6,9… (col3) usw.
  const columnBets = [['col3', 1], ['col2', 2], ['col1', 3]];
  for (const [id, row] of columnBets) {
    const cell = makeCell({
      id, text: '2 to 1', className: 'green cell-col', col: 14, row, aria: betInfo(id).label
    });
    // Kurzform für schmale Bildschirme (per CSS eingeblendet)
    const short = document.createElement('span');
    short.className = 'cell-text-sm';
    short.textContent = '2:1';
    cell.appendChild(short);
    frag.appendChild(cell);
  }

  // Dutzende
  const dozens = [['dozen1', '1st 12', 2], ['dozen2', '2nd 12', 6], ['dozen3', '3rd 12', 10]];
  for (const [id, text, col] of dozens) {
    frag.appendChild(makeCell({ id, text, className: 'green cell-outside', col, row: 4, colSpan: 4 }));
  }

  // Einfache Chancen
  const evens = [
    ['low', '1 – 18', 2], ['even', 'EVEN', 4], ['red', '', 6],
    ['black', '', 8], ['odd', 'ODD', 10], ['high', '19 – 36', 12]
  ];
  for (const [id, text, col] of evens) {
    const isColor = id === 'red' || id === 'black';
    const cell = makeCell({
      id, text,
      className: `green cell-outside${isColor ? ` cell-swatch for-${id}` : ''}`,
      col, row: 5, colSpan: 2,
      aria: betInfo(id).label
    });
    if (isColor) {
      const sw = document.createElement('span');
      sw.className = 'swatch';
      cell.appendChild(sw);
    }
    frag.appendChild(cell);
  }

  boardEl.appendChild(frag);

  boardEl.addEventListener('click', (ev) => {
    const cell = ev.target.closest('.cell');
    if (!cell || boardEl.classList.contains('is-locked')) return;
    onPlace(cell.dataset.bet, ev);
  });

  // Rechtsklick nimmt einen Einsatz wieder weg
  boardEl.addEventListener('contextmenu', (ev) => {
    const cell = ev.target.closest('.cell');
    if (!cell) return;
    ev.preventDefault();
    if (boardEl.classList.contains('is-locked')) return;
    onRemove(cell.dataset.bet);
  });
}

/** Zeichnet die Jetons auf den Feldern anhand der aktuellen Einsätze neu. */
export function renderBoardChips(boardEl, betMap) {
  for (const cell of boardEl.querySelectorAll('.cell')) {
    const amount = betMap.get(cell.dataset.bet) || 0;
    let chip = cell.querySelector('.field-chip');
    if (!amount) {
      chip?.remove();
      continue;
    }
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'field-chip';
      cell.appendChild(chip);
    }
    const label = chipLabel(amount);
    if (chip.textContent !== label) chip.textContent = label;
    chip.title = `${amount} €`;
  }
}

/** Hebt nach dem Wurf das Gewinnfeld (und die passenden Außenwetten) hervor. */
export function highlightWinner(boardEl, winning) {
  clearHighlight(boardEl);
  for (const cell of boardEl.querySelectorAll('.cell')) {
    if (betInfo(cell.dataset.bet).matches(winning)) cell.classList.add('is-winner');
  }
}

export function clearHighlight(boardEl) {
  for (const cell of boardEl.querySelectorAll('.is-winner')) cell.classList.remove('is-winner');
}

/** Zeigt die zuletzt gefallenen Zahlen über dem Brett. */
export function renderLastNumbers(el, history) {
  el.innerHTML = '';
  for (const n of history.slice(0, 12)) {
    const dot = document.createElement('span');
    dot.className = `last-num ${colorOf(n)}`;
    dot.textContent = String(n);
    el.appendChild(dot);
  }
}
