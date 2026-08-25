# Grand Vert — Roulette

Europäisches Roulette mit **virtuellem Spielgeld**. Account-System, dauerhaft
gespeicherter Spielstand, korrekte Auszahlungsregeln und eine Rad-Animation, die
immer genau das vorher ausgewürfelte Ergebnis darstellt.

Kein Echtgeld, keine Einzahlungen, keine Werbung, kein Tracking, keine externen
Schriftarten oder CDNs.

---

## Schnellstart

Das Projekt nutzt ES-Module. Die müssen über einen Server geladen werden – ein
Doppelklick auf `index.html` reicht **nicht**.

```bash
cd grand-vert-roulette
python3 -m http.server 8080     # oder: npx serve .
```

Dann `http://localhost:8080` öffnen.

Wer nur schnell reinschauen will: `dist/standalone.html` ist eine einzelne Datei
mit allem drin und lässt sich direkt per Doppelklick öffnen.

---

## Veröffentlichen auf GitHub Pages

1. Repository auf GitHub anlegen und den Inhalt dieses Ordners hochladen:

   ```bash
   git init
   git add .
   git commit -m "Grand Vert Roulette"
   git branch -M main
   git remote add origin https://github.com/DEIN-NAME/DEIN-REPO.git
   git push -u origin main
   ```

2. Im Repository auf **Settings → Pages** gehen.
3. Bei *Source* **Deploy from a branch** wählen, Branch `main`, Ordner `/ (root)`.
4. Nach ein bis zwei Minuten läuft die Seite unter
   `https://DEIN-NAME.github.io/DEIN-REPO/`.

Die Datei `.nojekyll` liegt bereits im Projekt, damit GitHub die Dateien
unverändert ausliefert.

---

## Konten & Spielstand

Das Spiel bringt zwei austauschbare Backends mit. Umgeschaltet wird allein über
`js/config.js` – im Code muss nichts geändert werden.

### Standard: lokale Konten

Ohne Konfiguration liegen Konto und Spielstand im `localStorage` des Browsers.
Passwörter werden mit **PBKDF2-SHA256** (zufälliges Salt, 210.000 Iterationen)
gehasht, niemals im Klartext gespeichert.

Praktisch zum Ausprobieren, aber der Spielstand hängt an genau diesem Browser
auf genau diesem Gerät.

### Empfohlen: Supabase

Damit derselbe Account auf jedem Gerät funktioniert:

1. Auf [supabase.com](https://supabase.com) ein kostenloses Projekt anlegen.
2. Im **SQL Editor** den kompletten Inhalt von `supabase/schema.sql` ausführen.
   Das legt an:
   * Tabelle `profiles` (Guthaben, Statistik, Rundenverlauf)
   * Row-Level-Security: jeder sieht ausschließlich seinen eigenen Spielstand
   * einen Trigger, der neuen Konten automatisch 2.000 € gutschreibt
   * die Funktion `delete_own_account()` für die Konto-Löschung
3. Unter **Project Settings → API** die *Project URL* und den *anon public* Key
   kopieren und in `js/config.js` eintragen:

   ```js
   export const SUPABASE_CONFIG = {
     url: 'https://xxxxxxxxxxxx.supabase.co',
     anonKey: 'eyJhbGciOi...'
   };
   ```

4. Optional unter **Authentication → Providers → Email** die
   E-Mail-Bestätigung abschalten, wenn man sich sofort nach der Registrierung
   anmelden können soll.

Der anon-Key darf öffentlich im Repository stehen – er ist dafür gemacht. Die
eigentliche Absicherung passiert über die Row-Level-Security-Regeln aus dem
SQL-Skript. Der **service_role**-Key gehört dagegen niemals ins Frontend.

Ist Supabase konfiguriert, aber gerade nicht erreichbar, fällt das Spiel
automatisch auf lokale Konten zurück, statt gar nicht zu starten.

---

## Spielablauf

1. **Startmenü** — Spielen, Shop (Platzhalter), Einstellungen.
2. **Setzen** — Jeton wählen (1 € bis 200 € oder eigener Betrag), dann Felder
   anklicken. Rechtsklick nimmt einen Jeton wieder weg. Der Einsatz wird sofort
   vom Guthaben abgezogen; mehr als vorhanden ist, kann nie gesetzt werden.
3. **LET IT RIDE** — die Gewinnzahl wird per `crypto.getRandomValues()`
   bestimmt, *bevor* die Animation startet. Danach wird der Tisch gesperrt.
4. **Animation** — das Brett fährt zur Seite, das Rad in die Mitte, die Kugel
   läuft gegenläufig aus und landet exakt in der Tasche der bereits
   feststehenden Zahl.
5. **Auswertung** — Ergebnis pro Wette (grün/rot), Gesamtergebnis der Runde,
   neues Guthaben. Danach wird der Spielstand gespeichert.

### Auszahlungen

| Wette | Quote | Rückzahlung bei Treffer |
| --- | --- | --- |
| Einzelzahl (0–36) | 35:1 | Einsatz × 36 |
| Rot / Schwarz | 1:1 | Einsatz × 2 |
| Gerade / Ungerade | 1:1 | Einsatz × 2 |
| 1–18 / 19–36 | 1:1 | Einsatz × 2 |
| 1st 12 / 2nd 12 / 3rd 12 | 2:1 | Einsatz × 3 |
| 2 to 1 (Kolonne) | 2:1 | Einsatz × 3 |

Bei der 0 verlieren alle Außenwetten – daraus ergibt sich der Hausvorteil von
2,70 % (1/37), der in den Tests für jede Wettart nachgerechnet wird.

---

## Projektstruktur

```
index.html            Alle Bildschirme (Login, Menü, Spiel, Shop, Einstellungen, Datenschutz)
css/style.css         Komplettes Design, dunkelgrün/schwarz/rot mit Gold-Akzenten
js/
  config.js           Supabase-Zugang, Startguthaben, Jeton-Werte
  roulette.js         Radreihenfolge, Farben, Zufallssystem, Wettarten, Auszahlungen
  storage.js          Konten & Spielstand (lokal oder Supabase) hinter einer API
  bets.js             Einsätze der laufenden Runde, Rückgängig/Löschen/Wiederholen
  table.js            Aufbau des Roulette-Bretts, Jetons auf den Feldern
  wheel.js            Canvas-Rad und Kugelanimation
  sound.js            Kurze Klänge über die Web Audio API (abschaltbar)
  ui.js               Bildschirmwechsel, Einsatzübersicht, Auswertung, Dialoge
  app.js              Rundenablauf und Verdrahtung
supabase/schema.sql   Tabellen, RLS-Policies, Trigger, Löschfunktion
build/build.mjs       Baut dist/standalone.html (eine einzige Datei)
tests/                Logik-Tests (Node) und End-to-End-Test (Browser)
```

---

## Tests

```bash
npm test                       # Auszahlungen, Zufallsverteilung, Guthabenführung
node build/build.mjs           # Einzeldatei-Build erzeugen
python3 tests/e2e.py           # Browser-Durchlauf (benötigt Playwright + laufenden Server)
```

Die Logik-Tests prüfen unter anderem:

* alle 37 Zahlen kommen genau einmal auf dem Rad vor, 18 rot / 18 schwarz
* jede Wettart hat exakt den Hausvorteil 1/37
* Chi-Quadrat-Test über 370.000 Würfe auf Gleichverteilung
* 200.000 simulierte Runden ohne negatives Guthaben oder Rundungsfehler

Der Browser-Test spielt eine komplette Runde durch und prüft zusätzlich, dass
die Kugel physisch in der Tasche der vorher bestimmten Zahl liegt (Winkel-
abweichung < 1e-9 rad) und dass der Spielstand ein Neuladen und ein Ab- und
Anmelden übersteht.

---

## Datenschutz

* Nur virtuelles Spielgeld – keine Einzahlung, keine Auszahlung, kein Kauf.
* Keine Werbung, keine Analyse-Dienste, keine Tracking-Cookies.
* Keine Google Fonts oder sonstige CDNs; das Supabase-SDK wird ausschließlich
  geladen, wenn Supabase auch konfiguriert ist.
* Gespeichert werden nur: Zugangsdaten (Passwort gehasht), Guthaben,
  Spielstatistik und die letzten 50 Runden.
* Unter *Einstellungen* kann man seine Daten exportieren und das Konto
  vollständig löschen.
* Die Datenschutzseite ist im Spiel unter *Datenschutz* erreichbar.

---

## Bekannte Grenzen

* **Der Spielstand wird im Browser berechnet.** Wer die Entwicklerkonsole
  öffnet, kann sein eigenes virtuelles Guthaben manipulieren. Für ein reines
  Spielgeld-Projekt ist das in Ordnung; wenn Ergebnisse manipulationssicher sein
  müssten (z. B. für eine Bestenliste), müsste das Ziehen der Zahl und die
  Auszahlung in eine Supabase Edge Function wandern und die `profiles`-Tabelle
  für direkte Schreibzugriffe gesperrt werden.
* Split-, Street- und Corner-Wetten (Einsätze auf Feldkanten) sind bewusst nicht
  umgesetzt – gesetzt wird auf Einzelzahlen und die klassischen Außenwetten.
* Shop und Jeton-Designs sind Platzhalter.

---

## Lizenz

MIT
