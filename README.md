# Finsternis-Messung

**Live: https://lesterhr.github.io/eclipse/**

Eine Web-App, die eine Sonnenfinsternis **misst** statt sie nur abzubilden. Das Handy liegt
flach auf dem Boden, die Kamera protokolliert die Umgebungshelligkeit, und während die Sonne
verschwindet, fällt die eigene Messkurve auf die vorher berechnete Vorhersage. Am Ende steht
ein Bild, das nur du hast: deine Messung, an deinem Ort, an diesem Abend.

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

## Tests

```
node test/astro.test.mjs      Ephemeriden gegen die Rechenbeispiele aus Meeus
node test/eclipse.test.mjs    Finsternis gegen NASA/timeanddate, plus Geometrie und Modell
node test/wiring.test.mjs     Verdrahtung HTML ↔ JS ↔ CSS ↔ Service Worker, Logikbausteine
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

## Aufbau

```
index.html              Oberfläche
css/style.css           dunkles Thema, dazu ein roter Nachtmodus
js/astro.js             Ephemeriden (Meeus)
js/eclipse.js           Bedeckung, Kontaktzeiten, Helligkeitsmodell, Sonnenuntergang
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
