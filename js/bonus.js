/**
 * Bonus-System: drei Boni mit unterschiedlichen Zyklen.
 *
 * Alle Zeitpunkte kommen vom Server (Supabase). Die Anzeige rechnet nur mit
 * einem einmal ermittelten Versatz zwischen Server- und Gerätezeit; ob ein
 * Bonus wirklich abgeholt werden darf, entscheidet ausschließlich der Server.
 */

/** Feste Zeitzone für die Tages- und Wochengrenzen: GMT+2. */
export const TZ_OFFSET_MS = 2 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export const BONUSES = [
  {
    id: 'daily',
    label: 'Tagesbonus',
    amount: 10000,
    blurb: 'Jeden Tag um 00:00 Uhr (GMT+2) wieder verfügbar.'
  },
  {
    id: 'timed',
    label: 'Zeitbonus',
    amount: 2000,
    blurb: 'Alle 4 Stunden nach der letzten Abholung.'
  },
  {
    id: 'weekly',
    label: 'Wochenbonus',
    amount: 25000,
    blurb: 'Jeden Montag um 00:00 Uhr (GMT+2) wieder verfügbar.'
  }
];

export const TIMED_INTERVAL_MS = 4 * 60 * 60 * 1000;

export const bonusById = (id) => BONUSES.find((b) => b.id === id);

/* ------------------------------------------------------------------ */
/* Zeitgrenzen in GMT+2                                                */
/* ------------------------------------------------------------------ */

/** Beginn des Tages (00:00 GMT+2), in dem `ms` liegt – als UTC-Zeitstempel. */
export function dayStart(ms) {
  return Math.floor((ms + TZ_OFFSET_MS) / DAY_MS) * DAY_MS - TZ_OFFSET_MS;
}

/** Beginn der Woche (Montag 00:00 GMT+2), in der `ms` liegt. */
export function weekStart(ms) {
  const dayIndex = Math.floor((ms + TZ_OFFSET_MS) / DAY_MS);
  // Epochentag 0 war ein Donnerstag -> +3 verschiebt den Wochenstart auf Montag
  const mondayIndex = dayIndex - ((dayIndex + 3) % 7 + 7) % 7;
  return mondayIndex * DAY_MS - TZ_OFFSET_MS;
}

/**
 * Wann der Bonus nach der Abholung um `lastMs` wieder bereitsteht.
 * @returns {number} UTC-Zeitstempel; 0 bedeutet "sofort".
 */
export function nextAvailableAt(kind, lastMs) {
  if (!lastMs) return 0;
  if (kind === 'timed') return lastMs + TIMED_INTERVAL_MS;
  if (kind === 'daily') return dayStart(lastMs) + DAY_MS;
  if (kind === 'weekly') return weekStart(lastMs) + 7 * DAY_MS;
  return 0;
}

export const isAvailable = (kind, lastMs, nowMs) => nowMs >= nextAvailableAt(kind, lastMs);

/**
 * Zustand aller Boni.
 * @param {{daily?:number, timed?:number, weekly?:number}} last  Zeitstempel der letzten Abholungen
 * @param {number} nowMs  aktuelle (Server-)Zeit
 */
export function bonusStatus(last, nowMs) {
  return BONUSES.map((bonus) => {
    const lastMs = last?.[bonus.id] || 0;
    const readyAt = nextAvailableAt(bonus.id, lastMs);
    return {
      ...bonus,
      lastMs,
      readyAt,
      available: nowMs >= readyAt,
      remainingMs: Math.max(0, readyAt - nowMs)
    };
  });
}

/** Ist mindestens einer der Boni abholbar? */
export const anyAvailable = (last, nowMs) => bonusStatus(last, nowMs).some((b) => b.available);

/** 9045000 -> "02:30:45" · 45000 -> "00:00:45" */
export function formatDuration(ms) {
  const total = Math.ceil(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return d > 0 ? `${d} T ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}
