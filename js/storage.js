/**
 * Account- und Speicherschicht.
 *
 * Es gibt zwei austauschbare Backends hinter einer gemeinsamen API:
 *
 *  - "local":    Konten liegen im localStorage des Browsers. Passwörter werden
 *                mit PBKDF2-SHA256 (210.000 Iterationen, zufälliges Salt)
 *                gehasht – niemals im Klartext gespeichert.
 *  - "supabase": Echte Server-Accounts. Authentifizierung übernimmt komplett
 *                Supabase Auth, der Spielstand liegt in der Tabelle `profiles`
 *                mit Row-Level-Security. Wird automatisch aktiv, sobald in
 *                js/config.js URL + anon-Key eingetragen sind.
 *
 * Gemeinsame API:
 *   store.init(), store.mode, store.identifierLabel
 *   store.register(id, pw), store.login(id, pw), store.logout()
 *   store.restoreSession()      -> {user, profile} | null
 *   store.saveProfile(profile), store.deleteAccount(), store.exportData()
 */
import { SUPABASE_CONFIG, APP_CONFIG } from './config.js';
import { gamertagKey } from './gamertag.js';

const LS_USERS = 'gv_roulette_users_v1';
const LS_SESSION = 'gv_roulette_session_v1';
const LS_SETTINGS = 'gv_roulette_settings_v1';

/** Frisches Profil für ein neues Konto. */
export function freshProfile() {
  return {
    gamertag: null,
    balance: APP_CONFIG.startBalance,
    stats: {
      rounds: 0,
      wagered: 0,     // insgesamt gesetzt
      won: 0,         // Summe aller Gewinne (netto, nur Gewinnrunden)
      lost: 0,        // Summe aller Verluste (netto, nur Verlustrunden)
      biggestWin: 0,
      bestBalance: APP_CONFIG.startBalance,
      bailouts: 0
    },
    history: [],      // letzte N abgeschlossene Runden
    updatedAt: new Date().toISOString()
  };
}

/** Fehlende Felder ergänzen, damit ältere Spielstände nicht kaputtgehen. */
function normalizeProfile(raw) {
  const base = freshProfile();
  if (!raw || typeof raw !== 'object') return base;
  return {
    gamertag: typeof raw.gamertag === 'string' && raw.gamertag.trim() ? raw.gamertag : null,
    balance: Number.isFinite(Number(raw.balance)) ? Math.max(0, Number(raw.balance)) : base.balance,
    stats: { ...base.stats, ...(raw.stats || {}) },
    history: Array.isArray(raw.history) ? raw.history.slice(0, APP_CONFIG.maxHistory) : [],
    updatedAt: raw.updatedAt || base.updatedAt
  };
}

/* ------------------------------------------------------------------ */
/* Passwort-Hashing für den lokalen Modus                              */
/* ------------------------------------------------------------------ */

const PBKDF2_ITERATIONS = 210000;

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

async function hashPassword(password, saltHex, iterations = PBKDF2_ITERATIONS) {
  if (!crypto?.subtle) {
    throw new Error(
      'Dein Browser stellt die Krypto-Funktionen nicht bereit. ' +
      'Bitte öffne die Seite über http://localhost oder https:// statt per Doppelklick.'
    );
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(saltHex), iterations, hash: 'SHA-256' },
    key,
    256
  );
  return toHex(bits);
}

/** Zeitkonstanter Vergleich, damit die Laufzeit nichts über das Passwort verrät. */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------------ */
/* Lokales Backend                                                     */
/* ------------------------------------------------------------------ */

function readUsers() {
  try {
    return JSON.parse(localStorage.getItem(LS_USERS) || '{}');
  } catch {
    return {};
  }
}

function writeUsers(users) {
  localStorage.setItem(LS_USERS, JSON.stringify(users));
}

const localBackend = {
  mode: 'local',
  identifierLabel: 'Benutzername',
  identifierHint: '3–20 Zeichen, Buchstaben/Zahlen/_-',
  identifierType: 'text',

  async init() {
    if (typeof localStorage === 'undefined') {
      throw new Error('Dieser Browser erlaubt keinen lokalen Speicher.');
    }
  },

  validateIdentifier(name) {
    const value = String(name || '').trim();
    if (!/^[\w.-]{3,20}$/.test(value)) {
      return 'Benutzername: 3–20 Zeichen, nur Buchstaben, Zahlen, . _ -';
    }
    return null;
  },

  async register(name, password) {
    const key = String(name).trim().toLowerCase();
    const users = readUsers();
    if (users[key]) throw new Error('Dieser Benutzername ist bereits vergeben.');
    const salt = randomSalt();
    const hash = await hashPassword(password, salt);
    users[key] = {
      username: String(name).trim(),
      salt,
      hash,
      iterations: PBKDF2_ITERATIONS,
      createdAt: new Date().toISOString(),
      profile: freshProfile()
    };
    writeUsers(users);
    localStorage.setItem(LS_SESSION, key);
    return { user: { id: key, name: users[key].username }, profile: normalizeProfile(users[key].profile) };
  },

  async login(name, password) {
    const key = String(name).trim().toLowerCase();
    const users = readUsers();
    const record = users[key];
    if (!record) throw new Error('Benutzername oder Passwort ist falsch.');
    const hash = await hashPassword(password, record.salt, record.iterations || PBKDF2_ITERATIONS);
    if (!safeEqual(hash, record.hash)) throw new Error('Benutzername oder Passwort ist falsch.');
    localStorage.setItem(LS_SESSION, key);
    return { user: { id: key, name: record.username }, profile: normalizeProfile(record.profile) };
  },

  async restoreSession() {
    const key = localStorage.getItem(LS_SESSION);
    if (!key) return null;
    const record = readUsers()[key];
    if (!record) {
      localStorage.removeItem(LS_SESSION);
      return null;
    }
    return { user: { id: key, name: record.username }, profile: normalizeProfile(record.profile) };
  },

  async logout() {
    localStorage.removeItem(LS_SESSION);
  },

  async saveProfile(userId, profile) {
    const users = readUsers();
    if (!users[userId]) return;
    users[userId].profile = { ...profile, updatedAt: new Date().toISOString() };
    writeUsers(users);
  },

  async deleteAccount(userId) {
    const users = readUsers();
    delete users[userId];
    writeUsers(users);
    localStorage.removeItem(LS_SESSION);
  },

  /** Gamertag setzen. Eindeutigkeit wird über alle lokalen Konten geprüft. */
  async setGamertag(userId, name) {
    const users = readUsers();
    const key = gamertagKey(name);
    for (const [id, rec] of Object.entries(users)) {
      if (id !== userId && rec.profile?.gamertag && gamertagKey(rec.profile.gamertag) === key) {
        throw new Error('Dieser Gamertag ist bereits vergeben.');
      }
    }
    if (!users[userId]) throw new Error('Konto nicht gefunden.');
    users[userId].profile = { ...users[userId].profile, gamertag: name };
    writeUsers(users);
    return name;
  },

  /** Zeitpunkte der letzten Bonusabholungen (lokal: Gerätezeit). */
  async bonusState(userId) {
    const rec = readUsers()[userId];
    const b = rec?.bonuses || {};
    return {
      serverNow: Date.now(),
      daily: b.daily || 0,
      timed: b.timed || 0,
      weekly: b.weekly || 0,
      bailout: b.bailout || 0,
      balance: rec?.profile?.balance ?? 0
    };
  },

  /**
   * Bonus abholen. Läuft auf dem GESPEICHERTEN Stand, damit offene Einsätze
   * am Roulettetisch nicht durcheinandergeraten – genau wie in Supabase.
   */
  async claimBonus(userId, kind, amount, readyAt) {
    const users = readUsers();
    const rec = users[userId];
    if (!rec) throw new Error('Konto nicht gefunden.');
    rec.bonuses = rec.bonuses || {};
    const now = Date.now();
    // Das Notfallguthaben hängt nicht an der Zeit, sondern am Kontostand.
    if (kind === 'bailout') {
      if (Number(rec.profile.balance || 0) > 0) {
        throw new Error('Notfallguthaben gibt es nur bei genau 0 € Guthaben.');
      }
    } else if (now < readyAt(rec.bonuses[kind] || 0)) {
      throw new Error('Dieser Bonus ist noch nicht verfügbar.');
    }
    rec.bonuses[kind] = now;
    rec.profile.balance = Math.min(999999999999, Number(rec.profile.balance || 0) + amount);
    writeUsers(users);
    return {
      balance: rec.profile.balance, serverNow: now, amount,
      daily: rec.bonuses.daily || 0, timed: rec.bonuses.timed || 0,
      weekly: rec.bonuses.weekly || 0, bailout: rec.bonuses.bailout || 0
    };
  }
};

/* ------------------------------------------------------------------ */
/* Supabase-Backend                                                    */
/* ------------------------------------------------------------------ */

const supabaseBackend = {
  mode: 'supabase',
  identifierLabel: 'E-Mail-Adresse',
  identifierHint: 'Wird nur für Login und Passwort-Reset genutzt',
  identifierType: 'email',
  client: null,

  async init() {
    // SDK wird erst geladen, wenn Supabase auch wirklich konfiguriert ist.
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.45.4');
    this.client = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
  },

  validateIdentifier(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())
      ? null
      : 'Bitte gib eine gültige E-Mail-Adresse ein.';
  },

  /** Profil laden – oder anlegen, falls der DB-Trigger noch nicht gelaufen ist. */
  async _fetchProfile(userId) {
    const { data, error } = await this.client
      .from('profiles')
      .select('balance, stats, history, gamertag')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return normalizeProfile(data);

    const profile = freshProfile();
    const { error: insertError } = await this.client.from('profiles').insert({
      id: userId,
      balance: profile.balance,
      stats: profile.stats,
      history: profile.history
    });
    if (insertError) throw new Error(insertError.message);
    return profile;
  },

  async register(email, password) {
    const { data, error } = await this.client.auth.signUp({ email: String(email).trim(), password });
    if (error) throw new Error(translateAuthError(error.message));
    if (!data.session) {
      throw new Error(
        'Konto angelegt. Bitte bestätige zuerst die E-Mail-Adresse und melde dich anschließend an.'
      );
    }
    return { user: { id: data.user.id, name: data.user.email }, profile: await this._fetchProfile(data.user.id) };
  },

  async login(email, password) {
    const { data, error } = await this.client.auth.signInWithPassword({
      email: String(email).trim(),
      password
    });
    if (error) throw new Error(translateAuthError(error.message));
    return { user: { id: data.user.id, name: data.user.email }, profile: await this._fetchProfile(data.user.id) };
  },

  async restoreSession() {
    const { data } = await this.client.auth.getSession();
    if (!data.session) return null;
    const user = data.session.user;
    return { user: { id: user.id, name: user.email }, profile: await this._fetchProfile(user.id) };
  },

  async logout() {
    await this.client.auth.signOut();
  },

  async saveProfile(userId, profile) {
    const { error } = await this.client
      .from('profiles')
      .update({
        balance: profile.balance,
        stats: profile.stats,
        history: profile.history,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);
    if (error) throw new Error(error.message);
  },

  /**
   * Gamertag setzen. Die Eindeutigkeit sichert ein UNIQUE-Index in der
   * Datenbank – dadurch können zwei Spieler denselben Namen auch bei
   * gleichzeitigem Speichern nicht beide bekommen.
   */
  async setGamertag(userId, name) {
    const { error } = await this.client
      .from('profiles')
      .update({ gamertag: name, updated_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) {
      if (error.code === '23505' || /duplicate|unique/i.test(error.message)) {
        throw new Error('Dieser Gamertag ist bereits vergeben.');
      }
      if (/column .*gamertag/i.test(error.message)) {
        throw new Error('Die Datenbank kennt das Feld "gamertag" noch nicht – bitte das SQL-Update ausführen.');
      }
      throw new Error(error.message);
    }
    return name;
  },

  /** Bonusstatus samt SERVERZEIT – die Uhr des Geräts spielt keine Rolle. */
  async bonusState() {
    const { data, error } = await this.client.rpc('bonus_state');
    if (error) throw new Error(error.message);
    return {
      serverNow: Date.parse(data.serverNow),
      daily: data.daily ? Date.parse(data.daily) : 0,
      timed: data.timed ? Date.parse(data.timed) : 0,
      weekly: data.weekly ? Date.parse(data.weekly) : 0,
      bailout: data.bailout ? Date.parse(data.bailout) : 0,
      balance: Number(data.balance)
    };
  },

  /** Abholen läuft komplett auf dem Server: prüfen, buchen, markieren in einem Schritt. */
  async claimBonus(_userId, kind) {
    const { data, error } = await this.client.rpc('claim_bonus', { kind });
    if (error) throw new Error(error.message);
    return {
      balance: Number(data.balance),
      serverNow: Date.parse(data.serverNow),
      amount: Number(data.amount),
      daily: data.daily ? Date.parse(data.daily) : 0,
      timed: data.timed ? Date.parse(data.timed) : 0,
      weekly: data.weekly ? Date.parse(data.weekly) : 0,
      bailout: data.bailout ? Date.parse(data.bailout) : 0
    };
  },

  async deleteAccount() {
    // Löscht Auth-Benutzer + Profil serverseitig (SECURITY DEFINER Funktion).
    const { error } = await this.client.rpc('delete_own_account');
    if (error) throw new Error(error.message);
    await this.client.auth.signOut();
  }
};

function translateAuthError(message) {
  const m = String(message).toLowerCase();
  if (m.includes('invalid login')) return 'E-Mail oder Passwort ist falsch.';
  if (m.includes('already registered')) return 'Für diese E-Mail existiert bereits ein Konto.';
  if (m.includes('password')) return 'Das Passwort erfüllt die Anforderungen nicht (mind. 6 Zeichen).';
  return message;
}

/* ------------------------------------------------------------------ */
/* Öffentliche Fassade                                                 */
/* ------------------------------------------------------------------ */

const supabaseConfigured = Boolean(SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey);

export const store = {
  backend: supabaseConfigured ? supabaseBackend : localBackend,
  userId: null,
  userName: null,

  get mode() { return this.backend.mode; },
  get identifierLabel() { return this.backend.identifierLabel; },
  get identifierHint() { return this.backend.identifierHint; },
  get identifierType() { return this.backend.identifierType; },

  async init() {
    try {
      await this.backend.init();
    } catch (err) {
      // Supabase nicht erreichbar -> lieber lokal weiterspielen als Totalausfall.
      if (this.backend.mode === 'supabase') {
        console.warn('Supabase konnte nicht geladen werden, wechsle auf lokale Konten.', err);
        this.backend = localBackend;
        await this.backend.init();
        this.fallbackReason = 'Supabase ist gerade nicht erreichbar – es werden lokale Konten genutzt.';
      } else {
        throw err;
      }
    }
  },

  validateIdentifier(value) { return this.backend.validateIdentifier(value); },

  async register(identifier, password) {
    const session = await this.backend.register(identifier, password);
    this.userId = session.user.id;
    this.userName = session.user.name;
    return session;
  },

  async login(identifier, password) {
    const session = await this.backend.login(identifier, password);
    this.userId = session.user.id;
    this.userName = session.user.name;
    return session;
  },

  async restoreSession() {
    const session = await this.backend.restoreSession();
    if (session) {
      this.userId = session.user.id;
      this.userName = session.user.name;
    }
    return session;
  },

  async logout() {
    await this.backend.logout();
    this.userId = null;
    this.userName = null;
  },

  async saveProfile(profile) {
    if (!this.userId) return;
    await this.backend.saveProfile(this.userId, profile);
  },

  async deleteAccount() {
    if (!this.userId) return;
    await this.backend.deleteAccount(this.userId);
    this.userId = null;
    this.userName = null;
  },

  async setGamertag(name) {
    if (!this.userId) throw new Error('Nicht angemeldet.');
    return this.backend.setGamertag(this.userId, name);
  },

  async bonusState() {
    if (!this.userId) return null;
    return this.backend.bonusState(this.userId);
  },

  /**
   * @param {string} kind      'bailout' | 'daily' | 'timed' | 'weekly'
   * @param {number} amount    Betrag (nur im lokalen Modus nötig)
   * @param {(last:number)=>number} readyAt  Zeitpunkt der nächsten Abholung (nur lokal)
   */
  async claimBonus(kind, amount, readyAt) {
    if (!this.userId) throw new Error('Nicht angemeldet.');
    return this.backend.claimBonus(this.userId, kind, amount, readyAt);
  }
};

/* ------------------------------------------------------------------ */
/* Einstellungen (rein lokal, kein Personenbezug)                      */
/* ------------------------------------------------------------------ */

export const defaultSettings = {
  sound: true,
  volume: 70,
  speed: 'normal',        // Tempo der Roulette-Animation
  cardSpeed: 'normal',    // Tempo der Blackjack-Kartenanimation
  bjStatsOpen: false,     // Blackjack-Bilanz aufgeklappt?
  plinkoRisk: 'mittel',   // zuletzt gewählte Plinko-Schwierigkeit
  plinkoStatsOpen: false, // Plinko-Bilanz aufgeklappt?
  crashStatsOpen: false,  // Crash-Bilanz aufgeklappt?
  confirmBets: false
};

export function loadSettings() {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}') };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
  } catch { /* Speicher blockiert – Einstellungen gelten dann nur für diese Sitzung */ }
}
