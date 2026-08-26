/**
 * BLACKJACK – Regelwerk und Kartenschuh.
 *
 * Diese Datei enthält ausschließlich Logik (kein DOM), damit sich sämtliche
 * Regeln isoliert testen lassen. Die Oberfläche liegt in js/blackjack.js.
 *
 * Gespielte Variante (American Blackjack, im ganzen Spiel einheitlich):
 *   · 6 Decks in einem Schuh, Neumischen an der Cut Card (etwa Hälfte)
 *   · Dealer zieht bis 16 und bleibt ab 17 stehen – auch bei Soft 17 (S17)
 *   · Dealer erhält eine verdeckte Karte und prüft bei Ass oder Zehnerkarte
 *     sofort auf Blackjack ("Peek")
 *   · Blackjack zahlt 2,5× · normaler Gewinn 2,0× · Push: Einsatz zurück
 *   · Double auf die ersten beiden Karten, danach genau eine Karte
 *   · Split bei gleichem Kartenwert, geteilte Asse bekommen genau eine Karte
 *   · höchstens 3 Hände gleichzeitig (Startplätze und Splits zusammen)
 */

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const DECK_COUNT = 6;
export const MAX_HANDS = 3;

/** Auszahlungen als Vielfaches des Einsatzes (Einsatz ist enthalten). */
export const PAYOUT = { blackjack: 2.5, win: 2, push: 1, lose: 0 };

/** Zahlenwert einer Karte; das Ass zählt hier zunächst 11. */
export function cardValue(card) {
  if (card.r === 'A') return 11;
  if (card.r === 'J' || card.r === 'Q' || card.r === 'K') return 10;
  return Number(card.r);
}

export const isRed = (card) => card.s === '♥' || card.s === '♦';

/**
 * Bester gültiger Wert einer Hand. Asse werden von 11 auf 1 heruntergestuft,
 * solange die Hand sonst über 21 läge.
 * @returns {{total:number, soft:boolean, bust:boolean}}
 */
export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.r === 'A') aces++;
    total += cardValue(card);
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0, bust: total > 21 };
}

/** Blackjack: genau zwei Karten mit zusammen 21. Nach einem Split gilt das nicht. */
export function isBlackjack(cards, fromSplit = false) {
  return !fromSplit && cards.length === 2 && handValue(cards).total === 21;
}

/** Zwei gleiche Kartenwerte dürfen geteilt werden (also auch Bube + Dame). */
export const canSplitPair = (cards) =>
  cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1]);

/* ------------------------------------------------------------------ */
/* Kartenschuh                                                         */
/* ------------------------------------------------------------------ */

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

/** Ein vollständiger Schuh aus `decks` Decks – noch ungemischt. */
export function buildShoe(decks = DECK_COUNT) {
  const cards = [];
  for (let d = 0; d < decks; d++) {
    for (const s of SUITS) {
      for (const r of RANKS) cards.push({ r, s });
    }
  }
  return cards;
}

/** Fisher-Yates: jede Reihenfolge ist gleich wahrscheinlich. */
export function shuffle(cards) {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Kartenschuh mit Cut Card. Die Karten stehen beim Mischen fest; gezogen wird
 * anschließend nur noch der Reihe nach. Die Animation kann das Ergebnis
 * dadurch nicht beeinflussen.
 */
export function createShoe(decks = DECK_COUNT) {
  let cards = [];
  let pos = 0;
  let cutIndex = 0;

  function reshuffle() {
    cards = shuffle(buildShoe(decks));
    pos = 0;
    // Cut Card bei etwa der Hälfte, mit etwas Streuung – nicht vorhersehbar
    const half = Math.floor(cards.length / 2);
    cutIndex = half + randomInt(Math.floor(cards.length * 0.12)) - Math.floor(cards.length * 0.06);
  }

  reshuffle();

  return {
    /** Zieht die nächste Karte. Mischt notfalls nach (nur als Notbremse). */
    draw() {
      if (pos >= cards.length) reshuffle();
      return cards[pos++];
    },
    /** Ist die Cut Card erreicht? Wird nur ZWISCHEN Runden abgefragt. */
    needsShuffle: () => pos >= cutIndex,
    reshuffle,
    get remaining() { return cards.length - pos; },
    get size() { return cards.length; },
    get used() { return pos; },
    /** Anteil des noch nicht gespielten Schuhs, 0…1 – für die Anzeige. */
    get fill() { return Math.max(0, Math.min(1, (cards.length - pos) / cards.length)); }
  };
}

/* ------------------------------------------------------------------ */
/* Auswertung                                                          */
/* ------------------------------------------------------------------ */

/**
 * Wertet eine Spielerhand gegen die Dealerhand aus.
 * @param {{cards:Array, bet:number, fromSplit?:boolean}} hand
 * @param {Array} dealerCards
 * @returns {{outcome:'blackjack'|'win'|'push'|'lose', payout:number, net:number}}
 */
export function settleHand(hand, dealerCards) {
  const player = handValue(hand.cards);
  const dealer = handValue(dealerCards);
  const playerBJ = isBlackjack(hand.cards, hand.fromSplit);
  const dealerBJ = isBlackjack(dealerCards);

  let outcome;
  if (player.bust) outcome = 'lose';
  else if (playerBJ && dealerBJ) outcome = 'push';
  else if (playerBJ) outcome = 'blackjack';
  else if (dealerBJ) outcome = 'lose';
  else if (dealer.bust) outcome = 'win';
  else if (player.total > dealer.total) outcome = 'win';
  else if (player.total < dealer.total) outcome = 'lose';
  else outcome = 'push';

  const payout = Math.round(hand.bet * PAYOUT[outcome]);
  return { outcome, payout, net: payout - hand.bet };
}

/**
 * Zieht für den Dealer nach den Hausregeln (zieht bis 16, steht ab 17 – auch
 * bei Soft 17). Gibt die neuen Karten in der Reihenfolge zurück, in der sie
 * gezogen wurden, damit die Animation sie nacheinander aufdecken kann.
 */
export function playDealer(dealerCards, drawCard) {
  const drawn = [];
  const cards = [...dealerCards];
  while (handValue(cards).total < 17) {
    const card = drawCard();
    cards.push(card);
    drawn.push(card);
  }
  return drawn;
}

/** Darf der Dealer wegen Ass oder Zehnerkarte auf Blackjack prüfen? */
export const dealerShouldPeek = (upCard) => upCard && (upCard.r === 'A' || cardValue(upCard) === 10);
