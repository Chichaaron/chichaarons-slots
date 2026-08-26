/**
 * Katalog: alle Minigames und alle kaufbaren Designs.
 *
 * HIER wird erweitert – nirgendwo sonst:
 *
 *   Neues Spiel:   einen Eintrag in GAMES ergänzen. Solange `available: false`
 *                  ist, erscheint es als Platzhalter-Karte. Sobald das Spiel
 *                  fertig ist, `available: true` setzen und `screen` auf die
 *                  ID des zugehörigen <section class="screen"> im index.html.
 *
 *   Neues Design:  einen Eintrag in THEMES ergänzen und im style.css einen
 *                  Block ':root[data-theme="<id>"] { … }' mit denselben
 *                  Tokens anlegen. Mehr ist nicht nötig.
 */

/* ------------------------------------------------------------------ */
/* Minigames                                                           */
/* ------------------------------------------------------------------ */

export const GAMES = [
  {
    id: 'roulette',
    title: 'Europäisches Roulette',
    tagline: 'Setze deine Chips und teste dein Glück.',
    facts: ['37 Zahlen', 'Auszahlung bis 35:1', 'Einzelzahl & Außenwetten'],
    available: true,
    screen: 'game'          // welcher Bildschirm geöffnet wird
  },
  {
    id: 'mines',
    title: 'Mines',
    tagline: 'Deck Felder auf, weich den Minen aus, zahl rechtzeitig aus.',
    facts: ['4×4 bis 7×7', 'Multiplikator steigt', 'Cash-Out jederzeit'],
    available: true,
    screen: 'mines'
  },
  {
    id: 'blackjack',
    title: 'Blackjack',
    tagline: 'Schlag den Dealer – so nah an 21 wie möglich, ohne drüber.',
    facts: ['Bis zu 5 Hände', 'Blackjack zahlt 3:2', 'Verdoppeln & Teilen'],
    available: true,
    screen: 'blackjack'
  },
  {
    id: 'crash',
    title: 'Crash',
    tagline: 'Die Kurve steigt – zahl aus, bevor sie abstürzt.',
    facts: ['Bis 50.000×', 'Cash-Out jederzeit', 'Eine Entscheidung'],
    available: true,
    screen: 'crash'
  },
  {
    id: 'plinko',
    title: 'Plinko',
    tagline: 'Lass die Kugel fallen und schau, in welchem Feld sie landet.',
    facts: ['16 Reihen', 'Vier Risikostufen', 'Bis 10.000×'],
    available: true,
    screen: 'plinko'
  },
  {
    id: 'soon',
    title: 'Weitere Minigames',
    tagline: 'In Arbeit – schau bald wieder vorbei.',
    facts: ['Demnächst'],
    available: false
  }
];

/* ------------------------------------------------------------------ */
/* Designs (Themes)                                                    */
/* ------------------------------------------------------------------ */

export const DEFAULT_THEME = 'classic';

export const THEMES = [
  {
    id: 'classic',
    name: 'Classic Green',
    price: 0,
    blurb: 'Der klassische Tisch in tiefem Grün mit Gold.',
    swatch: ['#0f2c1e', '#b32127', '#d4af6a']
  },
  {
    id: 'noir',
    name: 'Noir',
    price: 15000,
    blurb: 'Tiefes Schwarz, Platin statt Gold. Ruhig und elegant.',
    swatch: ['#15151a', '#a81f28', '#b8b3a6']
  },
  {
    id: 'royal',
    name: 'Royal Bordeaux',
    price: 30000,
    blurb: 'Weinrotes Tuch mit warmen Messingakzenten.',
    swatch: ['#3a0f1e', '#c22b38', '#dcb367']
  },
  {
    id: 'platinum',
    name: 'Platinum',
    price: 75000,
    blurb: 'Kühles Weiß und Graphit. Klare Kanten, keine Farbe zu viel.',
    swatch: ['#f4f5f7', '#9b2430', '#3a4049']
  },
  {
    id: 'ivory',
    name: 'Ivory & Gold',
    price: 100000,
    blurb: 'Heller Salon in Elfenbein – Ränder, Knöpfe und Akzente in warmem Gold.',
    swatch: ['#f1e8d4', '#8f1a24', '#9a7327']
  }
];

/** @returns {object|undefined} */
export const themeById = (id) => THEMES.find((t) => t.id === id);

/** Gültige Theme-ID oder das Standarddesign. */
export function safeThemeId(id) {
  return themeById(id) ? id : DEFAULT_THEME;
}
