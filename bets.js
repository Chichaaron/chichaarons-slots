/**
 * Verwaltet die Einsätze der laufenden Runde.
 *
 * Wichtig für die Guthaben-Logik: Einsätze werden bereits beim Platzieren
 * vom Guthaben abgezogen (siehe app.js). Dieses Modul kennt nur die Beträge
 * pro Feld und die Reihenfolge für "Rückgängig".
 */
import { betInfo } from './roulette.js';
import { APP_CONFIG } from './config.js';

export function createLedger() {
  /** @type {Map<string, number>} Feld-ID -> gesetzter Betrag */
  const map = new Map();
  /** @type {Array<{id:string, amount:number}>} Reihenfolge fürs Rückgängigmachen */
  const stack = [];

  return {
    get map() { return map; },

    /** @returns {number} tatsächlich gesetzter Betrag (0 = abgelehnt) */
    add(id, amount, available) {
      const value = Math.floor(Number(amount));
      if (!Number.isFinite(value) || value <= 0) return 0;
      if (value > available) return 0;                       // nie mehr als das Guthaben
      const current = map.get(id) || 0;
      if (current + value > APP_CONFIG.maxBetPerField) return 0;
      map.set(id, current + value);
      stack.push({ id, amount: value });
      return value;
    },

    /** Macht den letzten Einsatz rückgängig. @returns {{id,amount}|null} */
    undo() {
      const last = stack.pop();
      if (!last) return null;
      const rest = (map.get(last.id) || 0) - last.amount;
      if (rest > 0) map.set(last.id, rest);
      else map.delete(last.id);
      return last;
    },

    /** Entfernt den letzten Einsatz auf genau diesem Feld (Rechtsklick). */
    removeFrom(id) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].id !== id) continue;
        const [entry] = stack.splice(i, 1);
        const rest = (map.get(id) || 0) - entry.amount;
        if (rest > 0) map.set(id, rest);
        else map.delete(id);
        return entry;
      }
      return null;
    },

    /** Leert den Tisch. @returns {number} zurückgegebener Gesamtbetrag */
    clear() {
      const total = this.total();
      map.clear();
      stack.length = 0;
      return total;
    },

    total() {
      let sum = 0;
      for (const v of map.values()) sum += v;
      return sum;
    },

    count() { return map.size; },

    /** Einsätze als Liste – sortiert: Außenwetten zuerst, dann Zahlen aufsteigend. */
    entries() {
      return [...map.entries()]
        .map(([id, amount]) => ({ id, amount, info: betInfo(id) }))
        .sort((a, b) => {
          const an = a.info.number, bn = b.info.number;
          if (an === undefined && bn === undefined) return a.info.label.localeCompare(b.info.label);
          if (an === undefined) return -1;
          if (bn === undefined) return 1;
          return an - bn;
        });
    },

    /** Momentaufnahme für "Einsätze wiederholen". */
    snapshot() {
      return stack.map((e) => ({ ...e }));
    },

    /** Setzt eine Momentaufnahme wieder auf den Tisch, soweit das Guthaben reicht. */
    restore(snapshot, available) {
      let spent = 0;
      for (const entry of snapshot) {
        const placed = this.add(entry.id, entry.amount, available - spent);
        spent += placed;
      }
      return spent;
    }
  };
}
