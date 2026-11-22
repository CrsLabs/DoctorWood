# Ramo «rilasci»

Questo ramo serve solo a pubblicare le versioni di DoctorWood: il codice sta nel ramo `main`.

Quando qui arrivano un APK firmato e il suo `rilasci/aggiornamento.json`, l'automazione
`.github/workflows/rilascio.yml` controlla l'impronta dell'APK e crea da sola la Release `vX.Y.Z`
con i due file allegati. Le app installate la trovano con il controllo degli aggiornamenti.
