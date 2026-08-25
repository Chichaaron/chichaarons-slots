/**
 * Tests der reinen Spiellogik (ohne Browser).
 * Ausführen:  node tests/logic.test.mjs
 */
import assert from 'node:assert/strict';
import {
  WHEEL_ORDER, RED_NUMBERS, colorOf, spinNumber, betInfo, resolveBet, resolveRound, OUTSIDE_BET_IDS
} from '../js/roulette.js';
import { createLedger } from '../js/bets.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

console.log('\nRad & Farben');
test('Rad hat 37 eindeutige Zahlen 0–36', () => {
  assert.equal(WHEEL_ORDER.length, 37);
  assert.equal(new Set(WHEEL_ORDER).size, 37);
  for (let n = 0; n <= 36; n++) assert.ok(WHEEL_ORDER.includes(n), `${n} fehlt`);
});
test('18 rote, 18 schwarze Zahlen, 0 ist grün', () => {
  let red = 0, black = 0, green = 0;
  for (let n = 0; n <= 36; n++) {
    const c = colorOf(n);
    if (c === 'red') red++; else if (c === 'black') black++; else green++;
  }
  assert.deepEqual([red, black, green], [18, 18, 1]);
});
test('Rot/Schwarz entsprechen der offiziellen Verteilung', () => {
  assert.equal(RED_NUMBERS.size, 18);
  // Stichproben aus dem echten Rad
  for (const n of [1, 3, 12, 19, 27, 36]) assert.equal(colorOf(n), 'red', `${n} sollte rot sein`);
  for (const n of [2, 4, 11, 20, 28, 35]) assert.equal(colorOf(n), 'black', `${n} sollte schwarz sein`);
});

console.log('\nAuszahlungen');
test('Einzelzahl zahlt 35:1 plus Einsatz zurück', () => {
  const r = resolveBet({ id: 'straight:17', amount: 10 }, 17);
  assert.equal(r.won, true);
  assert.equal(r.payout, 360);   // 10 Einsatz + 350 Gewinn
  assert.equal(r.net, 350);
  const l = resolveBet({ id: 'straight:17', amount: 10 }, 18);
  assert.deepEqual([l.won, l.payout, l.net], [false, 0, -10]);
});
test('Beispiel aus der Aufgabe: Rot 20 € -> +20 € Gewinn (40 € zurück)', () => {
  const r = resolveBet({ id: 'red', amount: 20 }, 3);   // 3 ist rot
  assert.equal(r.payout, 40);
  assert.equal(r.net, 20);
});
test('1st 12 mit 50 € -> +100 € Gewinn (150 € zurück)', () => {
  const r = resolveBet({ id: 'dozen1', amount: 50 }, 7);
  assert.equal(r.payout, 150);
  assert.equal(r.net, 100);
});
test('Null lässt alle einfachen Chancen und Dutzende verlieren', () => {
  for (const id of ['red', 'black', 'even', 'odd', 'low', 'high', 'dozen1', 'dozen2', 'dozen3', 'col1', 'col2', 'col3']) {
    const r = resolveBet({ id, amount: 10 }, 0);
    assert.equal(r.won, false, `${id} dürfte bei 0 nicht gewinnen`);
  }
  assert.equal(resolveBet({ id: 'straight:0', amount: 10 }, 0).net, 350);
});
test('Kolonnen decken je 12 Zahlen ab und überschneiden sich nicht', () => {
  const sets = ['col1', 'col2', 'col3'].map((id) => {
    const info = betInfo(id);
    return new Set([...Array(37).keys()].filter((n) => info.matches(n)));
  });
  sets.forEach((s) => assert.equal(s.size, 12));
  const union = new Set([...sets[0], ...sets[1], ...sets[2]]);
  assert.equal(union.size, 36);
  assert.ok(!union.has(0));
});
test('Dutzende decken je 12 Zahlen ab', () => {
  for (const id of ['dozen1', 'dozen2', 'dozen3']) {
    const info = betInfo(id);
    assert.equal([...Array(37).keys()].filter((n) => info.matches(n)).length, 12);
  }
});
test('Jede Wettart hat exakt den Hausvorteil von 1/37 (2,70 %)', () => {
  const ids = ['straight:0', 'straight:17', ...OUTSIDE_BET_IDS];
  for (const id of ids) {
    let ev = 0;
    for (let n = 0; n <= 36; n++) ev += resolveBet({ id, amount: 1 }, n).net;
    const edge = -(ev / 37);
    assert.ok(Math.abs(edge - 1 / 37) < 1e-12, `${id}: Hausvorteil ${edge}`);
  }
});
test('Mehrfachwetten werden korrekt zusammengerechnet', () => {
  // Beispiel aus der Aufgabe: 20 € Rot, 10 € auf 17, 50 € auf 1st 12
  const bets = [
    { id: 'red', amount: 20 },
    { id: 'straight:17', amount: 10 },
    { id: 'dozen1', amount: 50 }
  ];
  const round = resolveRound(bets, 3);       // 3: rot, 1. Dutzend, nicht 17
  assert.equal(round.staked, 80);
  assert.equal(round.returned, 40 + 0 + 150);
  assert.equal(round.net, 110);
  const round2 = resolveRound(bets, 26);     // 26: schwarz, 3. Dutzend -> alles verloren
  assert.equal(round2.returned, 0);
  assert.equal(round2.net, -80);
});

console.log('\nZufallssystem');
test('spinNumber liefert nur ganze Zahlen 0–36', () => {
  for (let i = 0; i < 5000; i++) {
    const n = spinNumber();
    assert.ok(Number.isInteger(n) && n >= 0 && n <= 36, `ungültig: ${n}`);
  }
});
test('Verteilung ist gleichmäßig (Chi-Quadrat < 58,6 bei df=36)', () => {
  const N = 370000;
  const counts = new Array(37).fill(0);
  for (let i = 0; i < N; i++) counts[spinNumber()]++;
  const expected = N / 37;
  const chi2 = counts.reduce((s, c) => s + ((c - expected) ** 2) / expected, 0);
  console.log(`      Chi² = ${chi2.toFixed(2)} (kritisch 58,62 bei p=0,01)`);
  assert.ok(chi2 < 58.62, `Chi² zu hoch: ${chi2}`);
  assert.ok(counts.every((c) => c > 0));
});

console.log('\nEinsatzverwaltung');
test('Es kann nie mehr gesetzt werden als vorhanden', () => {
  const l = createLedger();
  assert.equal(l.add('red', 100, 50), 0);      // zu teuer -> abgelehnt
  assert.equal(l.total(), 0);
  assert.equal(l.add('red', 50, 50), 50);
  assert.equal(l.total(), 50);
});
test('Ungültige Beträge werden abgelehnt', () => {
  const l = createLedger();
  for (const bad of [0, -5, NaN, Infinity, 'abc', null]) {
    assert.equal(l.add('red', bad, 1000), 0, `${bad} hätte abgelehnt werden müssen`);
  }
  assert.equal(l.total(), 0);
});
test('Rückgängig und Löschen erstatten exakt', () => {
  const l = createLedger();
  l.add('red', 20, 1000);
  l.add('straight:17', 10, 980);
  l.add('red', 30, 970);
  assert.equal(l.map.get('red'), 50);
  assert.equal(l.undo().amount, 30);
  assert.equal(l.map.get('red'), 20);
  assert.equal(l.total(), 30);
  assert.equal(l.clear(), 30);
  assert.equal(l.total(), 0);
});
test('Rechtsklick entfernt nur den letzten Einsatz dieses Feldes', () => {
  const l = createLedger();
  l.add('red', 20, 1000); l.add('black', 5, 980); l.add('red', 30, 975);
  assert.equal(l.removeFrom('red').amount, 30);
  assert.equal(l.map.get('red'), 20);
  assert.equal(l.map.get('black'), 5);
  assert.equal(l.removeFrom('green'), null);
});
test('Wiederholen setzt nur so viel wie bezahlbar', () => {
  const l = createLedger();
  l.add('red', 100, 1000); l.add('black', 100, 900);
  const snap = l.snapshot();
  l.clear();
  const spent = l.restore(snap, 150);         // reicht nur für die erste Wette
  assert.equal(spent, 100);
  assert.equal(l.total(), 100);
});

console.log('\nGuthaben-Simulation über 200.000 Runden');
test('Guthaben bleibt konsistent und nie negativ', () => {
  let balance = 2000;
  let bailouts = 0;
  const ledger = createLedger();
  const ids = ['red', 'black', 'even', 'odd', 'low', 'high', 'dozen1', 'dozen2', 'dozen3', 'col1', 'col2', 'col3'];

  for (let round = 0; round < 200000; round++) {
    if (balance <= 0) { balance += 500; bailouts++; }
    // 1–4 zufällige Einsätze platzieren
    const n = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const id = Math.random() < 0.4
        ? `straight:${Math.floor(Math.random() * 37)}`
        : ids[Math.floor(Math.random() * ids.length)];
      const amount = [1, 2, 5, 10, 20, 50][Math.floor(Math.random() * 6)];
      const placed = ledger.add(id, amount, balance);
      balance -= placed;
      assert.ok(balance >= 0, 'Guthaben wurde negativ beim Setzen');
    }
    const entries = ledger.entries().map((e) => ({ id: e.id, amount: e.amount }));
    if (!entries.length) { ledger.clear(); continue; }
    const result = resolveRound(entries, spinNumber());
    balance += result.returned;
    ledger.clear();
    assert.ok(balance >= 0, 'Guthaben wurde negativ nach der Auswertung');
    assert.ok(Number.isFinite(balance));
  }
  console.log(`      Endguthaben: ${balance.toFixed(0)} € nach 200.000 Runden (${bailouts}× Notfall-Guthaben)`);
  assert.ok(bailouts > 0, 'Simulation sollte irgendwann pleite gehen (Hausvorteil)');
});

console.log(`\n${passed} Tests bestanden.${process.exitCode ? ' EINIGE FEHLGESCHLAGEN.' : ''}\n`);
