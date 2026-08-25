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

const LS_USERS = 'gv_roulette_users_v1';
const LS_SESSION = 'gv_roulette_session_v1';
const LS_SETTINGS = 'gv_roulette_settings_v1';

/** Frisches Profil für ein neues Konto. */
export function freshProfile() {
  return {
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
      .select('balance, stats, history')
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
  }
};

/* ------------------------------------------------------------------ */
/* Einstellungen (rein lokal, kein Personenbezug)                      */
/* ------------------------------------------------------------------ */

export const defaultSettings = { sound: true, speed: 'normal', confirmBets: false };

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
