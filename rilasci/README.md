# Publishing a version

The installable APKs are not in this folder but in the repository's **[Releases](../../../releases)**.

To publish a new version:
1. Build and sign the APK (see [`DEVELOPMENT.md`](../DEVELOPMENT.md)).
2. Update `aggiornamento.json` next to this file: `versionCode`, `versione` (version), `apk` (file name), its `sha256` fingerprint and `novita` (what's new, shown in the app).
   Also add the English release notes of the new version to `rilasci/release-notes.json` on the `rilasci` branch: GitHub Releases are published in English only.
3. Put the APK and `aggiornamento.json` on the **`rilasci`** branch: its automation creates the `vX.Y.Z` Release with both files by itself
   (or, by hand: **Releases → Draft a new release**, tag `vX.Y.Z`, and attach the two files).

Installed copies of DoctorWood find the new version by themselves within a week
(or at once with Impostazioni → Aggiornamenti → «Controlla adesso»), tablets included, and install it after Android asks for confirmation.
