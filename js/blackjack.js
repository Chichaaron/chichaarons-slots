/**
 * BLACKJACK – drittes Minigame der Plattform.
 *
 * Ablauf: Einsätze auf bis zu fünf Plätze legen → GEBEN → je Hand ziehen,
 * halten, verdoppeln oder teilen → Dealer spielt → Auszahlung.
 *
 * Wie schon bei Mines liegen Logik und Oberfläche zusammen, der Zugriff auf
 * Guthaben, Speichern und Statistik läuft aber ausschließlich über die von
 * app.js übergebene Schnittstelle. Roulette und Mines bleiben unberührt.
 *
 * Das reine Regelwerk (Handwerte, Schuh, Auswertung, Dealerzug) steht in
 * js/blackjack-rules.js und ist dadurch getrennt testbar.
 */
import {
  MAX_HANDS, DECK_COUNT, createShoe, handValue, isBlackjack, canSplitPair,
  settleHand, playDealer, dealerShouldPeek, cardValue
} from './blackjack-rules.js';
import { createCardElement, cardLabel } from './cards.js';
import { CHIPS, MAX_CHIP, MAX_BET, maxBetFor } from './bets.js';
import { money, signedMoney } from './roulette.js';

/** Wie viele Startplätze der Tisch anbietet. */
export const SPOTS = MAX_HANDS;

/** Startwerte der spielinternen Statistik. */
const STAT_DEFAULTS = {
  hands: 0, wins: 0, pushes: 0, losses: 0,
  blackjacks: 0, busts: 0, doubles: 0, splits: 0
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const OUTCOME_LABEL = {
  blackjack: 'BLACKJACK', win: 'GEWONNEN', push: 'UNENTSCHIEDEN', lose: 'VERLOREN'
};

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
 *   pace()                   Grundtempo der Animationen in Millisekunden
 *   sound                    Klangobjekt
 */
export function createBlackjack(api) {
  const $ = (sel) => document.querySelector(sel);

  const shoe = createShoe(DECK_COUNT);
  let handSeq = 0;

  const state = {
    phase: 'betting',       // betting | dealing | playing | dealer | payout
    spots: Array(SPOTS).fill(0),
    chip: null,
    hands: [],
    dealer: [],
    dealerEls: [],
    holeHidden: true,
    active: 0,
    lastSpots: null,
    staked: 0,
    net: 0
  };

  /* ================================================================ */
  /* Kleine Helfer                                                     */
  /* ================================================================ */

  const stakedTotal = () => state.spots.reduce((a, b) => a + b, 0);
  const activeHand = () => state.hands[state.active] || null;

  /** Steht gerade Geld auf dem Tisch? */
  const isLive = () => state.phase === 'dealing' || state.phase === 'playing' || state.phase === 'dealer';

  const step = () => Math.max(60, api.pace ? api.pace() : 220);

  function newHand(spot, bet, cards = [], fromSplit = false) {
    return {
      id: `h${++handSeq}`,
      spot, bet, cards,
      els: [],
      done: false,
      doubled: false,
      fromSplit,
      splitAces: false,
      result: null
    };
  }

  /* ================================================================ */
  /* Einsatzleiste                                                     */
  /* ================================================================ */

  const betAmountOf = (chip) => (chip === MAX_CHIP ? maxBetFor(api.available() - stakedTotal()) : chip);

  function buildChipRow() {
    const host = $('#bj-chips');
    if (!host) return;
    host.innerHTML = '';
    for (const value of CHIPS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `chip chip-c${value}`;
      btn.dataset.value = String(value);
      btn.textContent = value >= 1000 ? `${value / 1000}k €` : `${value} €`;
      btn.setAttribute('aria-label', `Jeton ${value} Euro`);
      btn.onclick = () => selectChip(value);
      host.appendChild(btn);
    }
    const max = document.createElement('button');
    max.type = 'button';
    max.className = 'chip chip-max';
    max.dataset.value = MAX_CHIP;
    max.setAttribute('aria-label', 'Höchsten möglichen Einsatz wählen');
    max.innerHTML = '<b>MAX</b><small>—</small>';
    max.onclick = () => selectChip(MAX_CHIP);
    host.appendChild(max);
  }

  function selectChip(chip) {
    if (state.phase !== 'betting') return;
    state.chip = chip;
    api.sound.chip();
    render();
  }

  function applyCustomBet() {
    if (state.phase !== 'betting') return;
    const input = $('#bj-custom');
    const value = Math.floor(Number(input.value));
    if (!Number.isFinite(value) || value <= 0) {
      api.toast('Bitte einen Betrag größer als 0 eingeben.', 'warn');
      return;
    }
    if (value > MAX_BET) { api.toast(`Maximal ${money(MAX_BET)} pro Hand.`, 'warn'); return; }
    state.chip = value;
    input.value = '';
    api.sound.chip();
    render();
  }

  /** Legt den gewählten Jeton auf einen Platz. */
  function placeOn(index) {
    if (state.phase !== 'betting') return;
    if (state.chip === null) { api.toast('Wähle zuerst einen Jeton.', 'warn'); return; }
    const amount = betAmountOf(state.chip);
    if (amount <= 0) { api.toast('Dein Guthaben ist aufgebraucht.', 'warn'); return; }
    if (stakedTotal() + amount > api.available()) {
      api.toast('Dafür reicht dein Guthaben nicht.', 'warn');
      return;
    }
    if (state.spots[index] + amount > MAX_BET) {
      api.toast(`Maximal ${money(MAX_BET)} pro Hand.`, 'warn');
      return;
    }
    state.spots[index] += amount;
    api.sound.chip();
    render();
  }

  function clearSpot(index) {
    if (state.phase !== 'betting' || !state.spots[index]) return;
    state.spots[index] = 0;
    api.sound.remove();
    render();
  }

  function clearAllSpots() {
    if (state.phase !== 'betting' || stakedTotal() === 0) return;
    state.spots = Array(SPOTS).fill(0);
    api.sound.remove();
    render();
  }

  /** Übernimmt die Einsätze der letzten Runde, sofern bezahlbar. */
  function repeatBets() {
    if (state.phase !== 'betting' || !state.lastSpots) return;
    const total = state.lastSpots.reduce((a, b) => a + b, 0);
    if (total > api.available()) {
      api.toast('Dafür reicht dein Guthaben nicht mehr.', 'warn');
      return;
    }
    state.spots = [...state.lastSpots];
    api.sound.chip();
    render();
  }

  /* ================================================================ */
  /* Tisch aufbauen                                                    */
  /* ================================================================ */

  /** Zeigt in der Setzphase die fünf leeren Plätze. */
  function buildSpots() {
    const host = $('#bj-seats');
    if (!host) return;
    host.innerHTML = '';
    host.classList.add('is-betting');
    host.style.setProperty('--seats', String(SPOTS));   // fünf Plätze, mittig

    for (let i = 0; i < SPOTS; i++) {
      const spot = document.createElement('div');
      spot.className = 'bj-spot';
      spot.dataset.spot = String(i);
      spot.innerHTML = `
        <button class="bj-spot-btn" type="button" aria-label="Einsatz auf Platz ${i + 1} legen">
          <span class="bj-spot-ring"><span class="bj-spot-amount">—</span></span>
        </button>
        <button class="bj-spot-clear" type="button" hidden aria-label="Platz ${i + 1} leeren">✕</button>
        <span class="bj-spot-label">Platz ${i + 1}</span>`;
      spot.querySelector('.bj-spot-btn').onclick = () => placeOn(i);
      spot.querySelector('.bj-spot-clear').onclick = () => clearSpot(i);
      host.appendChild(spot);
    }
  }

  /** Baut je Hand einen Sitzplatz. Karten kommen später einzeln hinzu. */
  function seatMarkup(hand, position) {
    return `
      <div class="bj-hand-cards" id="cards-${hand.id}"></div>
      <div class="bj-seat-foot">
        <span class="bj-badge bj-hand-total" id="total-${hand.id}">—</span>
        <span class="bj-seat-bet" id="bet-${hand.id}">${money(hand.bet)}</span>
      </div>
      <span class="bj-seat-tag">Hand ${position}</span>
      <span class="bj-seat-result" id="res-${hand.id}" hidden></span>`;
  }

  function buildSeats() {
    const host = $('#bj-seats');
    if (!host) return;
    host.innerHTML = '';
    host.classList.remove('is-betting');
    host.style.setProperty('--seats', String(Math.max(state.hands.length, 1)));
    state.hands.forEach((hand, i) => host.appendChild(makeSeat(hand, i + 1)));
  }

  function makeSeat(hand, position) {
    const seat = document.createElement('div');
    seat.className = 'bj-seat';
    seat.dataset.hand = hand.id;
    seat.innerHTML = seatMarkup(hand, position);
    return seat;
  }

  /** Nummeriert die Sitzplätze neu – nach einem Split verschiebt sich alles. */
  function renumberSeats() {
    state.hands.forEach((hand, i) => {
      const tag = document.querySelector(`.bj-seat[data-hand="${hand.id}"] .bj-seat-tag`);
      if (tag) tag.textContent = `Hand ${i + 1}`;
    });
    const host = $('#bj-seats');
    if (host) host.style.setProperty('--seats', String(Math.max(state.hands.length, 1)));
  }

  /* ================================================================ */
  /* Karten legen und animieren                                        */
  /* ================================================================ */

  /** Lässt eine Karte optisch aus dem Schuh auf ihren Platz gleiten. */
  function animateFromShoe(el) {
    const shoeEl = $('#bj-shoe');
    if (!shoeEl || typeof el.getBoundingClientRect !== 'function') return;
    const from = shoeEl.getBoundingClientRect();
    const to = el.getBoundingClientRect();
    if (!to.width && !to.height) return;
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    const dy = (from.top + from.height / 2) - (to.top + to.height / 2);
    el.style.setProperty('--dx', `${Math.round(dx)}px`);
    el.style.setProperty('--dy', `${Math.round(dy)}px`);
    el.classList.add('is-dealing');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('is-dealing')));
  }

  /**
   * Legt eine gezogene Karte an eine Spielerhand.
   * @param {object} hand
   * @param {{r:string,s:string}} card
   * @param {boolean} sideways  quergelegte Karte beim Verdoppeln
   */
  function addCardToHand(hand, card, sideways = false) {
    hand.cards.push(card);
    const el = createCardElement(card, false);
    if (sideways) el.classList.add('is-sideways');
    hand.els.push(el);
    const host = document.getElementById(`cards-${hand.id}`);
    if (host) {
      host.appendChild(el);
      animateFromShoe(el);
    }
    api.sound.card();
    paintHandTotal(hand);
  }

  function addCardToDealer(card, faceDown = false) {
    state.dealer.push(card);
    const el = createCardElement(card, faceDown);
    state.dealerEls.push(el);
    const host = $('#bj-dealer-cards');
    if (host) {
      host.appendChild(el);
      animateFromShoe(el);
    }
    api.sound.card();
    paintDealerTotal();
  }

  function drawCard() {
    const card = shoe.draw();
    paintShoe();
    return card;
  }

  function paintHandTotal(hand) {
    const el = document.getElementById(`total-${hand.id}`);
    if (!el) return;
    const v = handValue(hand.cards);
    const bj = isBlackjack(hand.cards, hand.fromSplit);
    el.textContent = bj ? 'BJ' : String(v.total);
    el.className = `bj-badge bj-hand-total${v.bust ? ' is-bust' : ''}${bj ? ' is-bj' : ''}${
      v.soft && !v.bust && !bj ? ' is-soft' : ''}`;
    el.title = v.soft && !bj ? `Weiche ${v.total} – das Ass kann auch 1 zählen` : '';
    const betEl = document.getElementById(`bet-${hand.id}`);
    if (betEl) betEl.textContent = money(hand.bet);
  }

  function paintDealerTotal() {
    const el = $('#bj-dealer-total');
    if (!el) return;
    // Vor dem Geben gibt es nichts zu zeigen
    el.hidden = state.dealer.length === 0;
    if (state.holeHidden) {
      const shown = state.dealer.slice(0, 1);
      el.textContent = shown.length ? String(handValue(shown).total) : '—';
      el.className = 'bj-badge bj-dealer-total is-partial';
      return;
    }
    const v = handValue(state.dealer);
    const bj = isBlackjack(state.dealer);
    el.textContent = bj ? 'BJ' : String(v.total);
    el.className = `bj-badge bj-dealer-total${v.bust ? ' is-bust' : ''}${bj ? ' is-bj' : ''}`;
  }

  function paintShoe() {
    const fill = $('#bj-shoe-fill');
    const label = $('#bj-shoe-label');
    if (fill) fill.style.height = `${Math.round(shoe.fill * 100)}%`;
    if (label) label.textContent = `${shoe.remaining} / ${shoe.size}`;
  }

  /** Deckt die verdeckte Dealerkarte auf. */
  async function revealHole() {
    if (!state.holeHidden) return;
    state.holeHidden = false;
    const el = state.dealerEls[1];
    if (el) {
      el.classList.remove('is-down');
      el.setAttribute('aria-label', cardLabel(state.dealer[1]));
      api.sound.flip();
    }
    paintDealerTotal();
    await wait(step() * 1.6);
  }

  /* ================================================================ */
  /* Runde geben                                                       */
  /* ================================================================ */

  const canDeal = () =>
    state.phase === 'betting' && stakedTotal() > 0 && stakedTotal() <= api.available();

  async function shuffleShoe(announce = true) {
    shoe.reshuffle();
    paintShoe();
    const shoeEl = $('#bj-shoe');
    if (shoeEl) shoeEl.classList.add('is-shuffling');
    api.sound.shuffle();
    if (announce) api.toast('Neuer Schuh – die Karten werden gemischt.');
    await wait(1100);
    if (shoeEl) shoeEl.classList.remove('is-shuffling');
  }

  async function deal() {
    if (!canDeal()) return;

    const total = stakedTotal();
    api.spend(total);
    state.staked = total;
    state.net = 0;
    state.lastSpots = [...state.spots];
    state.phase = 'dealing';
    state.dealer = [];
    state.dealerEls = [];
    state.holeHidden = true;
    state.active = 0;
    hideResult();
    api.paintBalance();
    // Einsatz ist gebucht UND gespeichert: Neuladen macht die Runde nicht rückgängig.
    await api.persist();

    state.hands = state.spots
      .map((bet, spot) => (bet > 0 ? newHand(spot, bet) : null))
      .filter(Boolean);

    buildSeats();
    $('#bj-dealer-cards').innerHTML = '';
    paintDealerTotal();
    render();
    // Auf schmalen Geräten steht der Tisch über den Knöpfen – nach dem
    // Tippen auf GEBEN soll er wieder im Blick sein.
    if (window.matchMedia?.('(max-width: 900px)').matches) {
      $('#bj-seats')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    if (shoe.needsShuffle()) await shuffleShoe();

    // Erste Runde: jede Hand eine Karte, dann die offene Dealerkarte
    for (const hand of state.hands) {
      addCardToHand(hand, drawCard());
      await wait(step());
    }
    addCardToDealer(drawCard(), false);
    await wait(step());

    // Zweite Runde: jede Hand eine Karte, dann die verdeckte Dealerkarte
    for (const hand of state.hands) {
      addCardToHand(hand, drawCard());
      await wait(step());
    }
    addCardToDealer(drawCard(), true);
    await wait(step() * 1.4);

    // Dealer prüft bei Ass oder Zehnerkarte sofort auf Blackjack
    if (dealerShouldPeek(state.dealer[0]) && isBlackjack(state.dealer)) {
      api.toast('Der Dealer hat Blackjack.', 'warn');
      await revealHole();
      await settle();
      return;
    }

    for (const hand of state.hands) {
      if (isBlackjack(hand.cards, hand.fromSplit)) {
        hand.done = true;
        markSeat(hand, 'bj');
        api.sound.blackjack();
      }
    }

    state.phase = 'playing';
    state.active = -1;
    advance();
  }

  /* ================================================================ */
  /* Spielzüge                                                         */
  /* ================================================================ */

  function markSeat(hand, kind) {
    const seat = document.querySelector(`.bj-seat[data-hand="${hand.id}"]`);
    if (seat) seat.classList.add(`is-${kind}`);
  }

  function highlightActive() {
    for (const seat of document.querySelectorAll('.bj-seat')) seat.classList.remove('is-active');
    const hand = activeHand();
    if (hand && state.phase === 'playing') {
      const seat = document.querySelector(`.bj-seat[data-hand="${hand.id}"]`);
      if (seat) seat.classList.add('is-active');
    }
  }

  /** Springt zur nächsten offenen Hand oder übergibt an den Dealer. */
  function advance() {
    const next = state.hands.findIndex((h, i) => i > state.active && !h.done);
    if (next === -1) {
      state.active = state.hands.length;
      highlightActive();
      dealerTurn();
      return;
    }
    state.active = next;
    highlightActive();
    render();
  }

  const canHit = () => {
    const h = activeHand();
    return state.phase === 'playing' && h && !h.done && handValue(h.cards).total < 21;
  };

  const canDouble = () => {
    const h = activeHand();
    return state.phase === 'playing' && h && !h.done && h.cards.length === 2 &&
      !h.splitAces && h.bet <= api.available();
  };

  const canSplit = () => {
    const h = activeHand();
    return state.phase === 'playing' && h && !h.done && canSplitPair(h.cards) &&
      state.hands.length < MAX_HANDS && h.bet <= api.available();
  };

  async function hit() {
    if (!canHit()) return;
    const hand = activeHand();
    addCardToHand(hand, drawCard());
    const v = handValue(hand.cards);
    render();
    if (v.bust) {
      hand.done = true;
      markSeat(hand, 'bust');
      api.sound.bust();
      await wait(step() * 2);
      advance();
    } else if (v.total === 21) {
      hand.done = true;
      await wait(step() * 1.6);
      advance();
    }
  }

  function stand() {
    if (state.phase !== 'playing') return;
    const hand = activeHand();
    if (!hand || hand.done) return;
    hand.done = true;
    api.sound.stand();
    advance();
  }

  async function double() {
    if (!canDouble()) return;
    const hand = activeHand();
    api.spend(hand.bet);
    state.staked += hand.bet;      // zählt zum Gesamteinsatz der Runde
    hand.bet *= 2;
    hand.doubled = true;
    api.paintBalance();
    markSeat(hand, 'doubled');
    addCardToHand(hand, drawCard(), true);
    hand.done = true;
    render();
    const v = handValue(hand.cards);
    if (v.bust) { markSeat(hand, 'bust'); api.sound.bust(); }
    await wait(step() * 2);
    advance();
  }

  async function split() {
    if (!canSplit()) return;
    const hand = activeHand();
    api.spend(hand.bet);
    state.staked += hand.bet;      // die zweite Hand kostet denselben Einsatz
    api.paintBalance();

    const moved = hand.cards.pop();
    const movedEl = hand.els.pop();
    const extra = newHand(hand.spot, hand.bet, [moved], true);
    extra.els = [movedEl];
    hand.fromSplit = true;
    const aces = moved.r === 'A';

    // Neue Hand direkt hinter der geteilten einsortieren
    state.hands.splice(state.active + 1, 0, extra);
    const seat = makeSeat(extra, state.active + 2);
    const currentSeat = document.querySelector(`.bj-seat[data-hand="${hand.id}"]`);
    if (currentSeat) currentSeat.after(seat);
    else $('#bj-seats').appendChild(seat);
    // die verschobene Karte wandert mit in den neuen Sitzplatz
    const target = document.getElementById(`cards-${extra.id}`);
    if (target && movedEl) target.appendChild(movedEl);
    renumberSeats();
    paintHandTotal(hand);
    paintHandTotal(extra);
    api.sound.chip();

    const stats = api.gameStats('blackjack', STAT_DEFAULTS);
    stats.splits += 1;

    await wait(step());
    addCardToHand(hand, drawCard());
    await wait(step());
    addCardToHand(extra, drawCard());

    if (aces) {
      // Geteilte Asse bekommen genau eine Karte und stehen dann
      hand.splitAces = true;
      extra.splitAces = true;
      hand.done = true;
      extra.done = true;
      await wait(step() * 1.6);
      advance();
      return;
    }

    // Eine geteilte Hand mit 21 ist fertig – weiterziehen wäre sinnlos
    if (handValue(extra.cards).total === 21) extra.done = true;
    if (handValue(hand.cards).total === 21) {
      hand.done = true;
      await wait(step() * 1.4);
      advance();
      return;
    }
    render();
  }

  /* ================================================================ */
  /* Dealer und Auszahlung                                             */
  /* ================================================================ */

  async function dealerTurn() {
    state.phase = 'dealer';
    render();
    await wait(step());
    await revealHole();

    const alive = state.hands.some((h) => !handValue(h.cards).bust);
    if (alive) {
      const drawn = playDealer(state.dealer, drawCard);
      for (const card of drawn) {
        addCardToDealer(card, false);
        await wait(step() * 1.5);
      }
      if (handValue(state.dealer).bust) {
        const el = $('#bj-dealer-total');
        if (el) el.classList.add('is-bust');
        api.sound.bust();
        await wait(step());
      }
    }
    await settle();
  }

  async function settle() {
    state.phase = 'payout';
    const stats = api.gameStats('blackjack', STAT_DEFAULTS);

    let payout = 0;
    const details = [];
    for (const hand of state.hands) {
      const res = settleHand(hand, state.dealer);
      hand.result = res;
      payout += res.payout;

      stats.hands += 1;
      if (res.outcome === 'blackjack') { stats.blackjacks += 1; stats.wins += 1; }
      else if (res.outcome === 'win') stats.wins += 1;
      else if (res.outcome === 'push') stats.pushes += 1;
      else stats.losses += 1;
      if (handValue(hand.cards).bust) stats.busts += 1;
      if (hand.doubled) stats.doubles += 1;

      details.push({
        bet: hand.bet, outcome: res.outcome, net: res.net,
        total: handValue(hand.cards).total, doubled: hand.doubled, split: hand.fromSplit
      });
      showSeatResult(hand, res);
    }

    if (payout > 0) api.credit(payout);
    api.paintBalance();

    const net = payout - state.staked;
    state.net = net;

    api.recordRound({
      game: 'blackjack',
      hands: details,
      dealer: handValue(state.dealer).total,
      staked: state.staked,
      net
    });

    if (net > 0) api.sound.win();
    else if (net < 0) api.sound.lose();
    else api.sound.remove();

    showResult(net, payout);
    highlightActive();
    render();
    renderStats();
    await api.persist();
  }

  function showSeatResult(hand, res) {
    const el = document.getElementById(`res-${hand.id}`);
    if (!el) return;
    el.hidden = false;
    el.className = `bj-seat-result is-${res.outcome}`;
    el.innerHTML = `<b>${OUTCOME_LABEL[res.outcome]}</b><span>${signedMoney(res.net)}</span>`;
    const seat = document.querySelector(`.bj-seat[data-hand="${hand.id}"]`);
    if (seat) seat.classList.add(`res-${res.outcome}`);
  }

  function showResult(net, payout) {
    const box = $('#bj-result');
    if (!box) return;
    const tone = net > 0 ? 'is-win' : net < 0 ? 'is-loss' : 'is-even';
    box.className = `bj-result ${tone}`;
    box.hidden = false;
    const title = net > 0 ? 'Gewonnen!' : net < 0 ? 'Verloren' : 'Einsatz zurück';
    box.innerHTML = `<strong>${title}</strong>
      <span>${state.hands.length} ${state.hands.length === 1 ? 'Hand' : 'Hände'}
        · Einsatz ${money(state.staked)} · Auszahlung ${money(payout)}</span>
      <span class="bj-result-net">${signedMoney(net)}</span>`;
  }

  function hideResult() {
    const box = $('#bj-result');
    if (box) box.hidden = true;
  }

  /** Setzt den Tisch für die nächste Runde zurück. */
  function newRound() {
    state.phase = 'betting';
    state.hands = [];
    state.dealer = [];
    state.dealerEls = [];
    state.holeHidden = true;
    state.active = 0;
    hideResult();
    const dealerCards = $('#bj-dealer-cards');
    if (dealerCards) dealerCards.innerHTML = '';
    paintDealerTotal();
    // Einsätze nachziehen, falls das Guthaben inzwischen kleiner ist
    if (stakedTotal() > api.available()) state.spots = Array(SPOTS).fill(0);
    buildSpots();
    render();
  }

  /* ================================================================ */
  /* Anzeige                                                           */
  /* ================================================================ */

  function renderStats() {
    const host = $('#bj-stats');
    if (!host) return;
    const s = api.gameStats ? api.gameStats('blackjack', STAT_DEFAULTS) : { ...STAT_DEFAULTS };
    const rate = s.hands ? Math.round((s.wins / s.hands) * 100) : 0;
    const rows = [
      ['Hände', s.hands],
      ['Gewonnen', s.wins],
      ['Unentschieden', s.pushes],
      ['Verloren', s.losses],
      ['Blackjacks', s.blackjacks],
      ['Überkauft', s.busts],
      ['Verdoppelt', s.doubles],
      ['Geteilt', s.splits],
      ['Trefferquote', `${rate} %`]
    ];
    host.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  }

  function render() {
    if (!$('#bj-seats')) return;
    const betting = state.phase === 'betting';

    // Jetons
    for (const chip of document.querySelectorAll('#bj-chips .chip')) {
      const isMax = chip.dataset.value === MAX_CHIP;
      const rest = api.available() - stakedTotal();
      const value = isMax ? maxBetFor(rest) : Number(chip.dataset.value);
      chip.disabled = !betting || value <= 0 || value > rest;
      chip.classList.toggle('is-active', betting && state.chip !== null &&
        (isMax ? state.chip === MAX_CHIP : value === state.chip));
      if (isMax) {
        const label = chip.querySelector('small');
        if (label) label.textContent = money(Math.max(0, value));
      }
    }
    const custom = $('#bj-custom');
    if (custom) custom.disabled = !betting;
    const customBtn = $('#bj-custom-btn');
    if (customBtn) customBtn.disabled = !betting;

    // Plätze in der Setzphase
    if (betting) {
      for (const spot of document.querySelectorAll('.bj-spot')) {
        const i = Number(spot.dataset.spot);
        const value = state.spots[i];
        spot.classList.toggle('is-set', value > 0);
        const amount = spot.querySelector('.bj-spot-amount');
        if (amount) amount.textContent = value > 0 ? money(value) : '—';
        const clear = spot.querySelector('.bj-spot-clear');
        if (clear) clear.hidden = value <= 0;
      }
    }

    const total = stakedTotal();
    const totalEl = $('#bj-total');
    if (totalEl) totalEl.textContent = total > 0 ? money(total) : '—';

    const clearBtn = $('#bj-clear');
    if (clearBtn) clearBtn.disabled = !betting || total === 0;
    const repeatBtn = $('#bj-repeat');
    if (repeatBtn) {
      repeatBtn.disabled = !betting || !state.lastSpots ||
        state.lastSpots.reduce((a, b) => a + b, 0) > api.available();
    }

    // Geben
    const dealBtn = $('#bj-deal');
    if (dealBtn) {
      dealBtn.disabled = !canDeal();
      dealBtn.textContent = betting ? 'GEBEN' : 'Runde läuft …';
    }
    const hint = $('#bj-hint');
    if (hint) {
      hint.textContent = !betting
        ? (state.phase === 'playing'
            ? `Hand ${state.active + 1} von ${state.hands.length} ist dran.`
            : state.phase === 'payout' ? 'Runde beendet.' : 'Die Karten laufen …')
        : total === 0
          ? 'Jeton wählen und auf einen Platz legen.'
          : total > api.available()
            ? 'Einsatz höher als dein Guthaben.'
            : `${state.spots.filter((b) => b > 0).length === 1
                ? '1 Hand' : `${state.spots.filter((b) => b > 0).length} Hände`} · viel Glück!`;
    }

    // Spielzüge
    const hitBtn = $('#bj-hit');
    const standBtn = $('#bj-stand');
    const doubleBtn = $('#bj-double');
    const splitBtn = $('#bj-split');
    if (hitBtn) hitBtn.disabled = !canHit();
    if (standBtn) standBtn.disabled = state.phase !== 'playing' || !activeHand() || activeHand().done;
    if (doubleBtn) doubleBtn.disabled = !canDouble();
    if (splitBtn) {
      splitBtn.disabled = !canSplit();
      const h = activeHand();
      splitBtn.title = h && canSplitPair(h.cards) && state.hands.length >= MAX_HANDS
        ? `Höchstens ${MAX_HANDS} Hände gleichzeitig.` : '';
    }
    const actions = $('#bj-actions');
    if (actions) actions.classList.toggle('is-idle', state.phase !== 'playing');

    const newBtn = $('#bj-new');
    if (newBtn) newBtn.hidden = state.phase !== 'payout';

    const panel = $('#bj-panel');
    if (panel) panel.classList.toggle('is-locked', !betting);

    paintShoe();
  }

  /* ================================================================ */
  /* Aufbau                                                            */
  /* ================================================================ */

  function init() {
    buildChipRow();
    buildSpots();
    paintShoe();
    paintDealerTotal();
    $('#bj-deal').addEventListener('click', deal);
    $('#bj-clear').addEventListener('click', clearAllSpots);
    $('#bj-repeat').addEventListener('click', repeatBets);
    $('#bj-custom-btn').addEventListener('click', applyCustomBet);
    $('#bj-custom').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCustomBet(); });
    $('#bj-hit').addEventListener('click', hit);
    $('#bj-stand').addEventListener('click', stand);
    $('#bj-double').addEventListener('click', double);
    $('#bj-split').addEventListener('click', split);
    $('#bj-new').addEventListener('click', newRound);
    render();
    renderStats();
  }

  return {
    init,
    render() { render(); renderStats(); },
    isLive,

    /** Bricht eine laufende Runde ab – die Einsätze sind dann verloren. */
    async abandon() {
      if (!isLive()) { newRound(); return; }
      const staked = state.staked || stakedTotal();
      api.recordRound({
        game: 'blackjack',
        hands: state.hands.map((h) => ({ bet: h.bet, outcome: 'lose', net: -h.bet })),
        staked,
        net: -staked,
        abandoned: true
      });
      const stats = api.gameStats('blackjack', STAT_DEFAULTS);
      stats.hands += state.hands.length;
      stats.losses += state.hands.length;
      state.phase = 'payout';
      newRound();
      await api.persist();
    },

    /** Diagnose für die automatisierten Tests */
    debug: () => ({
      phase: state.phase,
      spots: [...state.spots],
      staked: state.staked,
      net: state.net,
      active: state.active,
      dealer: state.dealer.map((c) => `${c.r}${c.s}`),
      dealerTotal: handValue(state.dealer).total,
      holeHidden: state.holeHidden,
      shoe: { remaining: shoe.remaining, size: shoe.size, needsShuffle: shoe.needsShuffle() },
      hands: state.hands.map((h) => ({
        id: h.id, bet: h.bet, done: h.done, doubled: h.doubled, fromSplit: h.fromSplit,
        cards: h.cards.map((c) => `${c.r}${c.s}`),
        total: handValue(h.cards).total,
        bust: handValue(h.cards).bust,
        blackjack: isBlackjack(h.cards, h.fromSplit),
        result: h.result
      })),
      can: { hit: canHit(), double: canDouble(), split: canSplit(), deal: canDeal() }
    }),

    /** Nur für Tests: erzwingt ein Neumischen des Schuhs. */
    __shuffle: () => shoe.reshuffle(),
    /** Nur für Tests: liefert den Kartenwert-Helfer. */
    __value: cardValue
  };
}
