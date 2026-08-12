# Finsternis

**Live: https://lesterhr.github.io/eclipse/**

Eine Web-App für den Abend einer Sonnenfinsternis, in drei Teilen:

- **Live** zeigt die Sonne so, wie sie gerade aussieht — maßstäbliche Scheiben, der Mond an
  der Stelle, an der er auch am Himmel steht — dazu ihren Weg über den Horizont bis zum
  Untergang. Ein Zeitschieber geht den ganzen Verlauf durch, vorher wie nachher.
- **Messen** protokolliert mit der Handykamera die Umgebungshelligkeit. Während die Sonne
  verschwindet, fällt die eigene Messkurve auf die vorher berechnete Vorhersage. Am Ende
  steht ein Bild, das nur du hast: deine Messung, an deinem Ort, an diesem Abend.
- **Foto** rechnet aus, wie groß die Sonne im Bild wird, wie lange sich ohne Nachführung
  belichten lässt und welche Verschlusszeit zu welcher Minute passt — samt der Luftmasse der
  tief stehenden Sonne, an der jede allgemeine Belichtungstabelle scheitert.

Alle Zeiten hängen am Standort: GPS, Ortssuche oder Koordinaten von Hand. Wer erhöht steht,
trägt die Höhe über dem Umland ein; die Kimmtiefe verschiebt den Sonnenuntergang messbar.

Keine Abhängigkeiten, kein Build, kein Server. Reines ES-Modul-JavaScript, läuft als PWA
offline im Handy-Browser.

## Loslegen

```bash
npm start          # http://localhost:8080
npm test           # alle Tests
```

Kamera und Standort geben Browser nur im sicheren Kontext frei: **localhost oder HTTPS**.
Über die LAN-Adresse vom Handy aus funktioniert die Messung nicht. Für den Feldeinsatz
gehört die App auf eine HTTPS-Adresse (GitHub Pages genügt).

## So misst man damit

1. Handy **flach hinlegen, Display nach oben**, freier Blick zum Himmel. Nicht in den Schatten,
   nicht auf die Sonne richten.
2. **Vor** dem ersten Kontakt starten. Die App braucht ein Stück unbedeckter Kurve, um die
   Messung auf die Rechnung zu skalieren.
3. Ab dann nichts mehr bewegen. Jede Lageänderung ist ein Sprung in den Daten.
4. Automatische Displayhelligkeit am Handy ausschalten.
5. Wolke im Bild? Auf *Notiz* drücken. Dann weiß man später, welcher Knick von wem stammt.

Nie mit bloßem Auge in die Sonne sehen, auch nicht bei 90 % Bedeckung. Für den Blick nach
oben braucht es eine Finsternisbrille.

## Was drinsteckt

### Die Rechnung

`js/astro.js` implementiert Sonnen- und Mondposition nach Jean Meeus,
*Astronomical Algorithms* (2. Auflage): Sonne nach Kapitel 25, Mond nach Kapitel 47 mit der
vollständigen Termtabelle (60 Terme für Länge und Distanz, 60 für Breite). Dazu Nutation,
Schiefe der Ekliptik, Sternzeit und ΔT.

Entscheidend für Finsternisse ist die **topozentrische** Rechnung: der Mond steht je nach
Standort bis zu einem Grad neben seiner geozentrischen Position — mehr als sein eigener
Durchmesser. Sonne und Mond werden deshalb als kartesische Vektoren geführt, von denen der
Ortsvektor des Beobachters (inklusive Erdabplattung) abgezogen wird.

### Die Bedeckung

`js/eclipse.js` trennt zwei Dinge, die gern verwechselt werden:

- **Bedeckung** (obscuration) ist der verdeckte Flächenanteil der Sonnenscheibe, reine Geometrie.
- **Restlicht** ist der verbleibende Lichtstrom. Das ist nicht dasselbe, weil die Sonne zur
  Mitte hin deutlich heller leuchtet als am Rand. Die Randverdunklung wird quadratisch
  modelliert und radial integriert; für jeden Radius ist der verdeckte Ringanteil analytisch
  bekannt, sodass eine eindimensionale Integration reicht.

Die Helligkeitsvorhersage multipliziert das Restlicht mit einem Klarhimmelmodell über der
Sonnenhöhe. Das ist an diesem Abend wesentlich: In Deutschland läuft die Finsternis in den
Sonnenuntergang hinein, beide Effekte überlagern sich. Die App rechnet den Sonnenuntergang
mit und warnt, wenn er **vor** dem vierten Kontakt liegt — in Köln fünf Minuten davor.

### Die Messung

`js/meter.js` löst das eigentliche Problem der Aufgabe: Eine Handykamera regelt die Belichtung
nach und hält das Bild konstant hell. Wer das ignoriert, misst die Finsternis weg. Dagegen
zwei Verteidigungslinien:

1. Belichtung, ISO und Weißabgleich über `applyConstraints` hart sperren (Android Chrome).
2. Wo das nicht geht (iOS Safari): Belichtungszeit und ISO aus den Track-Settings auslesen und
   herausrechnen. Die Szenenleuchtdichte ist Pixelwert geteilt durch Zeit mal ISO.

Dazu die Gamma-Korrektur: Pixelwerte sind sRGB-kodiert. Ohne Linearisierung vor dem Mitteln
misst man systematisch die falsche Kurvenform.

Weil die Messung eine willkürliche Einheit hat und das Modell Lux, wird der Skalenfaktor
laufend als Median der logarithmischen Abweichung gefittet — robust gegen einzelne Ausreißer.

### Das Bild

`js/sky.js` zeichnet die beiden Scheiben maßstäblich aus den topozentrischen Winkelradien.
Die Bildlage kommt ohne Positions- und parallaktischen Winkel aus: `skyState` liefert den
Versatz des Mondes gegen die Sonne direkt in Horizontkoordinaten, und wer zur Sonne schaut,
hat wachsenden Azimut rechts und wachsende Höhe oben. Die Sichel zeigt damit auf dem Schirm
dorthin, wo sie auch am Himmel hinzeigt.

Die zweite Ansicht legt Azimut auf die x- und Höhe auf die y-Achse, beide linear in Grad —
der Weg der Sonne über den Westhorizont mit Kompass und Höhenraster. An einem Abend, an dem
die Finsternis in den Sonnenuntergang läuft, ist das die Ansicht, die über den Standort
entscheidet. Steht man erhöht, liegt der sichtbare Horizont um die Kimmtiefe
(0.0293° · √Höhe in Metern) tiefer; die Linie ist eingezeichnet.

### Für die Kamera

`js/photo.js` beantwortet drei Fragen, von denen zwei in keiner allgemeinen Tabelle stehen.

**Bildgröße** ist reine Optik: der Sonnendurchmesser auf dem Sensor ist Brennweite geteilt
durch rund 108. **Die Belichtungsgrenze ohne Nachführung** folgt aus 15 Bogensekunden pro
Sekunde Erddrehung und der Winkelauflösung eines Pixels.

**Die Belichtung** ist an einen Wert verankert, den jeder Sonnenfotograf kennt — ND-5-Folie,
f/8, ISO 100, hoch stehende Sonne, etwa 1/125 s — und wird von dort über die
Belichtungsgleichung fortgerechnet: Blende quadratisch, ISO linear, Filterdichte und
Luftmasse in Blendenstufen. Die Luftmasse ist hier der springende Punkt. Am Horizont beträgt
sie knapp 38 statt 1, das sind über zehn Größenklassen oder rund fünfzehn Blendenstufen. Die
Gegenprobe im Test: dieselbe Rechnung muss für die ungefilterte Sonne am Horizont im Bereich
echter Sonnenuntergangsbilder landen, also zwischen 1/1000 und 1/250 bei f/8 und ISO 100.

Ob der Filter drauf gehört, entscheidet deshalb keine Uhrzeit-Schwelle, sondern die Physik:
Er bleibt, solange die Sonne ohne ihn jede Kamera überfordert (kürzer als 1/8000 s bei
ISO 100), und er darf erst runter, wenn die gefilterte Zeit die Bewegungsgrenze reißt. Wird
die Zeit ohne Filter dabei kürzer als der Verschluss kann, nennt die App die ISO-Stufe, auf
die zurückzugehen ist. Was die Belichtung **nicht** beeinflusst, ist der Bedeckungsgrad: der
Mond nimmt Fläche weg, nicht Flächenhelligkeit.

## Tests

```
node test/astro.test.mjs        Ephemeriden gegen die Rechenbeispiele aus Meeus
node test/eclipse.test.mjs      Finsternis gegen NASA/timeanddate, plus Geometrie und Modell
node test/photo.test.mjs        Bildgröße, Belichtung, Kimmtiefe, Ablaufplan, Bildlage
node test/wiring.test.mjs       Verdrahtung HTML ↔ JS ↔ CSS ↔ Service Worker, Logikbausteine
node test/app.smoke.test.mjs    Rauchprobe: App startet, jeder Renderpfad läuft durch
```

Der Ephemeriden-Test prüft gegen die durchgerechneten Beispiele 12.a, 22.a, 25.b und 47.a aus
Meeus — Mondlänge auf 3·10⁻⁷ Grad, Distanz auf 15 Meter.

Für den 12. August 2026 trifft die Rechnung die veröffentlichten Werte:

| Ort | erster Kontakt | Maximum | Bedeckung |
|---|---|---|---|
| Köln | 17:18:25 UTC (Soll 17:18) | 18:12:37 (Soll 18:12) | 88.37 % (Soll 88.25 %) |
| Berlin | 17:15:16 (Soll 17:15) | 18:08:12 (Soll 18:08) | 84.94 % (Soll 84.84 %) |
| Reykjavík | 16:46:59 (Soll 16:47) | 17:48:33 (Soll 17:48:47) | 100 %, Totalität 74 s |

Bei der Sonnenhöhe und dem Sonnenuntergang weichen die Werte von timeanddate um bis zu
0.4° beziehungsweise 2 Minuten ab. Diese Zahlen sind dort aus Grafikparametern abgeleitet;
der Test rechnet sie deshalb zusätzlich auf einem unabhängigen Weg (klassisch über den
Stundenwinkel statt über die Vektorkette) nach und prüft beide Wege gegeneinander.

Ohne Browser lässt sich die Oberfläche nicht klicken, deshalb prüft `wiring.test.mjs`
statisch, dass jede von `app.js` gesuchte Element-ID im HTML steht, jede per JavaScript
gesetzte CSS-Klasse definiert ist und der Service Worker genau die vorhandenen Dateien cacht.
Der invertierte Skalenfaktor, der die Messkurve um mehrere Größenordnungen verschoben hätte,
ist genau dort aufgefallen.

`app.smoke.test.mjs` geht einen Schritt weiter und stellt DOM, Canvas und Speicher als
Attrappen bereit. Die Elemente kommen aus den IDs des echten `index.html`, der Zeichenkontext
ist ein Proxy, der jeden Aufruf mitschreibt und bei einer nicht-endlichen Koordinate Alarm
schlägt. Damit läuft die App wirklich an: Reiter umschalten, Zeitschieber quer durch den
Verlauf, Kameradaten ändern, Standort setzen — und am Ende wird geprüft, dass die Texte
gefüllt sind und keine Leinwand je `NaN` gesehen hat.

## Aufbau

```
index.html              Oberfläche, vier Reiter: Live, Messen, Foto, Hilfe
css/style.css           dunkles Thema, dazu ein roter Nachtmodus
js/astro.js             Ephemeriden (Meeus), Bildlage von Sonne und Mond
js/eclipse.js           Bedeckung, Kontaktzeiten, Helligkeitsmodell, Sonnenuntergang, Ablaufplan
js/sky.js               Nahaufnahme der Scheiben und der Weg über den Horizont
js/photo.js             Bildgröße, Bewegungsgrenze, Belichtung, Filterempfehlung
js/meter.js             Kameramessung, Lichtsensor, Sonifikation
js/store.js             Messreihe, Persistenz, CSV- und JSON-Export
js/chart.js             Lichtkurve und Ergebnisbild
js/app.js               Verdrahtung
sw.js                   Offline-Cache
tools/serve.mjs         lokaler Server
tools/make-icons.mjs    erzeugt die PNG-Icons ohne Bildbibliothek
```

## Grenzen

- Das Klarhimmelmodell ist eine Näherung. Die **Form** der Kurve stimmt, die absolute
  Lux-Skala wird an die Messung gefittet und ist keine kalibrierte Photometrie.
- Wolken schlagen direkt durch. Dafür gibt es den Notiz-Knopf.
- Die Kurzform-Ephemeriden liegen bei den Kontaktzeiten im Sekundenbereich, nicht darunter.
  Für Sekundenbruchteile bräuchte es die Besselschen Elemente der jeweiligen Finsternis.
- Bei Totalität weicht die berechnete Dauer um einige Sekunden von den Katalogwerten ab; am
  Rand des Totalitätspfads reagiert sie empfindlich auf das angesetzte Mondradiusverhältnis.
- Die App ist nicht auf eine bestimmte Finsternis fest verdrahtet: sie sucht über die
  Neumonde der nächsten 400 Tage die nächste am Standort sichtbare.
- Die Belichtungswerte sind Startpunkte für eine Belichtungsreihe, keine Messung. Der
  Extinktionskoeffizient (klar / normal / dunstig) ist einstellbar, weil Dunst am Horizont
  leicht zwei Blenden ausmacht. Nahe dem Horizont ist die Streuung ohnehin am größten.
- Die Filterempfehlung ersetzt kein Urteilsvermögen. Maßgeblich ist immer, was man sieht:
  Solange die Sonne blendet, gehört der Filter davor — für die Kamera und erst recht fürs Auge.
- Die Kimmtiefe geht von freiem Blick über ebenes Umland aus. Ein Bergrücken im Westen
  schlägt sie um Größenordnungen.
