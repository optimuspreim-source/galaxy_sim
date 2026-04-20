# Simulationsoptionen – Physikalische Verbesserungsvorschläge

Dieses Dokument beschreibt vier konkrete Ansätze, die Simulation physikalisch präziser oder visuell
überzeugender zu gestalten. Jeder Punkt enthält: den aktuellen Ist-Zustand mit Begründung, den
Änderungsvorschlag, den zu erwartenden Effekt sowie Vor- und Nachteile.

---

## 1. Physikalisch kalibrierte Anfangsgeschwindigkeit (Kepler-Orbits)

### Ist-Zustand
```js
// main.js, fillTextures()
const circV = def.v * Math.pow(rr, 0.2);
```
Die Kreisbahngeschwindigkeit jedes Sterns wird als Potenzfunktion des normierten Abstands `rr`
berechnet, multipliziert mit einem frei wählbaren Geschwindigkeitsfaktor `def.v` (= `effectController.velocity`).
Der Exponent `0.2` ist empirisch gewählt und erzeugt eine sanft ansteigende, dann abflachende Kurve.

**Warum so?** Beim Bau der Simulation war das Ziel, schnell sichtbare Spiralgalaxien zu erzeugen.
Ein fest codierter Exponent ist einfach zu tunen: Wer zu langsam ist, dreht am `velocity`-Slider.
Die Koppelung an `G` und `M_BH` hätte bedeutet, dass jede Parameteränderung sofort die Orbitstruktur
verändert — das macht interaktives Tuning schwieriger.

### Vorschlag
```js
// Keplerian: v = sqrt(G * M / r)
const circV = Math.sqrt(
    effectController.gravity * effectController.blackHoleForce / Math.max(rExp, 1e-3)
);
```

### Effekt
Jeder Stern erhält exakt die Geschwindigkeit, die für einen stabilen Kreisbahnorbit um das
Schwarze Loch nötig ist. Sterne nahe dem Zentrum rasen schnell, Sterne am Rand kreisen langsam —
das entspricht der physikalisch korrekten Kepler-Kurve und erzeugt automatisch realistische
differentielle Rotation (innere Arme drehen schneller als äußere).

### Vorteile gegenüber Ist-Zustand
- Orbits sind intrinsisch stabil; kein manuelles Tuning von `velocity` nötig
- Skaliert automatisch mit `gravity` und `blackHoleForce` — beide Parameter bleiben konsistent
- Sterne explodieren oder kollabieren nicht mehr bei extremen Parametersets
- Spiralarme entstehen natürlicher, weil die differentielle Rotation physikalisch stimmt

### Nachteile / Risiken
- `velocity`-Slider verliert seine direkte Bedeutung (müsste auf `M_BH` oder `G` umgemappt werden)
- Bei sehr flachen Galaxien (kleines `height`) und großem `gravity` entstehen extrem enge Innenorbits
  → hohe GPU-Last durch schnelle Positionsänderungen
- Kombination mit dem Partikel-Partikel-Term im Shader erzeugt leichte Störungen; die Kepler-Lösung
  gilt exakt nur für das Einkörperproblem (Stern ↔ BH)

---

## 2. Flache Rotationskurve (Dunkle-Materie-Halo-Modell)

### Ist-Zustand
Der Exponent `rr^0.2` in `circV = def.v * Math.pow(rr, 0.2)` erzeugt eine leicht ansteigende
Kurve, die aber für große `rr` wieder leicht fällt. Eine echte flache Rotationskurve (konstante
Orbitalgeschwindigkeit über den gesamten Radius) wird nicht explizit modelliert.

**Warum so?** Das Dunkle-Materie-Halo ist ein Massenverteilungsmodell, das im GPGPU-Ansatz dieser
Simulation nicht als physikalisches Objekt existiert. Es müsste entweder als zusätzliche analytische
Kraft im Shader ergänzt oder durch den Potenzgesetz-Exponent approximiert werden. Der Entwickler
hat letzteren Weg gewählt — pragmatisch, weil es keine zusätzlichen Uniforms benötigt.

### Vorschlag
```js
// Hybrid: Zentrum Kepler, Außenbereich flach (NFW-Halo-Approximation)
const v_flat = effectController.velocity;
const r_scale = def.r * 0.3;  // Skalenlänge des Halos ≈ 30% des Galaxienradius
const circV = v_flat * Math.sqrt(1.0 - Math.exp(-rExp / r_scale));
```
Für kleine `rExp` verhält sich das wie Kepler (ansteigend), für große `rExp` nähert es sich `v_flat`
(konstant). Das ist eine Vereinfachung des NFW-Profils (Navarro–Frenk–White), das in der modernen
Kosmologie für Dunkle-Materie-Halos verwendet wird.

### Effekt
- Sterne im Außenbereich der Galaxie bleiben auf stabilen, breiten Orbits statt nach außen zu driften
- Die Galaxie behält ihre Ausdehnnung auch nach vielen Simulationsschritten
- Spiralarme werden langlebiger, weil die Außenregionen nicht zerfallen

### Vorteile gegenüber Ist-Zustand
- Entspricht dem beobachteten Verhalten echter Spiralgalaxien (Vera-Rubin-Effekt)
- Galaxien "verblassen" am Rand nicht so schnell — bessere Optik bei langen Simulationsläufen
- `velocity`-Slider bekommt eine klare physikalische Bedeutung: asymptotische Rotationsgeschwindigkeit

### Nachteile / Risiken
- `r_scale` ist ein neuer freier Parameter — muss sinnvoll an `radius` gekoppelt werden
- Bei Galaxienkollisionen entstehen physikalisch inkonsistente Kräfte, weil der Halo nicht
  mitbewegt wird (er ist implizit, kein echtes Objekt in der Simulation)
- Leicht komplexere Init-Berechnung (zwei Parameter statt einer Potenzfunktion)

---

## 3. Escape-Velocity für Kollisions-Archetypes

### Ist-Zustand
```js
// main.js, fillTextures() – Archetype-Wahl
const archetype = Math.floor(Math.random() * 5);
// 0 = direkte Kollision, 1 = cross-cluster, 2 = close flyby,
// 3 = distant sweep, 4 = slow spiral
```
Jede Galaxien-Einheit erhält einen zufälligen Archetype aus 5 gleichgewichteten Kategorien.
Die Anfangsgeschwindigkeit wird dann mit einem archetype-spezifischen `speedMult` skaliert.

**Warum so?** Zufälligkeit sorgt bei jedem Start für Abwechslung und verhindert vorhersehbare
Muster. Die Archetypes wurden empirisch so gewählt, dass die Simulation visuell interessant bleibt.
Eine physikalische Kopplung an Fluchtgeschwindigkeit wäre beim initialen Entwicklungsstand schwieriger
zu debuggen gewesen, da `vVir` (virial velocity) erst nach dem vollständigen Galaxy-Setup bekannt ist.

### Vorschlag
```js
const v_escape = Math.sqrt(2.0 * effectController.gravity * effectController.blackHoleForce
                           * numG / Math.max(dist, 1e-3));

let archetype;
const ratio = baseSpeed / v_escape;

if      (ratio > 1.2)  archetype = 3; // hyperbolisch: distant sweep
else if (ratio > 1.0)  archetype = 2; // knapp gebunden: close flyby
else if (ratio > 0.7)  archetype = 1; // gebunden: cross-cluster
else if (ratio > 0.4)  archetype = 0; // stark gebunden: direkte Kollision
else                   archetype = 4; // sehr langsam: spiral merge
```

### Effekt
Die Archetype-Wahl wird durch die physikalische Konstellation bestimmt: Galaxien, die zu schnell
sind, fliegen aneinander vorbei (hyperbolische Bahn); langsame Galaxien fusionieren unweigerlich.
Das Ergebnis ist physikalisch kohärent — die Simulation verhält sich wie ein echtes gravitativ
gebundenes System.

### Vorteile gegenüber Ist-Zustand
- Kein Widerspruch zwischen gewähltem Archetype und tatsächlicher Dynamik
  (z. B. kein "direct collision"-Archetype für Galaxien, die sich zu schnell entfernen)
- Langzeitverhalten ist vorhersehbar: nahe, langsame Galaxien fusionieren immer
- Schafft eine saubere physikalische Grundlage für zukünftige Features (z. B. Merger-Erkennung)

### Nachteile / Risiken
- Zufälligkeit der Simulation wird reduziert; manche Starts sind ähnlicher
- `v_escape` hängt von `gravity` und `blackHoleForce` ab — Parameteränderungen im GUI
  verändern die Archetype-Verteilung, was sich schwer kommunizieren lässt
- Bei `numG = 30` und dem virial-Ansatz ist `v_escape` nur eine Schätzung für das
  Mehrkörperproblem, keine exakte Lösung

---

## 4. Physikalisch motiviertes Softening im Velocity-Shader

### Ist-Zustand
```glsl
// computeShaderVelocity.glsl
float distanceSq = (distance * distance) + 1.0;
```
Der Softening-Term `+ 1.0` ist eine fest codierte Konstante. Er verhindert numerische Singularitäten
(Division durch null), wenn zwei Partikel denselben Ort einnehmen.

**Warum so?** Ein konstantes Softening von 1.0 Simulationseinheit ist einfach, robust und
verhindert zuverlässig "Explosionen" (unphysikalisch große Beschleunigungen bei Nahdurchgängen).
Beim GPU-Compute-Ansatz — wo alle Partikel parallel ohne Kommunikation berechnet werden — gibt
es keinen einfachen Weg, den Softening-Radius adaptiv zu machen. Eine Konstante ist sicher.

**Problem:** Die Simulation-Einheiten skalieren mit `radius`. Bei `radius = 357` (Standard) ist
ein Softening von `1.0` verschwindend klein und hat kaum Wirkung; bei `radius = 10` ist es
relativ riesig und macht alle Nahpassagen unphysikalisch weich.

### Vorschlag
```glsl
// computeShaderVelocity.glsl – neues Uniform
uniform float uSoftening;  // = (radius * 0.01)^2 aus main.js übergeben

float distanceSq = (distance * distance) + uSoftening;
```
In `main.js`:
```js
// beim Init und bei GUI-Änderung:
velocityUniforms.uSoftening.value = Math.pow(effectController.radius * 0.01, 2);
```

### Effekt
Das Softening skaliert proportional zum Galaxienradius. Kleine Galaxien haben proportional
gleiches Softening wie große — Nahdurchgänge werden konsistent behandelt, unabhängig vom
gewählten `radius`-Slider-Wert. Bei Kollisionen zwischen zwei Galaxien entstehen keine
unphysikalischen "Sling-Shot"-Beschleunigungen mehr, die einzelne Sterne auf Fluchtgeschwindigkeit
bringen.

### Vorteile gegenüber Ist-Zustand
- Konsistentes Verhalten über alle `radius`-Bereiche (10–1000)
- Kontrollierbar per GUI, falls ein Slider für `softening` ergänzt wird
- Reduziert "heiße" Ausreißer-Partikel bei Galaxienkollisionen deutlich
- Physikalisch motiviert: entspricht einem minimalen Kernradius ≈ 1% des Galaxienradius

### Nachteile / Risiken
- Neues Uniform muss bei jeder Simulation-Neustart-Parameteränderung aktualisiert werden
- Zu großes Softening dämpft echte Nahpassagen-Dynamik (keine engen Hyperbelbahnen mehr)
- Bei sehr kleinem `radius` und großem `gravity` kann ein skaliiertes Softening immer noch
  zu Instabilitäten führen — es ist kein Ersatz für adaptive Zeitschritte

---

## Übersicht

| # | Änderung | Aufwand | Physikalischer Gewinn | Visueller Gewinn |
|---|----------|---------|----------------------|-----------------|
| 1 | Kepler-Anfangsgeschwindigkeit | gering | hoch | mittel |
| 2 | Flache Rotationskurve (Halo) | mittel | hoch | hoch |
| 3 | Escape-Velocity für Archetypes | mittel | mittel | gering |
| 4 | Skaliiertes Softening (Uniform) | gering | mittel | mittel |

**Empfohlene Reihenfolge:** 4 → 1 → 2 → 3
Softening zuerst, weil es eine sichere Grundlage schafft. Kepler danach als größter
Einzelgewinn. Halo-Modell danach für Langzeitstabilität. Archetypes zuletzt, weil sie
die anderen drei Punkte voraussetzen, um physikalisch sinnvoll zu sein.
