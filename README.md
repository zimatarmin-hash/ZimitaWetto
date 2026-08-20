# Zimita Wetto

Mobile-first Single-Page-App für die Wettersituation in **Zimat**, einem Weiler
bei St. Sigmund in der Gemeinde **Kiens (Südtirol)**.
Reines HTML/CSS/JS – externe Abhängigkeiten nur per CDN (Leaflet fürs Kartenmodul,
proj4js für die exakte Georeferenzierung der Radarbilder).

## Dateien

```
index.html    Struktur, Tab-Bar, Panels
styles.css    Design (Light/Dark, mobile-first, Kachel-Optik)
app.js        Datenanbindung, Rendering, Radar-Player, Tabs, Theme
server.ps1    Mini-HTTP-Server für den lokalen Test (nur PowerShell nötig)
```

## Position vs. Daten

Die Landeswetterdienst-Daten liegen technisch nur je **Gemeinde** vor (kein
Weiler-Raster) – sie gelten daher für **Kiens**. Wo eine genaue Koordinate
möglich ist (Open-Meteo, Kartenmittelpunkt/Marker, Standort-Anzeige), verwendet
die App die Position von **Zimat** (46.81423° N, 11.80156° E – die einzige mit
diesem Namen in OpenStreetMap verzeichnete Stelle bei St. Sigmund; ohne
eigenen Hoheitsstatus, daher nur eine Näherung, keine amtlich vermessene
Weiler-Mitte).

## Datenquellen – was wirklich live ist

| Quelle | Genutzt für | Technik |
|---|---|---|
| **Landeswetterdienst Südtirol** (`static-wetter.provincia.bz.it`) | Aktuelle Werte, Stunden-/5-Tages-Prognose für **Kiens**, Sonnen-/Mondzeiten | Offene, CORS-freigegebene JSON-Endpunkte – dieselben, die `wetter.provinz.bz.it` selbst clientseitig lädt |
| **Live-Rasterdaten der Provinz** (`static-meteo.provincia.bz.it`) | Live-Radar, Blitze, Hagel, Satellit, Niederschlagsvorhersage (INCA/ICON, ca. 24h) | Zeitserien echter Kartenbilder (WEBP) als Bild-Overlay auf einer Leaflet-Karte, georeferenziert per `proj4js` (EPSG:25832 → WGS84) |
| **Open-Meteo** (`api.open-meteo.com`) | Zweite, unabhängige Quelle für den aggregierten Status & Vergleich, Position **Zimat** | Freie, CORS-offene Wetter-API ohne Key |
| **Kachelmannwetter** | Stunden-/3-Tage-Werte im Vergleich & aggregierten Status | Keine öffentliche API – die Werte werden live vom öffentlichen `ajax_pub`-Endpunkt der Webseite über den Lese-Proxy [r.jina.ai](https://r.jina.ai) gelesen und geparst. Inoffiziell, kann bei Markup-Änderungen brechen (Fallback: "–") |

Der „aggregierte Status" ist der Mittelwert aus bis zu 3 Quellen (Landeswetterdienst,
Open-Meteo, Kachelmann) – siehe „Details"-Button auf der Statuskachel.

## Design & Icons

Alle Icons sind selbst gezeichnetes Inline-SVG (kein Emoji, keine Icon-Font,
kein externes Icon-Set) – siehe `ICON`/`UI_ICON`/`weatherIconMarkup()` in
`app.js`. Wetter-Icons werden aus einem gemeinsamen "Condition-Key"-System
gespeist, das die drei unterschiedlichen Quell-Codesysteme (Landeswetterdienst
a–z, Open-Meteo WMO-Codes, Kachelmann-Freitext) auf ~11 einheitliche Symbole
abbildet, damit überall im UI dieselbe Bildsprache erscheint.

## Heuwetter-Index (Trockenfenster)

Eigenständiges Modul (Tab „Heuwetter" + Kurz-Banner oben in „Übersicht"), das
aus den Prognosedaten ein Mäh-/Trockenfenster für Heu ableitet:

- **Ausgangszustand:** War es die letzten 2 Tage trocken (&lt;1mm, aus
  Open-Meteo `past_days`), reichen 3 Trockentage; war es nass, werden 4 Tage
  verlangt (1 Tag Bodenabtrocknung + 3 Tage Trocknung).
- **Trockentag:** Niederschlag &lt;0,2mm, Regenwahrscheinlichkeit &lt;15%
  (Konsens Landeswetterdienst + Open-Meteo) und Sonnenstunden ≥7h.
- **Fenstersuche:** Erster lückenloser Lauf von Trockentagen → grünes Banner;
  sonst erster Lauf, der höchstens 1 riskanten Tag enthält (Regen &lt;40%,
  Sonnenstunden ≥5h) → gelbes Banner mit Hinweis auf den Risikotag; sonst rot.
- **Abtrocknung 11–17 Uhr:** aus Open-Meteo-Stundenwerten (Taupunkt, rel.
  Luftfeuchte, Wind) klassifiziert in optimal/mäßig/kritisch; starker
  Morgentau (&gt;90% rel. Feuchte 0–6 Uhr) verschlechtert die Einstufung um
  eine Stufe. Daraus ergibt sich pro Tag ein Trocknungstempo-Badge
  (schnell/moderat/träge).
- **Countdown:** zeigt den aktuellen Arbeitsschritt (Mähen/Zetteln → Wenden →
  [Wenden →] Schwaden/Einfahren) innerhalb des gefundenen Fensters.

Kachelmann fließt hier bewusst nicht ein (nur 3 Tage Datentiefe, keine
Regenwahrscheinlichkeit je Tag verfügbar) – die Berechnung nutzt ausschließlich
Landeswetterdienst (Kiens) und Open-Meteo (Zimat).

### Warum kein Bergfex?

Bergfex wurde versucht (ebenfalls über den Lese-Proxy), blockiert automatisierte
Anfragen aber aktiv mit `HTTP 429 Too Many Requests` – auch über den Proxy. Das
ist kein einmaliger Ausfall, sondern eine gezielte Sperre und daher keine
verlässliche Basis für eine Produktions-App. Bergfex ist deshalb komplett entfernt.
Eine dritte "bewährte" öffentliche Zusatzquelle speziell für Südtirol über
Landeswetterdienst und Open-Meteo hinaus ist uns nicht bekannt – beide sind
bereits die verlässlichsten frei verfügbaren Optionen.

## Lokal testen

Kein Node/Python nötig – nur Windows-PowerShell (bereits vorhanden):

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File server.ps1
```

Dann im Browser öffnen: `http://localhost:8080`

(Direktes Öffnen der `index.html` per Doppelklick funktioniert **nicht** zuverlässig,
da manche Browser `fetch()` auf `file://`-Seiten einschränken – ein einfacher HTTP-Server wird daher benötigt.)

## Deployment auf GitHub Pages

1. Repo anlegen und Dateien committen:
   ```bash
   git init
   git add index.html styles.css app.js README.md
   git commit -m "Zimita Wetto"
   git branch -M main
   git remote add origin https://github.com/<dein-user>/<dein-repo>.git
   git push -u origin main
   ```
2. Auf GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `root`**.
3. Nach 1–2 Minuten ist die App unter `https://<dein-user>.github.io/<dein-repo>/` live.

Keine Build-Schritte, kein Server, keine Umgebungsvariablen nötig – alle genutzten
APIs sind öffentlich und CORS-offen, funktionieren also direkt von `github.io` aus.

## Bekannte Grenzen

- Kachelmann liefert keine strukturierten Zahlen über eine offizielle API (siehe oben)
  – die Live-Werte hängen an einem öffentlichen, aber inoffiziellen Endpunkt und
  können jederzeit ausfallen.
- Die amtliche Niederschlagsvorhersage im Radar-Tab reicht nur ca. 24h in die
  Zukunft – das ist die technische Grenze der Provinz-Quelle selbst (dieselbe
  Grenze gilt auch auf `wetter.provinz.bz.it`).
- "Zimat" ist kein amtlicher Fraktionsname der Gemeinde Kiens (die vier
  Fraktionen sind Ehrenburg, Getzenberg, Hofern, St. Sigmund) – die Koordinate
  stammt aus einem einzigen OpenStreetMap-Eintrag in der Nähe von St. Sigmund.
- Alle Zeiten werden in `Europe/Rome` (Südtirol) angezeigt, unabhängig vom Gerätestandort.
