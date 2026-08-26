/**
 * Spielkarten als Inline-SVG.
 *
 * Die Karten holen ihre Farben aus den Theme-Tokens (--card-…), passen sich
 * also automatisch an jedes Design an. Es werden keine Bilddateien geladen.
 * Diese Datei ist bewusst spielunabhängig – ein späteres Kartenspiel kann
 * sie unverändert mitbenutzen.
 */

/** Eckdaten des Kartenbildes. */
const W = 100;
const H = 140;

/** Spaltenmitten und obere/untere Reihe des Pip-Feldes. */
const COL = { L: 32, C: 50, R: 68 };
const Y_TOP = 39;   // etwas unter dem Eckzeichen, damit nichts auf einer Höhe steht
const Y_SPAN = 62;

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
function pip(col, t) {
  const x = COL[col];
  const y = Y_TOP + t * Y_SPAN;
  const flip = t > 0.5 ? ` transform="rotate(180 ${x} ${y})"` : '';
  return `<text class="card-pip" x="${x}" y="${y}"${flip}>__S__</text>`;
}

/** Zahlenkarten 2–10. */
function numberBody(rank) {
  return (PIPS[rank] || []).map(([c, t]) => pip(c, t)).join('');
}

/** Ass: ein großes Zeichen in der Mitte. */
function aceBody() {
  return `<circle class="card-ace-ring" cx="50" cy="70" r="27"/>
    <text class="card-ace" x="50" y="70">__S__</text>`;
}

/**
 * Bildkarten: klassisch zweiköpfig – oben und unten dasselbe Motiv,
 * getrennt durch eine feine Linie. Ruhig, symmetrisch, gut lesbar.
 */
function courtBody(rank) {
  // Zeichen oben, Buchstabe darunter – beide Hälften bleiben dadurch
  // vollständig über bzw. unter der Trennlinie bei y = 70.
  const half = `
    <text class="card-court-suit" x="50" y="40">__S__</text>
    <text class="card-court-letter" x="50" y="59">${rank}</text>`;
  return `
    <rect class="card-court-frame" x="22" y="26" width="56" height="88" rx="6"/>
    <rect class="card-court-frame card-court-frame-in" x="26" y="30" width="48" height="80" rx="4"/>
    <line class="card-court-divide" x1="27" y1="70" x2="73" y2="70"/>
    <g>${half}</g>
    <g transform="rotate(180 50 70)">${half}</g>`;
}

/** Rang + Zeichen in der Ecke; die zweite Ecke ist die gedrehte erste. */
function corner(rank) {
  const label = rank === '10' ? '10' : rank;
  return `<g class="card-corner">
      <text class="card-corner-rank" x="11" y="26">${label}</text>
      <text class="card-corner-suit" x="11" y="41">__S__</text>
    </g>`;
}

/**
 * Kartenvorderseite als SVG-Zeichenkette.
 * @param {{r:string, s:string}} card
 */
export function cardFaceSvg(card) {
  const rank = card.r;
  let body;
  if (rank === 'A') body = aceBody();
  else if (rank === 'J' || rank === 'Q' || rank === 'K') body = courtBody(rank);
  else body = numberBody(Number(rank));

  const inner = `
    <rect class="card-bg" x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="9"/>
    <g class="card-ink">
      ${corner(rank)}
      <g transform="rotate(180 50 70)">${corner(rank)}</g>
      ${body}
    </g>`;

  return `<svg class="card-svg ${isRedSuit(card.s) ? 'is-red' : 'is-black'}"
      viewBox="0 0 ${W} ${H}" role="img" aria-label="${cardLabel(card)}">
      ${inner.split('__S__').join(card.s)}
    </svg>`;
}

const RANK_WORD = {
  A: 'Ass', K: 'König', Q: 'Dame', J: 'Bube'
};
const SUIT_WORD = {
  '♠': 'Pik', '♥': 'Herz', '♦': 'Karo', '♣': 'Kreuz'
};

/** Vorlesbarer Kartenname für Screenreader und Tests. */
export function cardLabel(card) {
  return `${SUIT_WORD[card.s] || ''} ${RANK_WORD[card.r] || card.r}`.trim();
}

/**
 * Ein vollständiges Kartenelement mit Vorder- und Rückseite.
 * Die Rückseite ist reines CSS (siehe .bj-card-back) – dadurch nimmt sie
 * die Theme-Farben an, ohne dass hier etwas nachgezogen werden muss.
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
      <div class="bj-card-face bj-card-back" aria-hidden="true"></div>
    </div>`;
  if (faceDown) el.setAttribute('aria-label', 'Verdeckte Karte');
  return el;
}
