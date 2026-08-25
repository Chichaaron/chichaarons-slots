/**
 * Zentrale Konfiguration.
 *
 * SUPABASE: Leer lassen -> das Spiel nutzt lokale Browser-Accounts.
 * Sobald hier eine URL und ein anon-Key eingetragen sind, laufen
 * Registrierung, Login und Spielstand automatisch über Supabase.
 * Siehe README.md und supabase/schema.sql.
 */
export const SUPABASE_CONFIG = {
  url: 'https://dipvmfyzglavxepfkady.supabase.co/rest/v1/',
  anonKey: 'sb_publishable_6JeVQI6ZSqZHC3vud5-I_Q_3lHBNrbG'
};

export const APP_CONFIG = {
  /** Startguthaben für neue Konten */
  startBalance: 5000,
  /** Verfügbare Jeton-Werte */
  chips: [1, 2, 5, 10, 20, 50, 100, 200],
  /** Wie viele abgeschlossene Runden pro Konto gespeichert werden */
  maxHistory: 50,
  /** Notfall-Guthaben, wenn ein Spieler komplett pleite ist */
  bailout: 500,
  /** Maximaler Einsatz pro Feld (verhindert absurde Eingaben) */
  maxBetPerField: 100000
};
