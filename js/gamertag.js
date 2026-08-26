/**
 * Gamertag: Prüfung, Normalisierung und Namensfilter.
 *
 * Der Filter arbeitet nicht mit einer einzelnen Wortliste, sondern in Stufen:
 *   1. Zeichen und Länge prüfen
 *   2. Namen normalisieren (Kleinschreibung, Akzente, Leetspeak, Trennzeichen)
 *   3. zusätzlich eine "gestauchte" Fassung bilden (Zeichenwiederholungen weg)
 *   4. harmlose Wörter, die zufällig einen Baustein enthalten, herausnehmen
 *   5. beide Fassungen gegen die Blockliste prüfen
 *
 * Dadurch werden Umgehungsversuche wie "H1-T.L.E.R" oder "fiiick" erkannt,
 * ohne dass normale Namen wie "Analyse" oder "Fickle" fälschlich blockiert werden.
 */

export const MIN_LENGTH = 3;
export const MAX_LENGTH = 22;

/** Erlaubt: Buchstaben (auch mit Akzent), Ziffern, Leerzeichen, gängige Sonderzeichen. */
const ALLOWED = /^[\p{L}\p{N} _\-.'!?+*#~^()\[\]{}<>|\/\\&%$@=,;:"]+$/u;

/* ------------------------------------------------------------------ */
/* Normalisierung                                                      */
/* ------------------------------------------------------------------ */

const LEET = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '6': 'g',
  '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i',
  '|': 'i', '+': 't', '(': 'c', '€': 'e', '£': 'l'
};

/** Kleinschreibung, Akzente weg, Leetspeak aufgelöst, nur Buchstaben und Ziffern. */
export function normalizeName(name) {
  let s = String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')   // Akzente entfernen
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/œ/g, 'oe');
  s = [...s].map((ch) => LEET[ch] ?? ch).join('');
  return s.replace(/[^a-z0-9]/g, '');
}

/**
 * Wie normalizeName, aber OHNE Leetspeak-Auflösung. Nötig, damit Zahlencodes
 * wie 1488 erhalten bleiben – sonst würde daraus "iabb".
 */
export function plainName(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

/** Zusätzlich alle Zeichenwiederholungen auf eines eindampfen: "hiiitler" -> "hitler". */
export const squeeze = (normalized) => normalized.replace(/(.)\1+/g, '$1');

/* ------------------------------------------------------------------ */
/* Listen                                                              */
/* ------------------------------------------------------------------ */

/**
 * Harmlose Wörter, die zufällig einen gesperrten Baustein enthalten.
 * Sie werden vor der Prüfung aus dem Namen entfernt.
 */
const ALLOWED_WORDS = [
  'analyse', 'analysis', 'analytic', 'analog', 'banal', 'canal', 'kanal',
  'fickle', 'niggle', 'shiitake', 'scunthorpe', 'assassin', 'klassiker',
  'penistone', 'cockpit', 'cocktail', 'hitliste', 'schlagzeile'
];

/**
 * Gesperrte Bausteine – bewusst lange, eindeutige Formen, damit normale
 * Wörter nicht mitgefangen werden. Kann jederzeit ergänzt werden.
 */
const BLOCKED = [
  // --- Vulgär / Beleidigungen (deutsch) ---
  'arschloch', 'arschficker', 'wichser', 'wixer', 'hurensohn', 'hurentochter',
  'fotze', 'moese', 'muschi', 'schlampe', 'nutte', 'bastard', 'missgeburt',
  'schwuchtel', 'spast', 'spasti', 'mongo', 'behindi', 'kanacke', 'kanake',
  'untermensch', 'judensau', 'schweinehund', 'drecksau', 'pissnelke',
  'ficken', 'ficker', 'gefickt', 'fickfresse', 'votze', 'penner',
  // --- Vulgär / Beleidigungen (englisch) ---
  'fuck', 'motherfucker', 'asshole', 'bitch', 'bastard', 'cunt', 'whore',
  'slut', 'dickhead', 'cocksucker', 'blowjob', 'handjob', 'bukkake',
  'pedophile', 'paedophile', 'childporn', 'rapist', 'rapeher', 'raping',
  'penis', 'vagina', 'dildo', 'anus', 'anal', 'porn', 'incest',
  // --- Rassistisch / menschenverachtend ---
  'nigger', 'nigga', 'negerkopf', 'kike', 'chink', 'gook', 'spic',
  'whitepower', 'whitepride', 'racewar', 'gaskammer', 'gasthejews',
  'holocaust', 'auschwitz', 'buchenwald', 'sobibor', 'treblinka',
  // --- Nationalsozialismus / Extremismus ---
  'hitler', 'adolfhitler', 'heilhitler', 'siegheil', 'hakenkreuz', 'swastika',
  'hakenkreuze', 'drittesreich', 'thirdreich', 'nsdap', 'gestapo', 'waffenss',
  'goebbels', 'himmler', 'eichmann', 'mengele', 'hoess', 'streicher',
  'blutundehre', 'combat18', 'bloodandhonour', 'nationalsozialist',
  'fourteenwords', '14words', '1488', '8814', 'reichsbuerger',
  'kukluxklan', 'kuklux', 'neonazi', 'hitlerjugend',
  // --- Terror / extremistische Organisationen ---
  'islamicstate', 'islamischerstaat', 'alqaida', 'alqaeda', 'binladen',
  'osamabinladen', 'taliban', 'bokoharam', 'hamasterror', 'daesh',
  'atomwaffendivision', 'nsu', 'rechtsterror',
  // --- Massenmörder, Serienmörder, Attentäter ---
  'breivik', 'andersbreivik', 'brentontarrant', 'tarrantbrenton',
  'timothymcveigh', 'mcveigh', 'jeffreydahmer', 'dahmerjeffrey',
  'tedbundy', 'johnwaynegacy', 'charlesmanson', 'zodiackiller',
  'ericharris', 'dylanklebold', 'columbineshooter', 'adamlanza',
  'stephenpaddock', 'dylannroof', 'elliotrodger',
  'josefmengele', 'josefritzl', 'fritzljosef', 'marcduetroux', 'dutroux',
  'fritzhaarmann', 'haarmann', 'peterkuerten', 'unabomber', 'tobiasrathjen',
  'stephanballiet', 'halleattentat',
  // --- Diktatoren mit eindeutig verherrlichendem Bezug ---
  'polpot', 'stalinlives', 'mussolinidux', 'zyklonb'
];

/**
 * Begriffe, die nur gesperrt werden, wenn sie den GANZEN Namen bilden.
 * "Isis" ist auch eine ägyptische Göttin und ein Vorname – als kompletter
 * Gamertag ist der Bezug aber eindeutig.
 */
const BLOCKED_EXACT = ['isis', 'daesh', 'hamas', 'nsu', 'ss', 'hh'];

/* ------------------------------------------------------------------ */
/* Prüfung                                                             */
/* ------------------------------------------------------------------ */

/** Entfernt harmlose Wörter, damit sie keine Treffer auslösen. */
function stripAllowed(text) {
  let out = text;
  for (const word of ALLOWED_WORDS) out = out.split(word).join('');
  return out;
}

/** @returns {string|null} den gefundenen gesperrten Baustein oder null */
export function findBlocked(name) {
  const leet = normalizeName(name);
  const plain = plainName(name);
  const variants = [
    stripAllowed(leet), stripAllowed(squeeze(leet)),
    stripAllowed(plain), stripAllowed(squeeze(plain))
  ];
  for (const stem of BLOCKED) {
    if (variants.some((v) => v.includes(stem))) return stem;
  }
  for (const word of BLOCKED_EXACT) {
    if (variants.some((v) => v === word)) return word;
  }
  return null;
}

/**
 * Prüft einen Gamertag vollständig.
 * @returns {{ok: true, value: string} | {ok: false, message: string}}
 */
export function validateGamertag(raw) {
  const value = String(raw ?? '').replace(/\s+/g, ' ').trim();

  if (value.length < MIN_LENGTH) {
    return { ok: false, message: `Der Gamertag braucht mindestens ${MIN_LENGTH} Zeichen.` };
  }
  if (value.length > MAX_LENGTH) {
    return { ok: false, message: `Höchstens ${MAX_LENGTH} Zeichen – deiner hat ${value.length}.` };
  }
  if (!ALLOWED.test(value)) {
    return { ok: false, message: 'Dieser Gamertag enthält nicht erlaubte Zeichen.' };
  }
  if (!/[\p{L}\p{N}]/u.test(value)) {
    return { ok: false, message: 'Der Gamertag braucht mindestens einen Buchstaben oder eine Zahl.' };
  }
  if (findBlocked(value)) {
    return { ok: false, message: 'Dieser Gamertag ist nicht zulässig. Bitte wähle einen anderen Namen.' };
  }
  return { ok: true, value };
}

/** Vergleichsform für die Eindeutigkeit: "Max Muster" und "max  muster" sind gleich. */
export const gamertagKey = (name) => String(name).replace(/\s+/g, ' ').trim().toLowerCase();
