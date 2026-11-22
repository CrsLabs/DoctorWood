# Prove automatiche di DoctorWood

Servono Node e Playwright (con Chromium). Prima si avviano due server locali, dalla cartella del progetto:

```
python3 prepara.py
python3 -m http.server 8766 --bind 127.0.0.1 &          # pagina web (sorgente-DoctorWood.html)
python3 -m http.server 8765 --bind 127.0.0.1 -d www &   # pagina dell'app Android (www/index.html)
```

Poi, nell'ordine:

| Prova | Cosa fa | Comando |
|---|---|---|
| `azioni.py` | Controllo statico: ogni `data-click` e ogni `az(...)` ha la sua voce in `AZIONI` (un tasto senza voce non fa niente). | `python3 prove/azioni.py` |
| `guida-passi.js` | Nuovo lavoro e nuovo preventivo guidati (passi, scelte, creazione). | `node prove/guida-passi.js` |
| `correzioni2.js` | Controlli su P.IVA, codice fiscale, IBAN, email e telefono; conferma all'uscita dai percorsi guidati; sequenza rilievo/preventivo/taglio; preventivo che si svuota. | `node prove/correzioni2.js` |
| `notifiche.js` | I messaggi si chiudono scorrendoli e non bloccano i comandi sotto. | `node prove/notifiche.js` |
| `rilievo-scarta.js` | «Non salvare» nel Rilievo riporta tutto com'era. | `node prove/rilievo-scarta.js` |
| `schiena.js` | Da modello: schiena su foglio a parte e avviso scorte. | `node prove/schiena.js` |
| `scenari.js` | Percorso da utente vero (solo tocchi): primo avvio, lavoro, cliente, preventivo, magazzino, agenda, schede, taglio, rilievo, backup cifrato andata e ritorno, Laboratorio con PIN, Impostazioni. Salva `risultati/dati-realistici.json`, che serve al robot. | `node prove/scenari.js` |
| `robot.js` | Preme **tutti** i tasti visibili di ogni sezione e finestra (anche dentro le finestre che si aprono), con conferme accettate e rifiutate. Segnala errori, comandi mancanti, blocchi, pagine che sbordano, iniezioni. | `node prove/robot.js <combinazione>` (senza argomento elenca le combinazioni) |
| `file.js` | File in entrata: foto e PDF nelle schede, logo, immagini rotte, backup finti; salvataggi su Android. | `node prove/file.js` |
| `primo.js` | Android simulato: primo avvio da Titolare (password + impronta), passaggio in Laboratorio, «Cancella tutto». | `node prove/primo.js` |
| `diretta.js` | Sincronizzazione **diretta** (PairWood) tra telefono del titolare e tablet simulati: scelta del modo, codice, codice sbagliato, abbinamento, file cifrati, spunte e lavori che viaggiano da soli, estraneo rifiutato, «Dispositivi abbinati» e «Dimentica», «Scollega», «Cambia codice» e riabbinamento, tablet sempre in ascolto (orario predefinito, orario scritto a mano, orario sbagliato, «Spegni», richiesta della batteria), avvisi «nessuno raggiungibile» e «non si sente da giorni», nessuna rete dalla pagina. | `node prove/diretta.js` |
| `combinazioni.js` | Sincronizzazione in **tutte le combinazioni**: diretta o cartella × 1 o 2 tablet × comincia il titolare o il tablet; lavori verso ogni tablet, spunte da ogni tablet, riavvio di tutti i dispositivi a metà, file orfano illeggibile. (`SOLO=diretta,2,true` per una sola) | `node prove/combinazioni.js` |
| `pratica.js` | **Praticità** di ogni schermata (titolare web e Android, laboratorio) su telefono da 320 px, telefono, tablet e PC: tasti piccoli, senza nome, campi senza etichetta, tasti coperti anche dopo lo scorrimento, testo < 11 px, debordi. (`TUTTI=1` per l'elenco completo; `TESTO=115` o `TESTO=130` per il testo Grande / Molto grande: nell'app si simula lo zoom del testo di Android) | `node prove/pratica.js` |
| `testo.js` | **Dimensione del testo**: scelta dalle Impostazioni, zoom sul PC, nessuno zoom della pagina su telefono e nell'app, comando ad Android all'avvio e alla scelta, barra compensata; scritte grandi del Laboratorio. | `node prove/testo.js` |
| `solo-lab.js` | Tablet «solo laboratorio» al primo avvio (web e app) e **cosa arriva sul tablet**: solo le voci ammesse, nessun prezzo, telefono, email, P.IVA o nota dei clienti. | `node prove/solo-lab.js` |
| `aggiornamenti.js` | Aggiornamenti da GitHub (app simulata): voce nelle Impostazioni, «Controlla adesso», «Aggiorna», domanda settimanale e «Più tardi», controllo spento, tablet del laboratorio che non si rifissa durante l'installazione. | `node prove/aggiornamenti.js` |
| `veleno.js` | Dati «avvelenati» con HTML in ogni campo: niente deve prendere vita. | `node prove/veleno.js http://localhost:8766/sorgente-DoctorWood.html` |

Esito atteso: 0 falliti, nessun errore in pagina. Le parti native (impronta, Keystore, fotocamera, cartelle, stampa)
si provano solo sul telefono.
