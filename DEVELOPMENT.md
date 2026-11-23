# DoctorWood: developer notes

## How it is built
- `sorgente-DoctorWood.html`: the whole app (HTML, style, script) in one file. It also opens on a computer as a web page.
- `piattaforma-android.js`: the Android layer (fingerprint vault, files, vibration, camera, PairWood sync, updates). `prepara.py` appends it to the page and writes `www/index.html` for Capacitor.
- `android/`: Android project (Capacitor 8). Native code in `android/app/src/main/java/it/doctorwood/app/` (`CassafortePlugin`, `LaboratorioPlugin`, `Aggiornamento`, camera). The PairWood SDK is included precompiled in `android/pairwood-sdk`.
- Page security rule (CSP): `connect-src 'none'`, only scripts with a sha256 hash. **After every change to the page: `python3 prepara.py`** (recomputes the hashes).
- Button commands go through the `AZIONI` table (`data-click`, `data-change`…): no code written in the HTML. `python3 prove/azioni.py` checks that every command has its entry.
- All incoming data is cleaned; all displayed data goes through `esc()`.
- The app is in English and Italian. The source code, its comments and the folder names are in Italian (`guida` = guide, `prove` = tests, `lingua` = language, `rilasci` = releases, `icona` = icon).

## Build
```
npm install
python3 prepara.py
npx cap sync android
cd android && ./gradlew assembleRelease
```
Minimum **Android 10 (API 29)** (PairWood uses TLS 1.3 only). applicationId **`it.doctorwood.app`**: don't change it, or Android treats it as a different app and the data doesn't carry over.
For each version change `versionCode` and `versionName` in `android/app/build.gradle`; `prepara.py` copies `versionName` into the page (`VERSIONE_APP`).

**Signing**: the key is not in the repository (`firma/` folder, excluded by `.gitignore`, with `firma/firma.properties`). Updates install only with the same key: whoever keeps it must never lose it. SHA-256 fingerprint of the official certificate: `224adfc34697e35060ab421709beb79324005ba59810a3054558689da41407e2`.

## Owner and Workshop
- **Titolare** (Owner, the phone): everything. **Laboratorio** (Workshop, the tablet): only the jobs sent to the workshop, no prices.
- On a device used as Owner, switching to Workshop encrypts the owner's data (AES-256-GCM) with an Android Keystore key tied to the fingerprint and, for emergencies, with a password (PBKDF2-SHA-256, 600,000 rounds).
- **«Workshop only»** tablet (chosen on first start, key `doctorwood_solo_laboratorio`): stays in Workshop mode for good and never receives the owner's data. What reaches the tablet is decided by `datiLabDaLavori()`; `prove/solo-lab.js` checks that only the allowed fields are there.
- **Sync** directly with PairWood (same Wi‑Fi, TLS 1.3, devices paired with a code or QR) or through a folder kept aligned by another app. Either way DoctorWood writes only encrypted files: the owner writes `doctorwood-laboratorio.dwsync` (signed), each tablet its own `doctorwood-avanzamento-<id>.dwsync`.

## English
The page is written in Italian; in English the visible texts are translated on the fly (a `MutationObserver` over the whole page) with the table in `lingua/inglese.txt`: one line per sentence, Italian, arrow, English. In the keys `#` is a number, `@` a name typed by the user (customer, job, item: they stay as they are), `«@»` a name between «», `§` a date; a trailing `*` matches the start of a sentence; `@@` lines translate the names of buttons quoted between «». After every change: `python3 lingua/applica.py` and `python3 prepara.py`.
- The language is chosen in Settings → Appearance → Language (key `doctorwood_lingua`: `auto`, `it`, `en`); «Automatic» follows the phone. It changes at once, without reloading.
- PDFs (quote, cutting list, labels, survey) are translated before they are written (`trPdf`), text fields keep what the user typed (only their placeholders are translated), elements with `data-no-tr` are left alone (licence texts, the technical report for the developer).
- The Android camera (`FotocameraActivity`) and the fingerprint prompts get their texts in the right language from the page.
- **Every new text must be added**: `INGLESE=1 node prove/robot.js <combination>` writes the untranslated ones to `prove/risultati/non-tradotti-*.json`; `node prove/inglese.js` checks the main screens (and `RACCOLTA=file.json` collects what is missing).

## Tests
Playwright with Chromium. Servers: `python3 -m http.server 8766 --bind 127.0.0.1` from the project folder and `python3 -m http.server 8765 --bind 127.0.0.1 -d www`. List and instructions in [`prove/README.md`](prove/README.md). `node prove/scenari.js` creates the sample data needed by the robot and by the guide screenshots.

## Publishing a version
1. Build and sign the APK (signing happens outside GitHub: keys never go into the repository).
2. Update `rilasci/aggiornamento.json` (`versionCode`, `versione`, `apk`, the APK's `sha256`, `novita` = what's new, shown in the app; add its English to `lingua/inglese.txt`).
3. On the **`rilasci`** branch (it only holds the automation, the APK and `aggiornamento.json`) remove the old APK, add the new one and the new `aggiornamento.json`, and push.
4. The `.github/workflows/rilascio.yml` automation on that branch checks the APK fingerprint and creates the `vX.Y.Z` Release with both files by itself.

Installed apps (workshop tablets included) find it by themselves within a week (`Aggiornamento.java`: https from GitHub only, SHA-256 fingerprint, same package, newer version, same signature). Alternatively the Release can always be created by hand on the website, attaching the same two files.

## User guide and tutorials
Four PDFs: guide and tutorials in Italian and English (`guida/guida.html`, `guida/tutorial.html`, `guida/guide-en.html`, `guida/tutorial-en.html`, shared style in `guida/stile-guida.css`), all in the same six parts.
1. Screenshots: `node guida/schermate.js` (server 8766; uses the sample data in `prove/risultati/dati-realistici.json`) into `guida/img`, and `node guida/schermate.js en` (app and sample data in English) into `guida/img-en`.
2. PDFs: `node guida/genera-guida.js` (all four; or `guida it`, `tutorial en`…). The contents page gets the page numbers by itself: each chapter has an invisible `§§id§§` marker that a first PDF uses to find where it falls (needs `pdftotext`).

## Icon and splash screen
The symbol (a flat plane, amber and steel) is in `icona/simbolo.svg`; background colours are at the top of `genera-icone.js`. After a change: `node genera-icone.js`, then rebuild.
