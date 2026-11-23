# «rilasci» (releases) branch

This branch is only used to publish DoctorWood versions: the code is on the `main` branch.

When a signed APK and its `rilasci/aggiornamento.json` arrive here, the `.github/workflows/rilascio.yml`
automation checks the APK's fingerprint and creates the `vX.Y.Z` Release by itself, with both files attached.
Installed apps find it through their update check.
