/**
 * Roulette-Kern: Radreihenfolge, Farben, Zufallssystem, Wettarten
 * und Auszahlungsregeln nach europäischem (Single-Zero) Roulette.
 *
 * Diese Datei enthält KEINE DOM-Logik, damit sie isoliert testbar bleibt.
 */

/** Reihenfolge der Zahlen auf einem echten europäischen Rad (im Uhrzeigersinn ab 0). */
export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23,
  10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

/** Rote Zahlen im europäischen Roulette. Alles andere (außer 0) ist schwarz. */
export const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36
]);

/** @returns {'green'|'red'|'black'} */
export function colorOf(n) {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

export const COLOR_LABEL = { green: 'Grün', red: 'Rot', black: 'Schwarz' };

/* ------------------------------------------------------------------ */
/* Zufallssystem                                                       */
/* ------------------------------------------------------------------ */

/**
 * Gleichverteilte Zufallszahl 0–36 aus dem kryptografischen Zufallsgenerator
 * des Browsers. Rejection-Sampling verhindert die Modulo-Verzerrung, die
 * `crypto % 37` erzeugen würde.
 */
export function spinNumber() {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    // 4294967295 = 2^32-1; größter durch 37 teilbarer Bereich darunter:
    const limit = Math.floor(4294967296 / 37) * 37;
    let value;
    do {
      cryptoObj.getRandomValues(buf);
      value = buf[0];
    } while (value >= limit);
    return value % 37;
  }
  // Fallback (sollte in modernen Browsern nie greifen)
  return Math.floor(Math.random() * 37);
}

/* ------------------------------------------------------------------ */
/* Wettarten                                                           */
/* ------------------------------------------------------------------ */

/**
 * Jede Wette hat eine ID, ein Label für die Übersicht, eine Auszahlungsquote
 * (x:1) und eine Prüffunktion gegen die Gewinnzahl.
 *
 * Wichtig: `payout` ist der GEWINN pro Einsatz-Euro. Bei einem Treffer
 * bekommt der Spieler `Einsatz * (payout + 1)` zurück – also Gewinn PLUS
 * den ursprünglichen Einsatz.
 */
const OUTSIDE_BETS = {
  red:    { label: 'Rot',      short: 'ROT',    payout: 1, matches: (n) => n !== 0 && RED_NUMBERS.has(n) },
  black:  { label: 'Schwarz',  short: 'SCHWARZ',payout: 1, matches: (n) => n !== 0 && !RED_NUMBERS.has(n) },
  even:   { label: 'Gerade',   short: 'EVEN',   payout: 1, matches: (n) => n !== 0 && n % 2 === 0 },
  odd:    { label: 'Ungerade', short: 'ODD',    payout: 1, matches: (n) => n !== 0 && n % 2 === 1 },
  low:    { label: '1 – 18',   short: '1-18',   payout: 1, matches: (n) => n >= 1 && n <= 18 },
  high:   { label: '19 – 36',  short: '19-36',  payout: 1, matches: (n) => n >= 19 && n <= 36 },
  dozen1: { label: '1st 12',   short: '1st 12', payout: 2, matches: (n) => n >= 1 && n <= 12 },
  dozen2: { label: '2nd 12',   short: '2nd 12', payout: 2, matches: (n) => n >= 13 && n <= 24 },
  dozen3: { label: '3rd 12',   short: '3rd 12', payout: 2, matches: (n) => n >= 25 && n <= 36 },
  // Kolonnen ("2 to 1"): col1 = 1,4,7…34 | col2 = 2,5,8…35 | col3 = 3,6,9…36
  col1:   { label: 'Kolonne 1 (2 to 1)', short: '2:1 ▸ 1,4,7…', payout: 2, matches: (n) => n !== 0 && n % 3 === 1 },
  col2:   { label: 'Kolonne 2 (2 to 1)', short: '2:1 ▸ 2,5,8…', payout: 2, matches: (n) => n !== 0 && n % 3 === 2 },
  col3:   { label: 'Kolonne 3 (2 to 1)', short: '2:1 ▸ 3,6,9…', payout: 2, matches: (n) => n !== 0 && n % 3 === 0 }
};

/**
 * Liefert die Definition zu einer Wett-ID.
 * IDs sind entweder `straight:<n>` (Einzelzahl) oder ein Schlüssel aus OUTSIDE_BETS.
 */
export function betInfo(id) {
  if (id.startsWith('straight:')) {
    const n = Number(id.slice(9));
    return {
      label: n === 0 ? 'Zahl 0' : `Zahl ${n}`,
      short: String(n),
      payout: 35,
      matches: (win) => win === n,
      number: n
    };
  }
  const def = OUTSIDE_BETS[id];
  if (!def) throw new Error(`Unbekannte Wette: ${id}`);
  return def;
}

export const OUTSIDE_BET_IDS = Object.keys(OUTSIDE_BETS);

/* ------------------------------------------------------------------ */
/* Auswertung                                                          */
/* ------------------------------------------------------------------ */

/**
 * Wertet eine einzelne Wette gegen die Gewinnzahl aus.
 * @param {{id:string, amount:number}} bet
 * @param {number} winning
 * @returns {{id:string, label:string, amount:number, won:boolean, payout:number, net:number}}
 *   payout = Rückzahlung ans Guthaben (Einsatz + Gewinn), net = Gewinn/Verlust
 */
export function resolveBet(bet, winning) {
  const info = betInfo(bet.id);
  const won = info.matches(winning);
  return {
    id: bet.id,
    label: info.label,
    amount: bet.amount,
    won,
    payout: won ? bet.amount * (info.payout + 1) : 0,
    net: won ? bet.amount * info.payout : -bet.amount
  };
}

/**
 * Wertet eine komplette Runde aus.
 * @param {Array<{id:string, amount:number}>} bets
 * @param {number} winning
 */
export function resolveRound(bets, winning) {
  const results = bets.map((b) => resolveBet(b, winning));
  const staked = results.reduce((s, r) => s + r.amount, 0);
  const returned = results.reduce((s, r) => s + r.payout, 0);
  return {
    winning,
    color: colorOf(winning),
    results,
    staked,          // war bereits beim Setzen vom Guthaben abgezogen
    returned,        // wird dem Guthaben wieder gutgeschrieben
    net: returned - staked
  };
}

/* ------------------------------------------------------------------ */
/* Formatierung                                                        */
/* ------------------------------------------------------------------ */

const nf = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** 2000 -> "2.000 €" */
export function money(value) {
  return `${nf.format(value)} €`;
}

/** +40 -> "+40 €", -10 -> "-10 €" */
export function signedMoney(value) {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±';
  return `${sign}${nf.format(Math.abs(value))} €`;
}
