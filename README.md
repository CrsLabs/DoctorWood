# «rilasci» (releases) branch

This branch is only used to publish DoctorWood versions: the code is on the `main` branch.

When a signed APK and its `rilasci/aggiornamento.json` arrive here, the `.github/workflows/rilascio.yml`
automation checks the APK's fingerprint and creates the `vX.Y.Z` Release by itself, with both files attached.
Installed apps find it through their update check.

Release notes on GitHub are in English and come from `rilasci/release-notes.json` (one entry per version, `"vX.Y.Z": "..."`): add the new version's entry with every release. The automation also rewrites the notes of the Releases already published from that file. The `novita` field of `aggiornamento.json` is the Italian text the app shows (translated in the app when it is in English).
