/**
 * Spielkarten als Inline-SVG.
 *
 * Die vier Farbzeichen sind echte Vektorpfade – keine Schriftzeichen. Dadurch
 * sehen die Karten auf jedem Gerät gleich aus, bleiben bei jeder Größe
 * gestochen scharf und hängen nicht davon ab, welche Schriften installiert
 * sind. Die Farben kommen aus den --card-… Tokens, passen sich also jedem
 * Design an. Es werden keine Bilddateien geladen.
 *
 * Diese Datei ist bewusst spielunabhängig – ein späteres Kartenspiel kann
 * sie unverändert mitbenutzen.
 */

/** Eckdaten des Kartenbildes. */
const W = 100;
const H = 140;

/**
 * Die vier Farbzeichen, jeweils gezeichnet in einem Feld von 0…100.
 * `suitShape()` verschiebt und skaliert sie an die gewünschte Stelle.
 */
const SUIT_PATH = {
  '♥': 'M50 91 C50 91 6 63 6 34.5 C6 17.8 19.2 6 33.4 6 C41.2 6 47 9.8 50 16 '
     + 'C53 9.8 58.8 6 66.6 6 C80.8 6 94 17.8 94 34.5 C94 63 50 91 50 91 Z',
  '♠': 'M50 5 C50 5 6 35.5 6 60 C6 73.8 16.2 83.5 28.4 83.5 C36.4 83.5 43.4 79.4 47.4 72.8 '
     + 'C46.4 84.4 41.6 92.4 31.6 96.5 L68.4 96.5 C58.4 92.4 53.6 84.4 52.6 72.8 '
     + 'C56.6 79.4 63.6 83.5 71.6 83.5 C83.8 83.5 94 73.8 94 60 C94 35.5 50 5 50 5 Z',
  '♦': 'M50 3 C60.5 24 74.5 40.5 91 50 C74.5 59.5 60.5 76 50 97 '
     + 'C39.5 76 25.5 59.5 9 50 C25.5 40.5 39.5 24 50 3 Z',
  '♣': 'M50 4 C38.4 4 29 13.4 29 25 C29 28.7 30 32.2 31.7 35.2 C28.5 33.2 24.7 32 20.6 32 '
     + 'C9 32 -0.4 41.4 -0.4 53 C-0.4 64.6 9 74 20.6 74 C29.4 74 37 68.6 40.1 61 '
     + 'C40 72 36 86.5 27.6 96.5 L72.4 96.5 C64 86.5 60 72 59.9 61 '
     + 'C63 68.6 70.6 74 79.4 74 C91 74 100.4 64.6 100.4 53 C100.4 41.4 91 32 79.4 32 '
     + 'C75.3 32 71.5 33.2 68.3 35.2 C70 32.2 71 28.7 71 25 C71 13.4 61.6 4 50 4 Z'
};

/**
 * Ein Farbzeichen an einer bestimmten Stelle.
 * @param {string} suit  eines von ♠ ♥ ♦ ♣
 * @param {number} cx    Mittelpunkt x
 * @param {number} cy    Mittelpunkt y
 * @param {number} size  Kantenlänge
 * @param {string} cls   zusätzliche CSS-Klasse
 */
function suitShape(suit, cx, cy, size, cls = '') {
  const s = size / 100;
  const x = cx - size / 2;
  const y = cy - size / 2;
  return `<path class="card-suit ${cls}" d="${SUIT_PATH[suit]}"
    transform="translate(${round(x)} ${round(y)}) scale(${round(s, 4)})"/>`;
}

const round = (n, digits = 2) => Number(n.toFixed(digits));

/** Spaltenmitten und obere/untere Reihe des Pip-Feldes. */
const COL = { L: 33, C: 50, R: 67 };
const Y_TOP = 41;
const Y_SPAN = 58;
const PIP_SIZE = 15;

/** Pip-Anordnung der Zahlenkarten: [Spalte, Anteil von oben nach unten]. */
const PIPS = {
  2: [['C', 0], ['C', 1]],
  3: [['C', 0], ['C', 0.5], ['C', 1]],
  4: [['L', 0], ['R', 0], ['L', 1], ['R', 1]],
  5: [['L', 0], ['R', 0], ['C', 0.5], ['L', 1], ['R', 1]],
  6: [['L', 0], ['R', 0], ['L', 0.5], ['R', 0.5], ['L', 1], ['R', 1]],
  7: [['L', 0], ['R', 0], ['C', 0.25], ['L', 0.5], ['R', 0.5], ['L', 1], ['R', 1]],
  8: [['L', 0], ['R', 0], ['C', 0.25], ['L', 0.5], ['R', 0.5], ['C', 0.75], ['L', 1], ['R', 1]],
  9: [['L', 0], ['R', 0], ['L', 1 / 3], ['R', 1 / 3], ['C', 0.5],
      ['L', 2 / 3], ['R', 2 / 3], ['L', 1], ['R', 1]],
  10: [['L', 0], ['R', 0], ['C', 1 / 6], ['L', 1 / 3], ['R', 1 / 3],
       ['L', 2 / 3], ['R', 2 / 3], ['C', 5 / 6], ['L', 1], ['R', 1]]
};

const isRedSuit = (suit) => suit === '♥' || suit === '♦';

/** Ein einzelnes Pip; in der unteren Kartenhälfte steht es auf dem Kopf. */
function pip(suit, col, t) {
  const x = COL[col];
  const y = Y_TOP + t * Y_SPAN;
  const shape = suitShape(suit, x, y, PIP_SIZE, 'card-pip');
  return t > 0.5 ? `<g transform="rotate(180 ${x} ${round(y)})">${shape}</g>` : shape;
}

/** Zahlenkarten 2–10. */
function numberBody(suit, rank) {
  return (PIPS[rank] || []).map(([c, t]) => pip(suit, c, t)).join('');
}

/** Ass: ein großes Zeichen in der Mitte, umschlossen von einem feinen Ring. */
function aceBody(suit) {
  return `<circle class="card-ace-ring" cx="50" cy="70" r="27.5"/>
    ${suitShape(suit, 50, 70, 40, 'card-ace')}`;
}

/**
 * Bildkarten: klassisch zweiköpfig – oben und unten dasselbe Motiv, getrennt
 * durch eine feine Linie. Ruhig, symmetrisch und auch klein gut lesbar.
 */
function courtBody(suit, rank) {
  const half = `
    ${suitShape(suit, 50, 41, 14, 'card-court-suit')}
    <text class="card-court-letter" x="50" y="58.5">${rank}</text>`;
  return `
    <rect class="card-court-frame" x="21" y="25" width="58" height="90" rx="7"/>
    <rect class="card-court-frame card-court-frame-in" x="25.5" y="29.5" width="49" height="81" rx="4.5"/>
    <line class="card-court-divide" x1="26" y1="70" x2="74" y2="70"/>
    <g>${half}</g>
    <g transform="rotate(180 50 70)">${half}</g>`;
}

/** Rang + Zeichen in der Ecke; die zweite Ecke ist die gedrehte erste. */
function corner(suit, rank) {
  return `<g class="card-corner">
      <text class="card-corner-rank" x="12" y="24">${rank}</text>
      ${suitShape(suit, 12, 39, 12.5, 'card-corner-suit')}
    </g>`;
}

/**
 * Kartenvorderseite als SVG-Zeichenkette.
 * @param {{r:string, s:string}} card
 */
export function cardFaceSvg(card) {
  const { r: rank, s: suit } = card;
  let body;
  if (rank === 'A') body = aceBody(suit);
  else if (rank === 'J' || rank === 'Q' || rank === 'K') body = courtBody(suit, rank);
  else body = numberBody(suit, Number(rank));

  return `<svg class="card-svg ${isRedSuit(suit) ? 'is-red' : 'is-black'}"
      viewBox="0 0 ${W} ${H}" shape-rendering="geometricPrecision"
      role="img" aria-label="${cardLabel(card)}">
      <rect class="card-bg" x="1" y="1" width="${W - 2}" height="${H - 2}" rx="8.5"/>
      <rect class="card-hairline" x="4.5" y="4.5" width="${W - 9}" height="${H - 9}" rx="5.5"/>
      <g class="card-ink">
        ${corner(suit, rank)}
        <g transform="rotate(180 50 70)">${corner(suit, rank)}</g>
        ${body}
      </g>
    </svg>`;
}

const RANK_WORD = { A: 'Ass', K: 'König', Q: 'Dame', J: 'Bube' };
const SUIT_WORD = { '♠': 'Pik', '♥': 'Herz', '♦': 'Karo', '♣': 'Kreuz' };

/** Vorlesbarer Kartenname für Screenreader und Tests. */
export function cardLabel(card) {
  return `${SUIT_WORD[card.s] || ''} ${RANK_WORD[card.r] || card.r}`.trim();
}

/**
 * Ein vollständiges Kartenelement mit Vorder- und Rückseite.
 * Die Rückseite ist reines CSS (siehe .bj-card-back) – dadurch nimmt sie die
 * Theme-Farben an, ohne dass hier etwas nachgezogen werden muss.
 *
 * @param {{r:string,s:string}} card
 * @param {boolean} faceDown  verdeckt anlegen
 * @returns {HTMLElement}
 */
export function createCardElement(card, faceDown = false) {
  const el = document.createElement('div');
  el.className = `bj-card${faceDown ? ' is-down' : ''}`;
  el.dataset.rank = card.r;
  el.dataset.suit = card.s;
  el.innerHTML = `<div class="bj-card-inner">
      <div class="bj-card-face bj-card-front">${cardFaceSvg(card)}</div>
      <div class="bj-card-face bj-card-back" aria-hidden="true"><span class="bj-card-crest"></span></div>
    </div>`;
  el.setAttribute('aria-label', faceDown ? 'Verdeckte Karte' : cardLabel(card));
  return el;
}

/** Deckt ein Kartenelement auf und setzt die Beschriftung passend. */
export function flipCardElement(el, card) {
  if (!el) return;
  el.classList.remove('is-down');
  if (card) el.setAttribute('aria-label', cardLabel(card));
}
