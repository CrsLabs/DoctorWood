# Pubblicare una versione

Gli APK da installare non stanno in questa cartella ma nelle **[Releases](../../../releases)** del repository.

Per pubblicare una versione nuova:
1. Compila e firma l'APK (vedi `SVILUPPO.md`).
2. Aggiorna `aggiornamento.json` qui accanto: `versionCode`, `versione`, nome dell'`apk`, la sua impronta `sha256` e le `novita`.
3. Metti l'APK e `aggiornamento.json` nel ramo **`rilasci`**: l'automazione di quel ramo crea da sola la Release `vX.Y.Z`
   con i due file (oppure, a mano: **Releases → Draft a new release**, etichetta `vX.Y.Z`, e allega i due file).

Le copie di DoctorWood già installate (anche sui tablet del laboratorio) trovano la versione nuova da sole entro una settimana
(o subito con Impostazioni → Aggiornamenti → «Controlla adesso») e la installano dopo la conferma di Android.
