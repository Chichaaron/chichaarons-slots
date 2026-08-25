/**
 * Zentrale Konfiguration.
 *
 * SUPABASE: Leer lassen -> das Spiel nutzt lokale Browser-Accounts.
 * Sobald hier eine URL und ein anon-Key eingetragen sind, laufen
 * Registrierung, Login und Spielstand automatisch über Supabase.
 * Siehe README.md und supabase/schema.sql.
 */
export const SUPABASE_CONFIG = {
  url: '',       // z. B. 'https://xxxxxxxxxxxx.supabase.co'
  anonKey: ''    // der öffentliche "anon public" Key
};

export const APP_CONFIG = {
  /** Startguthaben für neue Konten */
  startBalance: 2000,
  /** Verfügbare Jeton-Werte */
  chips: [1, 2, 5, 10, 20, 50, 100, 200],
  /** Wie viele abgeschlossene Runden pro Konto gespeichert werden */
  maxHistory: 50,
  /** Notfall-Guthaben, wenn ein Spieler komplett pleite ist */
  bailout: 500,
  /** Maximaler Einsatz pro Feld (verhindert absurde Eingaben) */
  maxBetPerField: 100000
};
