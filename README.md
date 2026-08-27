# Chichaarons Slots

Kleine Spieleplattform mit **virtuellem Spielgeld**: Spielauswahl, Roulette,
Design-Shop und täglicher Bonus. Account-System, dauerhaft gespeicherter
Spielstand, korrekte Auszahlungsregeln und eine Rad-Animation, die immer genau
das vorher ausgewürfelte Ergebnis darstellt.

Navigation: **Hauptmenü → Spielen → Minigame-Auswahl → Spiel**

Kein Echtgeld, keine Einzahlungen, keine Werbung, kein Tracking, keine externen
Schriftarten oder CDNs.

---

## Schnellstart

Das Projekt nutzt ES-Module. Die müssen über einen Server geladen werden – ein
Doppelklick auf `index.html` reicht **nicht**.

```bash
cd chichaarons-slots
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
   git commit -m "Chichaarons Slots"
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

## Aufbau der Plattform

| Bereich | Was passiert dort |
| --- | --- |
| Hauptmenü | Guthaben, Einstieg in Spielen / Shop / Einstellungen |
| Spielauswahl | Karten aller Minigames, Platzhalter für kommende Spiele |
| Roulette | Kessel, Einsätze, Rad; „‹ Spiele" führt zurück zur Auswahl |
| Mines | Feld aufdecken, Multiplikator steigt, jederzeit auszahlen |
| Blackjack | bis zu drei Hände gegen den Dealer, 6-Deck-Schuh |
| Crash | die Kurve steigt, rechtzeitig auszahlen |
| Plinko | Kugeln fallen durch 16 Reihen Stifte in 17 Multiplikatorfelder |
| Shop | Boni inklusive Notfallguthaben und die kaufbaren Designs |
| Einstellungen | Gamertag, Sound, Lautstärke, Kartengeschwindigkeit, Tempo, Datenexport, Konto löschen |

### Mines

Feldgröße (4×4 bis 7×7), Minenzahl und Einsatz wählen, dann Felder aufdecken.
Jedes sichere Feld erhöht den Multiplikator, eine Mine beendet die Runde.

Der Multiplikator ist nicht geschätzt, sondern hergeleitet. Die Chance, `k`
Felder hintereinander zu überleben, ist `C(sicher, k) / C(gesamt, k)`; der faire
Multiplikator ist der Kehrwert davon. Darauf liegt eine Quote, die mit jedem
weiteren Feld steigt:

```
rtpAt(1) = 0,845        →        rtpAt(∞) → 0,97
```

Daraus folgt direkt: Wer nach genau `k` Feldern auszahlt, bekommt langfristig
`rtpAt(k)` seines Einsatzes zurück – bei einem Feld also nur 84,5 %. **Ein
"immer ein Feld, dann Cash-Out" ist damit rechnerisch ein sicherer Verlust**,
unabhängig von Feldgröße und Minenzahl. Wer weiter geht, spielt gegen einen
kleineren Hausvorteil, trägt dafür aber das echte Risiko.

Beispiel 4×4 mit einer Mine: `0,90× → 1,00× → 1,11× → 1,22× → 1,35×`.
Mit fünf Minen auf demselben Feld: `1,23× → 1,91× → 3,05×`.
Wenig Risiko heißt also langsamer Anstieg, viel Risiko schneller Anstieg – und
das ergibt sich aus der Formel, nicht aus einer Tabelle.

Weitere Regeln:

* Die Minen werden beim Rundenstart einmal kryptografisch verteilt und ändern
  sich während der Runde nicht.
* Der Einsatz wird beim Start abgebucht **und sofort gespeichert**. Ein Neuladen
  kann eine laufende Runde also nicht rückgängig machen; wer mittendrin geht,
  verliert den Einsatz (es kommt vorher eine Rückfrage).
* Sind alle sicheren Felder gefunden, wird automatisch ausgezahlt.
* Es bleibt immer mindestens ein sicheres Feld übrig (`Minen ≤ Felder − 1`).

### Blackjack

Amerikanisches Blackjack mit sechs Decks. Jeton wählen, auf einen der drei
Plätze tippen (mehrfach tippen stapelt den Einsatz), dann **GEBEN**.

Regelwerk – im ganzen Spiel einheitlich, nachlesbar im Kopf von
`js/blackjack-rules.js`:

* 6 Decks in einem sichtbaren Schuh, Cut Card bei etwa der Hälfte; das
  Neumischen zwischen zwei Runden wird angezeigt und angekündigt.
* Der Dealer zieht bis 16 und bleibt ab 17 stehen – **auch bei weicher 17**
  (S17). Bei Ass oder Zehnerkarte prüft er sofort auf Blackjack.
* **Blackjack zahlt 2,5×** (also 3:2), normaler Gewinn 2,0×, Unentschieden
  gibt den Einsatz zurück. Alle Beträge sind ganze Euro.
* **Verdoppeln** auf die ersten beiden Karten, danach genau eine Karte
  (sie wird quer gelegt). Vorher fragt das Spiel, ob diese Karte **offen**
  oder **verdeckt** liegen soll – siehe unten.
* **Teilen** entscheidet der **Kartenwert**, nicht der Kartenname: Bube, Dame
  und König zählen alle 10, also sind K + D, B + K, D + B und 10 + K gültige
  Paare (`canSplitPair` vergleicht `cardValue`). Geteilte Asse bekommen genau
  eine Karte. Geteilte Hände können erneut geteilt werden, bis die Grenze von
  **drei Händen** erreicht ist. Diese Grenze gilt hart: Startplätze und Splits
  zusammen sind nie mehr als drei. Ist Teilen gerade nicht möglich, sagt der
  Knopf per Hinweistext, woran es liegt (Handgrenze oder fehlendes Guthaben).
* Nach einem Split ist Ass + Zehn **kein** Blackjack, sondern eine normale 21.
* Der Gesamteinsatz wird beim Geben abgebucht **und sofort gespeichert** –
  ein Neuladen macht die Runde nicht rückgängig. Wer mittendrin geht,
  verliert die Einsätze (es kommt vorher eine Rückfrage).
* Die Einsätze bleiben nach der Runde auf den Plätzen liegen, solange das
  Guthaben reicht.

#### Verdoppeln: offen oder verdeckt

Nach dem Klick auf VERDOPPELN erscheint die Auswahl **OFFEN / VERDECKT**.
Erst danach wird der Einsatz verdoppelt und genau eine Karte gegeben.

Wichtig: Die Karte wird in beiden Fällen **im selben Moment gezogen** und
steht damit fest. „Verdeckt" ist ausschließlich eine Darstellungsoption – die
Karte liegt bereits in `hand.cards`, lediglich ihr Index steht zusätzlich in
`hand.hidden` und das Kartenelement trägt `.is-down`. Der Handwert zeigt
solange `13 + ?` statt der Summe. Aufgedeckt wird beim Dealerzug, bevor der
Dealer zieht; dabei wird nichts neu bestimmt.

#### Kartengeschwindigkeit

Vier Stufen in den Einstellungen (`CARD_SPEEDS` in `js/blackjack.js`):

| Stufe | Pause je Karte | Flug | Umdrehen |
| --- | --- | --- | --- |
| LANGSAM | 760 ms | 700 ms | 900 ms |
| MITTEL (Standard) | 500 ms | 480 ms | 700 ms |
| SCHNELL | 300 ms | 300 ms | 480 ms |
| EXTREM SCHNELL | 150 ms | 170 ms | 300 ms |

`MIN_FLIP_MS = 300` ist die Untergrenze: Auch die schnellste Stufe dreht die
Karte noch sichtbar um, sie springt nie einfach um.

Die Stufe wird in den lokalen Einstellungen gespeichert und übersteht das
Schließen der Seite. Sie setzt nur `--bj-move-ms` / `--bj-flip-ms` am
Bildschirm und die Wartezeiten zwischen den Karten. **Auf das Ergebnis hat
sie keinen Einfluss**: `shoe.draw()` läuft immer vor der Animation, die
Reihenfolge im Schuh steht seit dem Mischen fest.

#### Umdrehen

Eine verdeckte Karte steckt von Anfang an vollständig im DOM: `.bj-card-inner`
steht auf `rotateY(180deg)`, Vorder- und Rückseite haben
`backface-visibility: hidden`. `flipCardElement()` nimmt nur `is-down` weg –
CSS dreht die Karte dann über `--bj-flip-ms` zurück auf 0°. Das Kartenbild
wird dabei nie ausgetauscht, es war nur weggedreht.

Damit das nach einer echten Karte aussieht:

* Der Fluchtpunkt hängt an der Kartenbreite (`perspective: --card-w · 3,2`) –
  ein fester Wert wie 900 px wirkt bei einer 90 px breiten Karte fast wie eine
  Parallelprojektion, die Karte würde nur schmaler statt räumlich.
* Für die Dauer der Drehung trägt die Karte `is-flipping`: sie hebt sich
  leicht an und ein feiner Lichtstreifen wandert über sie hinweg.
* Der Dealer zieht erst weiter, wenn seine verdeckte Karte fertig gedreht ist
  (`revealHole()` wartet `flip · 1,05`). Dasselbe gilt für verdeckt gelegte
  Double-Down-Karten.

#### Karten

Die Karten sind Inline-SVG (`js/cards.js`). Die vier Farbzeichen sind echte
**Vektorpfade**, keine Schriftzeichen – dadurch sehen sie auf jedem Gerät
gleich aus und bleiben bei jeder Größe scharf. Die Farben kommen aus den
`--card-…` Tokens; jedes Design bringt eigene mit, inklusive Kartenrücken.
Es werden keine Bilddateien geladen.

Passen die Karten einer Hand nicht mehr nebeneinander, werden sie über
`--n` gleichmäßig kleiner, statt in die Nachbarhand zu ragen. Auf dem
Smartphone stehen die Hände untereinander statt nebeneinander.

Der Hausvorteil entsteht allein aus den Regeln (der Spieler geht zuerst und
verliert bei Überkaufen sofort). In der Simulation über 300.000 Hände liegt
die Auszahlungsquote bei rund 94 % für eine einfache „ziehen bis 17"-Strategie.

### Crash

Einsatz wählen, **SPIELEN**, und der Multiplikator klettert los. Wer vor dem
Absturz auf **AUSZAHLEN** drückt, bekommt `Einsatz × Multiplikator`.

**Nach dem Auszahlen läuft die Runde weiter.** Der Gewinn ist sofort gebucht
und ändert sich nicht mehr, aber Kurve und Multiplikator laufen bis zum
vorher bestimmten Crash-Punkt weiter – man sieht also, wie weit es noch
gegangen wäre. Währenddessen ist ein zweites Auszahlen ausgeschlossen
(`cashedAt` ist gesetzt) und es lässt sich keine neue Runde starten
(`canStart()` verlangt `phase !== 'running'`). Erst der Crash schließt die
Runde ab und trägt sie in Statistik und Verlauf ein.

**Der Crash-Punkt steht fest, bevor die Animation startet.** `drawCrashPoint()`
zieht ihn beim Rundenstart, `timeForMultiplier()` rechnet ihn in einen
Zeitpunkt um; die Animation läuft danach nur noch bis genau dorthin. Die
Darstellung kann das Ergebnis also nicht beeinflussen – und wer zu spät
klickt, kommt nicht mehr durch (`cashOut()` prüft die verstrichene Zeit erneut).

#### Verteilung der Crash-Punkte

```
crash = (1 − HOUSE_EDGE) / (1 − u)        u gleichverteilt in [0, 1)
```

Daraus folgt exakt `P(Crash ≥ x) = (1 − HOUSE_EDGE) / x`. Zwei Konsequenzen:

* Niedrige Werte sind sehr viel häufiger als hohe – die Verteilung fällt mit
  `1/x`, nicht linear.
* **Jedes Ausstiegsziel zahlt langfristig dasselbe**, nämlich 97 %:
  `x · (1 − HOUSE_EDGE)/x`. Sofort bei 1,01× auszusteigen ist damit kein
  Freifahrtschein – Tests prüfen das für 1,01× bis 100×.

| Bereich | Häufigkeit |
| --- | --- |
| genau 1,00× (Sofort-Crash) | ~4 % |
| unter 2,00× | ~51 % |
| 2× bis 5× | ~29 % |
| 5× bis 10× | ~9,7 % |
| 10× bis 100× | ~8,7 % |
| 100× bis 1.000× | ~0,9 % |
| 1.000× bis 10.000× | ~0,09 % |
| 10.000× bis 50.000× | ~0,008 % |
| genau 50.000× (Obergrenze) | ~0,002 % (etwa 1 von 51.500) |

**1,00× ist möglich** – die Runde kann sofort enden. **50.000× ist möglich** –
nur eben außergewöhnlich selten.

#### Kurve

```
m(t) = e^(A · t^P)        A = 0,1286   P = 1,12
```

Der Exponent über 1 sorgt dafür, dass nicht nur der Multiplikator, sondern
auch seine Steigerungsrate mit der Zeit wächst. 2× nach etwa 4,5 s, 10× nach
14,5 s, 100× nach 24 s, 50.000× nach 52 s.

Der Graph liegt auf einem Canvas (`createCrashGraph`), holt seine Farben aus
den `--crash-…` Tokens und skaliert beide Achsen automatisch mit, damit auch
hohe Multiplikatoren im Bild bleiben.

### Plinko

Einsatz und Schwierigkeit wählen, **KUGEL STARTEN** – die Kugel fällt durch
16 Reihen Stifte, wird an jedem Stift nach links oder rechts abgelenkt und
landet in einem von 17 Multiplikatorfeldern.

**Es gibt keine Wartezeit.** Der Startknopf sperrt nie, solange das Guthaben
reicht; beliebig viele Kugeln dürfen gleichzeitig fallen. Jede Kugel ist ein
eigenes Spiel mit eigener Nummer: genau einmal abbuchen, genau einmal
auszahlen (`ball.paid`). Kugeln beeinflussen einander nie.

**Der Weg steht fest, bevor die Animation beginnt.** `drawPath()` zieht
16 kryptografische Bits; `slotOfPath()` zählt die Rechts-Ablenkungen. Damit ist
das Feld bereits beim Start bekannt und liegt zwangsläufig zwischen 0 und 16 –
die Kugel kann gar nicht daneben landen, und die Auszahlung ist immer exakt
`Einsatz × Multiplikator`, abgerundet auf volle Euro.

#### Wahrscheinlichkeiten und Multiplikatoren

16 faire Münzwürfe ergeben die Binomialverteilung:

| Feld (von der Mitte) | Mitte | ±1 | ±2 | ±3 | ±4 | ±5 | ±6 | ±7 | außen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Häufigkeit | 19,6 % | 17,5 % | 12,2 % | 6,7 % | 2,8 % | 0,85 % | 0,18 % | 0,024 % | 0,0015 % |

Danach richten sich die vier Stufen (Werte von außen zur Mitte, gespiegelt):

| Stufe | Multiplikatoren | Quote |
| --- | --- | --- |
| LEICHT | 16 · 9 · 2 · 1,4 · 1,4 · 1,2 · 1,1 · 1 · 0,4 | 97,0 % |
| MITTEL | 110 · 41 · 10 · 5 · 3 · 1,5 · 1 · 0,5 · 0,2 | 97,0 % |
| SCHWER | 1.000 · 130 · 26 · 9 · 4 · 2 · 0,2 · 0,2 · 0,1 | 97,0 % |
| EXTREM | 10.000 · 170 · 25 · 7 · 3 · 0,5 · 0,2 · 0,2 · 0,1 | 97,1 % |

Je wahrscheinlicher ein Feld, desto kleiner sein Multiplikator – ein Test prüft
das für jede Stufe. Alle vier liegen bei rund 97 %, genau wie Roulette,
Blackjack, Crash und Mines. Keine Stufe ist also besser, sie unterscheiden sich
nur im Risiko.

#### Feste Pyramide

Reihe `r` hat `r + 3` Stifte im Abstand `s` – Reihe 0 also 3, Reihe 15 genau 18.
18 Stifte lassen 17 Lücken, das sind die 17 Felder. Diese Struktur ist fest
verdrahtet (`pinsInRow`, `pinX`, `rowY`) und wird **nie** zufällig erzeugt: Bei
gleicher Fläche kommen immer exakt dieselben Positionen heraus, auf dem Handy
wird dasselbe Muster nur proportional kleiner. Die Schwierigkeit ändert
ausschließlich die Multiplikatoren unten, nie die Stifte.

`plinkoGeometry(breite, höhe)` rechnet alle Maße aus der Fläche und ist ohne
DOM testbar. Nach jeder Größenänderung wird sofort neu gezeichnet – `canvas.width`
zu setzen löscht das Bild, ohne dieses Zeichnen wäre das Brett danach leer.
Die Multiplikatorleiste im DOM bekommt denselben Seitenrand (`--plinko-pad`)
und liegt dadurch exakt unter den Rutschen.

#### Bewegung: echte Kollisionen

Die Kugel wird Schritt für Schritt gerechnet (fester Zeitschritt 1/240 s):
Schwerkraft, Geschwindigkeit, Kollisionsradius `hitR = Stift + Kugel`,
Abprall mit Dämpfung (`RESTITUTION`) und Reibung entlang der Oberfläche
(`TANGENT_LOSS`). Bei jeder Berührung wird die Kugel exakt auf die
Stiftoberfläche gesetzt – sie kann nicht im Stift stecken bleiben, nicht
hindurchlaufen und nicht auf der anderen Seite auftauchen.

Damit das Ergebnis trotzdem exakt dem vorher gezogenen Weg entspricht, wird an
der jeweils fälligen Reihe die *Auftreffseite* auf die vorbestimmte Schulter
gedreht – aber nur so weit wie nötig (`CONTACT_MIN`, etwa 18°). Liegt die Kugel
ohnehin schon richtig, bleibt die echte Normale stehen. Eine sanfte Führung
(`GUIDE`) hält sie auf der Spur, ein seitlicher Mindestimpuls (`SIDE_KICK`)
macht den Abprall sichtbar. Sichtbar ist dadurch immer:
**fallen → auftreffen → abprallen → zur Seite → weiterfallen**.

Ein kompletter Fall dauert rund drei Sekunden. Tests prüfen über tausende
Läufe und acht Bildschirmgrößen: jede Kugel berührt alle 16 Stifte, keine
steckt je in einem Stift, und jede landet im vorher gezogenen Feld.

Stifte, Kugeln und Farben liegen auf einem Canvas und kommen aus den
`--plinko-…` Tokens des aktiven Designs.

Beim Verlassen des Bildschirms und beim Schließen der Seite werden fliegende
Kugeln sofort abgerechnet – es kann kein Gewinn verloren gehen. Ändert sich
die Fenstergröße mitten im Fall, werden laufende Kugeln maßstabsgerecht
mitgerechnet.

### Ein neues Minigame ergänzen

Alles Nötige steht in `js/catalog.js`:

```js
export const GAMES = [
  …,
  {
    id: 'blackjack',
    title: 'Blackjack',
    tagline: 'Näher an 21 als der Croupier.',
    facts: ['1 Spieler', 'Auszahlung 3:2'],
    available: true,          // false => graue Platzhalter-Karte
    screen: 'blackjack'       // id des <section class="screen" id="screen-blackjack">
  }
];
```

Karte, Hover-Effekt und Navigation entstehen daraus automatisch. Zu bauen bleibt
nur der Bildschirm selbst.

### Ein neues Design ergänzen

Zwei Schritte:

1. Eintrag in `THEMES` in `js/catalog.js` (id, Name, Preis, Beschreibung, drei Farbtupfer)
2. Block `:root[data-theme="<id>"] { … }` in `css/style.css` mit denselben Tokens
   wie die vorhandenen Themes

Das gesamte Erscheinungsbild – Menü, Spielauswahl, Shop, Roulettetisch und sogar
die Farben des Rades – ergibt sich aus diesen Tokens. Kein Bauteil kennt eine
feste Farbe.

Für die Sichtbarkeit klickbarer Elemente gibt es eigene Tokens, die jedes Theme
setzen muss: `--edge` (Rand im Ruhezustand), `--edge-hi` (Hover/aktiv),
`--edge-glow` (weicher Schein), `--edge-top` (Lichtkante) und `--press`
(Schatten im gedrückten Zustand). Buttons, Menükarten, Spielkarten,
Design-Karten, Jetons und die Felder des Tischs greifen alle darauf zu.

### Gamertag

Jeder Spieler vergibt sich in den Einstellungen einen Namen (3–22 Zeichen,
Buchstaben, Zahlen, Leerzeichen und übliche Sonderzeichen). Im Hauptmenü steht
danach nur noch dieser Name – die E-Mail-Adresse taucht dort nicht mehr auf.

Der Filter in `js/gamertag.js` arbeitet in Stufen statt mit einer stumpfen
Wortliste: Der Name wird kleingeschrieben, von Akzenten befreit, Leetspeak wird
aufgelöst (`H1-T.L.E.R` → `hitler`), Trennzeichen fallen weg und
Zeichenwiederholungen werden zusätzlich eingedampft (`hiiitler` → `hitler`).
Erst danach wird gegen die Blockliste geprüft. Harmlose Wörter, die zufällig
einen Baustein enthalten (`Analyse`, `Fickle`, `Kanal`), stehen in einer
Ausnahmeliste und werden vorher herausgerechnet. Beide Listen lassen sich
jederzeit ergänzen.

Die Eindeutigkeit sichert ein UNIQUE-Index über `lower(gamertag)` in der
Datenbank – zwei gleichzeitige Anfragen können denselben Namen dadurch nicht
beide bekommen.

### Designs und Boni

| Design | Preis | Stil |
| --- | ---: | --- |
| Classic Green | — | Standard, tiefes Grün mit Gold |
| Noir | 15.000 € | Schwarz mit Platinakzenten |
| Royal Bordeaux | 30.000 € | Weinrot mit Messing |
| Platinum | 75.000 € | Kühles Weiß, Grau und Graphit, keine Buntfarbe |
| Ivory & Gold | 100.000 € | Elfenbein mit kräftigem Altgold |

Gekaufte Designs gehören dauerhaft zum Konto und werden nie doppelt bezahlt.

Im Shop gibt es fünf Boni:

| Bonus | Betrag | Zyklus |
| --- | ---: | --- |
| Starter-Bonus | 150.000 € | **einmalig pro Konto** |
| Notfallguthaben | 500 € | nur bei genau 0 € Guthaben |
| Tagesbonus | 10.000 € | täglich 00:00 Uhr (GMT+2) |
| Zeitbonus | 2.000 € | 4 Stunden nach der letzten Abholung |
| Wochenbonus | 25.000 € | montags 00:00 Uhr (GMT+2) |

Der **Starter-Bonus** ist als `once: true` in `js/bonus.js` markiert. Sobald
`bonus_starter` in der Datenbank gesetzt ist, meldet `bonusStatus()` ihn als
`done` – `renderBonusCards()` baut das Kartenfeld dann ohne ihn neu auf, die
Karte ist also wirklich weg und nicht nur ausgegraut. Serverseitig lässt
`claim_bonus('starter')` ihn nur zu, solange `bonus_starter IS NULL` ist,
geprüft unter Zeilensperre – zwei gleichzeitige Anfragen ergeben deshalb
150.000 €, nie 300.000 €.

Prüfen, Gutschreiben und Markieren passiert in **einer** Datenbankfunktion
(`claim_bonus`) mit Zeilensperre. Maßgeblich ist immer `now()` auf dem Server –
eine verstellte Uhr, ein Neuladen oder ein Gerätewechsel ändern daran nichts,
und schnelles Mehrfachklicken kann denselben Bonus nicht zweimal auslösen.
Der Countdown im Browser rechnet nur mit dem Versatz zur zuletzt gemeldeten
Serverzeit; sobald ein Bonus frei wird, fragt die Seite einmal beim Server nach.

Sobald mindestens ein Bonus bereitsteht, erscheint im Hauptmenü ein kleiner
goldener Punkt am Eintrag *Shop*. Er wird sekündlich neu bestimmt, also auch
während einer laufenden Roulette- oder Mines-Partie.

### Grenzen

| Konstante | Wert | Wo |
| --- | ---: | --- |
| `MAX_BET` | 999.999.999 € pro Feld | `js/bets.js` |
| `MAX_BALANCE` | 999.999.999.999 € | `js/bets.js` |

`MAX_BALANCE` deckelt Gutschriften, damit eine extreme Glückssträhne keinen Wert
erzeugt, den die Datenbankspalte `numeric(14,2)` nicht mehr aufnehmen kann.

## Spielablauf

1. **Startmenü** — Spielen, Shop (Platzhalter), Einstellungen.
2. **Setzen** — Jeton wählen (10 € bis 1.000 €, **MAX** oder ein eigener Betrag),
   dann Felder anklicken. Rechtsklick nimmt einen Jeton wieder weg. Der Einsatz
   wird sofort vom Guthaben abgezogen; mehr als vorhanden ist, kann nie gesetzt
   werden.

   **MAX** setzt immer das Kleinere aus aktuellem Guthaben und dem Einsatzlimit
   `MAX_BET = 999.999.999 €` (in `js/bets.js`). Bei 2.000 € Guthaben setzt MAX
   also 2.000 €, bei 2 Milliarden nur 999.999.999 €. Der Knopf zeigt jederzeit
   an, welcher Betrag das gerade ist.
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
index.html            Alle Bildschirme (Login, Menü, Spielauswahl, Spiel, Shop, Einstellungen, Datenschutz)
css/style.css         Komplettes Design mit fünf Themes (Classic, Noir, Royal, Platinum, Ivory)
                      Markenzeichen: poliertes Pik auf Bordeaux (.brand-mark)
js/
  config.js           Supabase-Zugang, Startguthaben, Jeton-Werte
  catalog.js          Minigames und kaufbare Designs – hier wird erweitert
  roulette.js         Radreihenfolge, Farben, Zufallssystem, Wettarten, Auszahlungen
  storage.js          Konten & Spielstand (lokal oder Supabase) hinter einer API
  bets.js             Einsätze der Runde + MAX_BET / MAX_BALANCE / CHIPS
  gamertag.js         Namensprüfung und Filter
  bonus.js            Bonusarten, Zyklen und Zeitgrenzen (GMT+2)
  mines.js            Minigame Mines: Logik, Wahrscheinlichkeiten, Oberfläche
  cards.js            Spielkarten als SVG (spielunabhängig, theme-fähig)
  crash.js            Minigame Crash: Verteilung, Kurve, Canvas-Graph, Oberfläche
  plinko.js           Minigame Plinko: Multiplikatoren, Wege, Brett, mehrere Kugeln
  blackjack-rules.js  Blackjack: Handwerte, Kartenschuh, Dealerzug, Auswertung
  blackjack.js        Blackjack: Tisch, Animationen, Rundenablauf
  table.js            Aufbau des Roulette-Bretts, Jetons auf den Feldern
  wheel.js            Canvas-Rad und Kugelanimation (Farben kommen aus dem Theme)
  sound.js            Kurze Klänge über die Web Audio API (abschaltbar)
  ui.js               Bildschirmwechsel, Einsatzübersicht, Auswertung, Dialoge
  app.js              Rundenablauf und Verdrahtung
supabase/schema.sql                Tabellen, RLS-Policies, Trigger, Löschfunktion
supabase/update-2-gamertag-bonus.sql  Gamertag-Spalte, Bonus-Spalten und -Funktionen
supabase/update-3-crash-bailout.sql   Notfallguthaben als serverseitiger Bonus
supabase/update-4-starter-bonus.sql   einmaliger Starter-Bonus (150.000 €)
build/build.mjs       Baut dist/standalone.html (eine einzige Datei)
tests/                Logik-Tests (Node) und End-to-End-Tests (Browser)
```

---

## Tests

```bash
npm test                       # Auszahlungen, Zufallsverteilung, Guthabenführung
node build/build.mjs           # Einzeldatei-Build erzeugen
python3 tests/e2e.py           # Runde, Persistenz, Konto (benötigt Playwright + Server)
python3 tests/e2e_extra.py     # Wiederholen, Pleite-Hilfe, Einstellungen, Datenexport
python3 tests/e2e_hub.py       # Spielauswahl, Designkäufe, Themes, 24-Stunden-Bonus
python3 tests/e2e_max.py       # Jeton-Werte, MAX-Einsatz, Einsatzlimit
python3 tests/e2e_mines.py     # Mines: Ablauf, Cash-Out, Verlust, Persistenz
python3 tests/e2e_account.py   # Gamertag, Namensfilter, Boni und Countdowns
python3 tests/e2e_blackjack.py # Blackjack: Geben, Ziehen, Verdoppeln, Teilen, Auszahlung
python3 tests/e2e_crash.py     # Crash: Kurve, Cash-Out, Sofort-Crash, Notfallguthaben
python3 tests/e2e_plinko.py    # Plinko: Pyramide, Abprall, Auszahlungen, viele Kugeln
```

Die Logik-Tests prüfen unter anderem:

* alle 37 Zahlen kommen genau einmal auf dem Rad vor, 18 rot / 18 schwarz
* jede Wettart hat exakt den Hausvorteil 1/37
* Chi-Quadrat-Test über 370.000 Würfe auf Gleichverteilung
* 200.000 simulierte Runden ohne negatives Guthaben oder Rundungsfehler
* Mines: Erwartungswert jedes Cash-Outs exakt `rtpAt(k)`, erstes Feld bei
  sicheren Runden unter 1,00×, Chi-Quadrat auf die Minenverteilung
* Gamertag: gesperrte Namen inklusive Verschleierung, harmlose Namen bleiben frei
* Boni: Tages- und Wochengrenze auf 00:00 GMT+2, Zeitbonus exakt nach 4 Stunden
* Blackjack: vier Tempostufen (jede echt schneller als die vorige),
  Handwerte inklusive Ass-Abstufung, Split nach Kartenwert,
  Dealerzug bei weicher 17, alle vier Auszahlungsfälle, Blackjack nach Split,
  312 Karten ohne Dublette, Chi-Quadrat über 130.000 Züge aus dem Schuh und
  eine Simulation über 300.000 Hände
* Crash: 1,00× und 50.000× sind erreichbar, die Verteilung folgt exakt
  `(1−Hausvorteil)/x`, jedes Ausstiegsziel zahlt gleich viel, die Kurve steigt
  streng monoton und immer schneller, Zeit und Multiplikator sind exakt umkehrbar
* Notfallguthaben: nur bei genau 0 €, bei 1 € schon nicht mehr
* Spielkarten: alle 52 Karten liefern gültiges SVG, jede Zahlenkarte zeigt
  genau so viele Zeichen wie ihr Wert, alle vier Farben sind eigene Pfade
  und kein Farbzeichen steckt noch als Schriftzeichen im Bild
* Stylesheet: kein Farbtoken zeigt auf sich selbst, jedes benutzte `var(--x)`
  ist im `:root` definiert und jedes Theme setzt die Kontrast- und
  Kartenfarben-Tokens

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

* Gekaufte Designs, das aktive Design und der Bonus-Zeitpunkt liegen im
  `stats`-Feld des Profils. Dadurch braucht es keine zusätzliche Datenbankspalte –
  in Supabase ist `stats` eine JSON-Spalte.
* **Der Spielstand wird im Browser berechnet.** Die Row-Level-Security sorgt
  dafür, dass niemand fremde Spielstände lesen oder ändern kann – sie kann aber
  nicht verhindern, dass jemand über die Entwicklerkonsole seinen *eigenen*
  Kontostand überschreibt. Für ein reines
  Spielgeld-Projekt ist das in Ordnung; wenn Ergebnisse manipulationssicher sein
  müssten (z. B. für eine Bestenliste), müsste das Ziehen der Zahl und die
  Auszahlung in eine Supabase Edge Function wandern und die `profiles`-Tabelle
  für direkte Schreibzugriffe gesperrt werden.
* Split-, Street- und Corner-Wetten (Einsätze auf Feldkanten) sind bewusst nicht
  umgesetzt – gesetzt wird auf Einzelzahlen und die klassischen Außenwetten.
* Der Bonus-Timer verwendet die Uhr des Geräts. Wer sie zurückstellt, bekommt den
  Bonus früher; gesperrt wird dadurch aber nie jemand.

---

## Lizenz

MIT
