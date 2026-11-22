# DoctorWood: istruzioni per chi sviluppa

## Come è fatta
- `sorgente-DoctorWood.html`: tutta l'app (HTML, stile, script) in un file. Si apre anche dal PC come pagina web.
- `piattaforma-android.js`: il livello Android (cassaforte con l'impronta, file, vibrazione, fotocamera, sincronizzazione PairWood, aggiornamenti). `prepara.py` lo aggiunge alla pagina e scrive `www/index.html` per Capacitor.
- `android/`: progetto Android (Capacitor 8). Codice nativo in `android/app/src/main/java/it/doctorwood/app/` (`CassafortePlugin`, `LaboratorioPlugin`, `Aggiornamento`, fotocamera). SDK PairWood già compilato in `android/pairwood-sdk`.
- Regola di sicurezza della pagina (CSP): `connect-src 'none'`, solo script con impronta sha256. **Dopo ogni modifica alla pagina: `python3 prepara.py`** (ricalcola le impronte).
- I comandi dei pulsanti passano dalla tabella `AZIONI` (`data-click`, `data-change`…): niente codice scritto nell'HTML. `python3 prove/azioni.py` controlla che ogni comando abbia la sua voce.
- Ogni dato in entrata viene ripulito; ogni dato mostrato passa da `esc()`.

## Compilare
```
npm install
python3 prepara.py
npx cap sync android
cd android && ./gradlew assembleRelease
```
Minimo **Android 10 (API 29)** (PairWood usa solo TLS 1.3). applicationId **`it.doctorwood.app`**: non cambiarlo, o per Android è un'altra app e i dati non passano.
A ogni versione si cambiano `versionCode` e `versionName` in `android/app/build.gradle`; `prepara.py` copia `versionName` nella pagina (`VERSIONE_APP`).

**Firma**: la chiave non è nel repository (cartella `firma/`, esclusa da `.gitignore`, con `firma/firma.properties`). Gli aggiornamenti si installano solo con la stessa chiave: chi la custodisce non deve perderla mai. Impronta SHA-256 del certificato ufficiale: `224adfc34697e35060ab421709beb79324005ba59810a3054558689da41407e2`.

## Titolare e Laboratorio
- **Titolare** (telefono): tutto. **Laboratorio** (tablet): solo i lavori mandati al laboratorio, senza prezzi.
- Su un dispositivo usato da Titolare, passando in Laboratorio i dati del titolare si cifrano (AES-256-GCM) con una chiave dell'Android Keystore legata all'impronta e, per emergenza, con una password (PBKDF2-SHA-256, 600.000 giri).
- Tablet **«solo laboratorio»** (scelta al primo avvio, chiave `doctorwood_solo_laboratorio`): resta in Laboratorio per sempre e non riceve mai i dati del titolare. Cosa arriva al tablet lo decide `datiLabDaLavori()`; `prove/solo-lab.js` controlla che ci siano solo le voci ammesse.
- **Sincronizzazione** diretta con PairWood (stessa Wi‑Fi, TLS 1.3, dispositivi abbinati con codice o QR) oppure tramite una cartella tenuta allineata da un'altra app. In entrambi i casi DoctorWood scrive solo file cifrati: il titolare `doctorwood-laboratorio.dwsync` (firmato), ogni tablet il suo `doctorwood-avanzamento-<id>.dwsync`.

## Prove
Le prove usano Playwright con Chromium. Server: `python3 -m http.server 8766 --bind 127.0.0.1` dalla cartella del progetto e `python3 -m http.server 8765 --bind 127.0.0.1 -d www`. Elenco e istruzioni in [`prove/LEGGIMI-PROVE.md`](prove/LEGGIMI-PROVE.md). `node prove/scenari.js` crea i dati d'esempio che servono al robot e alle schermate della guida.

## Pubblicare una versione
1. Compila e firma l'APK (la firma si fa fuori da GitHub: le chiavi non vanno mai nel repository).
2. Aggiorna `rilasci/aggiornamento.json` (`versionCode`, `versione`, `apk`, `sha256` dell'APK, `novita`).
3. Sul ramo **`rilasci`** (separato dal codice: contiene solo l'automazione, l'APK e `aggiornamento.json`) togli l'APK vecchio, metti quello nuovo e il nuovo `aggiornamento.json`, e carica.
4. L'automazione `.github/workflows/rilascio.yml` di quel ramo controlla l'impronta dell'APK e crea da sola la Release `vX.Y.Z` con i due file.

Le app installate (anche i tablet del laboratorio) la trovano da sole entro una settimana (`Aggiornamento.java`: solo https da GitHub, impronta SHA-256, stesso pacchetto, versione più nuova, stessa firma). In alternativa la Release si può sempre creare a mano dal sito, allegando gli stessi due file.

## Guida e tutorial
Due PDF in italiano, `guida/DoctorWood-Guida.pdf` e `guida/DoctorWood-Tutorial.pdf` (`guida/guida.html`, `guida/tutorial.html`, stile comune in `guida/stile-guida.css`), divisi nelle stesse sei parti.
1. Schermate: `node guida/schermate.js` (server 8766; usa i dati d'esempio di `prove/risultati/dati-realistici.json`).
2. PDF: `node guida/genera-guida.js` (oppure `guida` o `tutorial`). L'indice prende da solo i numeri di pagina: ogni capitolo ha un segno invisibile `§§id§§` che un primo PDF usa per sapere dove cade (serve `pdftotext`).
A ogni versione con novità visibili si rifanno schermate e PDF e si aggiunge una riga al capitolo «Novità».

## Icona e schermata di avvio
Il simbolo (pialla piatta, ambra e acciaio) è in `icona/simbolo.svg`; i colori di sfondo sono in cima a `genera-icone.js`. Dopo una modifica: `node genera-icone.js`, poi ricompila.
