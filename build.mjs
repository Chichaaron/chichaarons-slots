/**
 * Baut aus dem modularen Projekt eine einzelne, komplett eigenständige
 * HTML-Datei (dist/standalone.html) – praktisch zum Verschicken oder zum
 * Öffnen per Doppelklick, ohne lokalen Server.
 *
 * Ausführen:  node build/build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// Reihenfolge = Abhängigkeitsreihenfolge (config zuerst, app zuletzt)
const MODULES = [
  'js/config.js', 'js/roulette.js', 'js/storage.js', 'js/bets.js',
  'js/table.js', 'js/wheel.js', 'js/sound.js', 'js/ui.js', 'js/app.js'
];

/** Entfernt statische import-/export-Schlüsselwörter für die Bündelung. */
function stripModuleSyntax(code) {
  return code
    // "import { a, b } from './x.js';"  (auch mehrzeilig) – dynamische
    // import() bleiben erhalten, weil sie nie am Zeilenanfang stehen.
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]*['"];?[ \t]*$/gm, '')
    .replace(/^export\s+(const|let|var|async function|function|class)/gm, '$1');
}

const bundle = MODULES
  .map((file) => `/* ===== ${file} ===== */\n${stripModuleSyntax(read(file))}`)
  .join('\n');

const css = read('css/style.css');
let html = read('index.html');

// Ersetzungen als Funktion übergeben: sonst würde String.replace "$$" im
// Quelltext (z. B. die Hilfsfunktion $$) als Sonderzeichen interpretieren.
html = html.replace(
  /<link rel="stylesheet" href="css\/style\.css" \/>/,
  () => `<style>\n${css}\n</style>`
);
html = html.replace(
  /<script type="module" src="js\/app\.js"><\/script>/,
  () => `<script>\n(function () {\n'use strict';\n${bundle}\n})();\n</script>`
);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/standalone.html'), html);

// Variante ohne <!doctype>/<html>/<head>/<body> (für Hosts, die eine
// Seiten-Hülle selbst ergänzen)
const inner = html
  .replace(/^[\s\S]*?<body>/, '')
  .replace(/<\/body>[\s\S]*$/, '')
  .trim();
const headBits = [
  '<title>Grand Vert — Roulette</title>',
  `<style>\n${css}\n</style>`
].join('\n');
writeFileSync(join(root, 'dist/embed.html'), `${headBits}\n${inner}\n`);

const kb = (p) => (readFileSync(join(root, p)).length / 1024).toFixed(0);
console.log(`dist/standalone.html  ${kb('dist/standalone.html')} KB`);
console.log(`dist/embed.html       ${kb('dist/embed.html')} KB`);
