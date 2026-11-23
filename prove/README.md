# DoctorWood automated tests

You need Node and Playwright (with Chromium). First start two local servers, from the project folder:

```
python3 prepara.py
python3 -m http.server 8766 --bind 127.0.0.1 &          # web page (sorgente-DoctorWood.html)
python3 -m http.server 8765 --bind 127.0.0.1 -d www &   # Android app page (www/index.html)
```

Then, in this order:

| Test | What it does | Command |
|---|---|---|
| `azioni.py` | Static check: every `data-click` and every `az(...)` has its entry in `AZIONI` (a button with no entry does nothing). | `python3 prove/azioni.py` |
| `guida-passi.js` | Guided new job and new quote (steps, choices, creation). | `node prove/guida-passi.js` |
| `correzioni2.js` | Checks on VAT number, tax code, IBAN, email and phone; confirmation when leaving guided paths; survey/quote/cutting sequence; quote that empties itself. | `node prove/correzioni2.js` |
| `notifiche.js` | Messages appear at the bottom, close by swiping (sideways or down) and don't block the controls underneath. | `node prove/notifiche.js` |
| `rilievo-scarta.js` | «Non salvare» (don't save) in the Survey puts everything back as it was. | `node prove/rilievo-scarta.js` |
| `schiena.js` | From a model: back panel on a separate sheet and stock warning. | `node prove/schiena.js` |
| `scenari.js` | A real user's path (taps only): first start, job, customer, quote, stock, calendar, sheets, cutting, survey, encrypted backup there and back, Workshop with PIN, Settings. Saves `risultati/dati-realistici.json`, needed by the robot and the guide screenshots. | `node prove/scenari.js` |
| `robot.js` | Presses **every** visible button of every section and window (also inside windows that open), with confirmations accepted and declined. Reports errors, missing commands, freezes, overflowing pages, injections. With `INGLESE=1` it runs the app in English and writes the texts still without a translation to `risultati/non-tradotti-<combination>.json`. | `node prove/robot.js <combination>` (with no argument it lists the combinations) |
| `file.js` | Incoming files: photos and PDFs in sheets, logo, broken images, fake backups; saving on Android. | `node prove/file.js` |
| `primo.js` | Simulated Android: first start as Owner (password + fingerprint), switch to Workshop, «Cancella tutto». | `node prove/primo.js` |
| `diretta.js` | **Direct** sync (PairWood) between the owner's phone and simulated tablets: mode choice, code, wrong code, pairing, encrypted files, ticks and jobs travelling by themselves, stranger refused, «Dispositivi abbinati» and «Dimentica», «Scollega», «Cambia codice» and re-pairing, tablet always listening (default hours, hours typed by hand, wrong hours, «Spegni», battery request), «nobody reachable» and «not heard from for days» alerts, no network from the page. | `node prove/diretta.js` |
| `combinazioni.js` | Sync in **every combination**: direct or folder × 1 or 2 tablets × owner or tablet starts; jobs to every tablet, ticks from every tablet, restart of all devices halfway, unreadable orphan file. (`SOLO=diretta,2,true` for just one) | `node prove/combinazioni.js` |
| `pratica.js` | **Usability** of every screen (owner web and Android, workshop) on a 320 px phone, phone, tablet and PC: small buttons, unnamed buttons, fields without labels, covered buttons even after scrolling, text < 11 px, overflow. (`TUTTI=1` for the full list; `TESTO=115` or `TESTO=130` for Large / Very large text: Android text zoom is simulated in the app) | `node prove/pratica.js` |
| `testo.js` | **Text size**: chosen in Settings, zoom on PC, no page zoom on phone and in the app, command to Android at start and on choice, compensated bar; large Workshop text. | `node prove/testo.js` |
| `solo-lab.js` | «Workshop only» tablet on first start (web and app) and **what reaches the tablet**: only the allowed fields, no prices, phone numbers, emails, VAT numbers or customer notes. | `node prove/solo-lab.js` |
| `aggiornamenti.js` | Updates from GitHub (simulated app): Settings section, «Controlla adesso», «Aggiorna», weekly question and «Più tardi», check turned off, workshop tablet that doesn't re-pin during installation. | `node prove/aggiornamenti.js` |
| `inglese.js` | The app in English: main sections and windows (Owner and Workshop) with the sample data, no Italian left in the visible texts; dates, calendar and PDF texts in English; «Italiano» and «English» switch at once without reloading; first start with an English phone. | `node prove/inglese.js` |
| `veleno.js` | «Poisoned» data with HTML in every field: nothing must come to life. | `node prove/veleno.js http://localhost:8766/sorgente-DoctorWood.html` |

Expected result: 0 failed, no errors in the page. The native parts (fingerprint, Keystore, camera, folders) can only be tested on the phone.
