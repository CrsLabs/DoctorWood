    // ======================================================================
    // ===== DoctorWood come app Android (Capacitor) =====
    // Questo blocco si attiva SOLO dentro l'app Android: nel browser non fa niente e la pagina
    // funziona esattamente come prima.
    //  1. Laboratorio cifrato con l'impronta del titolare (Android Keystore + AES-256-GCM)
    //  2. File: «Salva come» di Android, PDF aperti con l'app del telefono, menu Condividi, stampa
    // ======================================================================
    (function () {
      'use strict';
      const CAP = window.Capacitor;
      if (!CAP || typeof CAP.isNativePlatform !== 'function' || !CAP.isNativePlatform()) return;
      document.documentElement.classList.add('app-android');
      const nat = (metodo, opz) => CAP.nativePromise('Cassaforte', metodo, opz || {});
      window.__apriLink = url => nat('apriLink', { url });
      document.documentElement.classList.add('con-sostieni');

      // ---------- barra di stato e bordi dello schermo ----------
      // Android disegna l'app anche sotto la barra di stato (ora, batteria) e sotto la fotocamera:
      // l'intestazione, gli avvisi in alto e le finestre fanno spazio. Capacitor passa le misure sia come
      // env(safe-area-inset-*) sia come --safe-area-inset-*: si usa la più grande, così non si somma mai due volte.
      const bordo = lato => `max(env(safe-area-inset-${lato}, 0px), var(--safe-area-inset-${lato}, 0px))`;
      const stileBordi = document.createElement('style');
      stileBordi.textContent = `
        header { padding-top: calc(0.75rem + ${bordo('top')}) !important; padding-left: calc(1rem + ${bordo('left')}) !important; padding-right: calc(1rem + ${bordo('right')}) !important; }
        #avvisoGuardia { top: calc(12px + ${bordo('top')}) !important; }
        [id^=modal].fixed.inset-0, div[role="dialog"].fixed.inset-0 { padding-top: calc(1rem + ${bordo('top')}); }
        body { padding-left: ${bordo('left')}; padding-right: ${bordo('right')}; }`;
      document.head.appendChild(stileBordi);
      // barra di stato e barra in basso: stesso colore della parte alta della pagina, icone scure sul chiaro e chiare sul
      // tema scuro (uguale in DoctorCar, DoctorWood e BothWise); si rifà dopo il cambio di tema e al ritorno nell'app
      const coloreInAlto = () => {
        for (let el = document.elementFromPoint(innerWidth / 2, 2); el; el = el.parentElement) {
          const m = (getComputedStyle(el).backgroundColor || '').match(/[\d.]+/g);
          if (m && m.length >= 3 && !(m.length >= 4 && Number(m[3]) < 0.9)) return '#' + m.slice(0, 3).map(x => Math.round(+x).toString(16).padStart(2, '0')).join('');
        }
        return '';
      };
      const coloreBarre = () => {
        const chiaro = document.documentElement.getAttribute('data-tema') === 'chiaro';
        requestAnimationFrame(() => { nat('barre', { chiaro, colore: coloreInAlto() }).catch(() => {}); });
      };
      coloreBarre(); [400, 1500, 4000].forEach(ms => setTimeout(coloreBarre, ms));
      new MutationObserver(coloreBarre).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') coloreBarre(); });

      // ---------- byte e base64 ----------
      const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
      const byte = t => { const s = atob(t), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; };
      const casuali = n => crypto.getRandomValues(new Uint8Array(n));
      const testo = new TextEncoder(), daTesto = new TextDecoder();

      // =====================================================================
      // 1. CASSAFORTE DEL LABORATORIO
      // Passando in Laboratorio, i dati del titolare vengono cifrati con una chiave K (AES-256-GCM, WebCrypto)
      // e cancellati in chiaro. K è conservata due volte, sempre cifrata:
      //   - con la chiave del Keystore di Android, utilizzabile solo dopo l'impronta del titolare;
      //   - con la password di emergenza (PBKDF2-SHA-256, 600.000 iterazioni), se l'impronta non va più
      //     (sensore rotto, impronte cambiate: Android cancella la chiave quando se ne registra una nuova).
      // Senza impronta o password, sul dispositivo restano solo byte cifrati.
      // =====================================================================
      const K_CASSA = 'doctorwood_cassaforte';          // { v, iv, dati } = i dati del titolare, cifrati con K
      const K_CHIAVI = 'doctorwood_cassaforte_chiavi';  // { v, impronta: {iv, dati}, emergenza: {sale, iterazioni, iv, dati} }
      const ITERAZIONI = 600000;
      const LASCIATE = new Set(['schede', 'schede_categorie']);   // le schede di montaggio servono al laboratorio
      const DA_CIFRARE = CHIAVI_BACKUP.filter(k => !LASCIATE.has(k) && !CHIAVI_IMPOSTAZIONI.has(k))
        .concat(['doctorwood_segreto_lab', 'doctorwood_bozze', 'rilievo_corrente']);
      const SET_CIFRATE = new Set(DA_CIFRARE);

      const S = window.localStorage;
      const leggi = k => { try { return JSON.parse(S.getItem(k)); } catch (_) { return null; } };
      const cassaPresente = () => { const c = leggi(K_CASSA); return !!(c && c.v === 1 && c.iv && c.dati); };

      // In Laboratorio, con la cassaforte chiusa, nessun codice della pagina può riscrivere in chiaro i dati
      // del titolare (salvataggi automatici, bozze, rilievi in memoria). Solo lo sblocco può farlo.
      // Lo stesso vale subito dopo chiusura e apertura, fino al ricaricamento della pagina: i salvataggi automatici
      // all'uscita (bozze, rilievi) non devono rimettere in chiaro né cancellare i dati appena sistemati.
      let sbloccoInCorso = false, chiusuraInCorso = false, aperturaFatta = false;
      const setItemOrig = Storage.prototype.setItem, removeItemOrig = Storage.prototype.removeItem;
      const bloccata = (st, k) => st === S && SET_CIFRATE.has(k) && !sbloccoInCorso &&
        (chiusuraInCorso || aperturaFatta || (cassaPresente() && S.getItem('doctorwood_modalita') === 'laboratorio'));
      Storage.prototype.setItem = function (k, v) {
        if (bloccata(this, k)) { console.warn('Cassaforte: scrittura ignorata di', k); return; }
        return setItemOrig.call(this, k, v);
      };
      Storage.prototype.removeItem = function (k) {
        if (bloccata(this, k)) { console.warn('Cassaforte: cancellazione ignorata di', k); return; }
        return removeItemOrig.call(this, k);
      };

      // ---------- cifratura ----------
      async function chiaveAes(raw) { return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }
      async function cifraCon(raw, chiaro) {
        const iv = casuali(12);
        const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: testo.encode('doctorwood-cassaforte-1') }, await chiaveAes(raw), chiaro);
        return { iv: b64(iv), dati: b64(new Uint8Array(c)) };
      }
      async function decifraCon(raw, busta) {
        const c = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: byte(busta.iv), additionalData: testo.encode('doctorwood-cassaforte-1') }, await chiaveAes(raw), byte(busta.dati));
        return new Uint8Array(c);
      }
      async function chiaveDaPassword(pw, sale, iterazioni) {
        const base = await crypto.subtle.importKey('raw', testo.encode(pw), 'PBKDF2', false, ['deriveBits']);
        return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: sale, iterations: iterazioni, hash: 'SHA-256' }, base, 256));
      }
      async function avvolgiConPassword(K, pw) {
        const sale = casuali(16), kp = await chiaveDaPassword(pw, sale, ITERAZIONI);
        return Object.assign({ sale: b64(sale), iterazioni: ITERAZIONI }, await cifraCon(kp, K));
      }
      async function svolgiConPassword(e, pw) {
        const kp = await chiaveDaPassword(pw, byte(e.sale), Number(e.iterazioni) || ITERAZIONI);
        return decifraCon(kp, e);   // password sbagliata: errore di AES-GCM
      }
      // modo «impronta» (di serie) oppure «sequenza»: sui dispositivi senza impronta la chiave si apre con la sequenza,
      // il PIN o la password del dispositivo
      async function avvolgiConImpronta(K, sottotitolo, modo) {
        return nat(modo === 'sequenza' ? 'cifraSequenza' : 'cifra', { dati: b64(K), titolo: 'Cassaforte DoctorWood', sottotitolo: modo === 'sequenza' ? sottotitolo.replace(/Appoggia il dito/, 'Sequenza o PIN') : sottotitolo });
      }
      async function svolgiConImpronta(e, sottotitolo, modo) {
        const r = await nat(modo === 'sequenza' ? 'decifraSequenza' : 'decifra', { iv: e.iv, dati: e.dati, titolo: 'Cassaforte DoctorWood', sottotitolo: modo === 'sequenza' ? sottotitolo.replace(/Appoggia il dito/, 'Sequenza o PIN') : sottotitolo });
        return byte(r.dati);
      }
      async function statoImpronta() { try { return await nat('stato'); } catch (_) { return { biometria: 'non_disponibile', chiave: false, sequenza: false }; } }
      // con che cosa si può chiudere la cassaforte su questo dispositivo: impronta, altrimenti sequenza/PIN, altrimenti niente
      const modoDisponibile = st => st && st.biometria === 'pronta' ? 'impronta' : st && st.sequenza ? 'sequenza' : null;
      // senza impronta si usa il blocco del dispositivo: va bene solo se lo conosce soltanto il titolare
      async function confermaSequenza() {
        const r = await finestra({ titolo: 'Senza impronta: la sequenza',
          testoMsg: 'Questo dispositivo non ha l\'impronta: i dati del titolare si cifrano con la sequenza (o il PIN o la password) che sblocca il dispositivo.\n\nAttenzione: chi conosce quella sequenza può riaprire i dati del titolare. Se in laboratorio la conoscono anche altri, cambiala prima con una che sai solo tu (Impostazioni di Android → Sicurezza → Blocco schermo).',
          si: 'La conosco solo io: continua', alt: 'Apri le impostazioni di Android' });
        if (r.esito === 'alt') { try { await nat('apriImpostazioniImpronte'); } catch (_) {} return false; }
        return r.esito === 'si';
      }

      // ---------- la finestra della cassaforte (classi già presenti nella pagina) ----------
      const fin = document.createElement('div');
      fin.id = 'modalCassaforte';
      fin.className = 'fixed inset-0 bg-slate-950/90 backdrop-blur-sm z-50 flex items-center justify-center p-4 hidden';
      fin.setAttribute('role', 'dialog'); fin.setAttribute('aria-modal', 'true'); fin.setAttribute('aria-labelledby', 'cassaTitolo');
      fin.style.zIndex = '70';
      fin.innerHTML = `
        <div class="bg-slate-800 border border-slate-700 rounded-xl max-w-sm w-full p-5 space-y-3">
          <h3 id="cassaTitolo" class="text-sm font-bold text-amber-500"></h3>
          <p id="cassaTesto" class="text-xs text-slate-300" style="white-space:pre-line"></p>
          <p id="cassaEvidenza" class="hidden text-center font-bold text-amber-400" style="font-size:20px;letter-spacing:.08em;font-family:ui-monospace,monospace;word-break:break-all;user-select:all"></p>
          <div id="cassaQr" class="hidden flex justify-center"></div>
          <input type="password" id="cassaPw1" autocomplete="new-password" class="hidden w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-center text-lg text-white" aria-label="Password di emergenza">
          <input type="password" id="cassaPw2" autocomplete="new-password" class="hidden w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-center text-lg text-white" aria-label="Ripeti la password">
          <p id="cassaErrore" class="hidden text-xs text-rose-300 font-semibold" aria-live="polite"></p>
          <div class="flex flex-col gap-2">
            <button type="button" id="cassaSi" class="w-full bg-amber-600 hover:bg-amber-500 text-slate-900 font-bold py-2.5 rounded-lg text-sm"></button>
            <button type="button" id="cassaAlt" class="hidden w-full text-xs font-semibold text-sky-300 underline" style="min-height:40px"></button>
            <button type="button" id="cassaNo" class="w-full bg-slate-900 border border-slate-700 text-slate-300 py-2.5 rounded-lg text-sm">Annulla</button>
          </div>
        </div>`;
      document.body.appendChild(fin);
      const $ = id => document.getElementById(id);
      // input numerico o testo: la password di emergenza può avere lettere
      ['cassaPw1', 'cassaPw2'].forEach(id => $(id).setAttribute('placeholder', id === 'cassaPw1' ? 'Password' : 'Ripeti la password'));

      // mostra la finestra e risolve con 'si' | 'alt' | 'no' (e le password scritte)
      // il QR del codice di abbinamento: i moduli li calcola PairWood (nostro, senza librerie); qui si disegnano in SVG
      function svgQr(righe) {
        const n = righe.length, m = 4, lato = n + 2 * m;
        let r = '';
        righe.forEach((riga, y) => [...String(riga)].forEach((b, x) => { if (b === '1') r += `M${x + m} ${y + m}h1v1h-1z`; }));
        return `<svg viewBox="0 0 ${lato} ${lato}" width="200" height="200" role="img" aria-label="Codice QR" style="background:#fff;border-radius:12px;shape-rendering:crispEdges"><path d="${r}" fill="#000"/></svg>`;
      }
      function finestra({ titolo, testoMsg, si, alt, no = 'Annulla', password = 0, errore = '', evidenza = '', campo = 'password', segnaposto = '', qr = null, codice = false }) {
        return new Promise(risolvi => {
          $('cassaQr').innerHTML = qr ? svgQr(qr) : ''; $('cassaQr').classList.toggle('hidden', !qr);
          $('cassaTitolo').textContent = titolo;
          $('cassaTesto').textContent = testoMsg;
          $('cassaSi').textContent = si;
          $('cassaAlt').textContent = alt || ''; $('cassaAlt').classList.toggle('hidden', !alt);
          $('cassaNo').textContent = no; $('cassaNo').classList.toggle('hidden', !no);
          const p1 = $('cassaPw1'), p2 = $('cassaPw2');
          p1.value = ''; p2.value = '';
          // campo di testo (es. un codice da ricopiare) oppure password
          p1.type = campo === 'testo' ? 'text' : 'password';
          p1.setAttribute('autocapitalize', campo === 'testo' ? 'characters' : 'off');
          p1.setAttribute('placeholder', segnaposto || 'Password');
          // codice di abbinamento: maiuscole e un trattino ogni 4 caratteri mentre si scrive
          p1.maxLength = codice ? 24 : 524288;
          p1.style.fontFamily = codice ? 'ui-monospace,monospace' : '';
          p1.oninput = codice ? () => {
            const inFondo = p1.selectionStart === p1.value.length;
            const nuovo = (pulisciCodice(p1.value).slice(0, 20).match(/.{1,4}/g) || []).join('-');
            if (nuovo !== p1.value) { p1.value = nuovo; if (inFondo) p1.setSelectionRange(nuovo.length, nuovo.length); }
          } : null;
          $('cassaEvidenza').textContent = evidenza; $('cassaEvidenza').classList.toggle('hidden', !evidenza);
          p1.classList.toggle('hidden', password < 1); p2.classList.toggle('hidden', password < 2);
          $('cassaErrore').textContent = errore; $('cassaErrore').classList.toggle('hidden', !errore);
          fin.classList.remove('hidden');
          if (password) setTimeout(() => p1.focus(), 50);
          const fine = esito => {
            fin.classList.add('hidden');
            ['cassaSi', 'cassaAlt', 'cassaNo'].forEach(id => { $(id).onclick = null; });
            p1.onkeydown = p2.onkeydown = p1.oninput = null;
            risolvi({ esito, pw1: p1.value, pw2: p2.value });
            p1.value = ''; p2.value = '';
          };
          $('cassaSi').onclick = () => fine('si');
          $('cassaAlt').onclick = () => fine('alt');
          $('cassaNo').onclick = () => fine('no');
          p1.onkeydown = p2.onkeydown = e => { if (e.key === 'Enter') fine('si'); };
        });
      }
      function attesa(titolo, testoMsg) {
        $('cassaTitolo').textContent = titolo; $('cassaTesto').textContent = testoMsg;
        ['cassaPw1', 'cassaPw2', 'cassaErrore', 'cassaAlt', 'cassaNo', 'cassaEvidenza'].forEach(id => $(id).classList.add('hidden'));
        $('cassaSi').textContent = 'Attendi…'; $('cassaSi').onclick = null;
        fin.classList.remove('hidden');
      }
      const chiudiAttesa = () => fin.classList.add('hidden');

      // ---------- password di emergenza ----------
      async function chiediNuovaPassword() {
        let errore = '';
        for (;;) {
          const r = await finestra({
            titolo: 'Password di emergenza',
            testoMsg: 'Serve se un giorno l\'impronta non funziona (sensore rotto, impronte cambiate).\n\nAlmeno 12 caratteri: va benissimo una frase di qualche parola. Scrivila e conservala in un posto sicuro, lontano dal tablet: senza impronta e senza questa password i dati cifrati non si recuperano (resta solo il backup).',
            si: 'Continua', password: 2, errore });
          if (r.esito !== 'si') return null;
          const problema = problemaPassword(r.pw1);   // la stessa regola dei backup
          if (problema) { errore = problema; continue; }
          if (r.pw1 !== r.pw2) { errore = 'Le due password non sono uguali.'; continue; }
          return r.pw1;
        }
      }
      async function chiediPasswordEmergenza(chiavi, perche) {
        let errore = '';
        for (;;) {
          const r = await finestra({ titolo: 'Password di emergenza', testoMsg: perche, si: 'Sblocca', password: 1, errore });
          if (r.esito !== 'si') return null;
          if (!r.pw1) { errore = 'Scrivi la password.'; continue; }
          attesa('Password di emergenza', 'Controllo la password…');
          try { const K = await svolgiConPassword(chiavi.emergenza, r.pw1); chiudiAttesa(); return K; }
          catch (_) {
            chiudiAttesa();
            try { registraTentativo(); } catch (_) {}
            if (typeof vibra === 'function') vibra('errore');
            errore = 'Password sbagliata.';
            await new Promise(ok => setTimeout(ok, 1500));   // rallenta i tentativi a caso
          }
        }
      }
      // Android non sa di chi è un'impronta: passa qualunque dito registrato sul dispositivo.
      // Prima di collegare l'impronta alla cassaforte il titolare controlla che ci siano solo le sue.
      // (Le impronte aggiunte DOPO annullano da sole la chiave: lì serve la password di emergenza.)
      async function controllaImpronte(motivo) {
        for (;;) {
          const r = await finestra({ titolo: 'Solo le tue impronte',
            testoMsg: (motivo ? motivo + '\n\n' : '') + 'Android accetta QUALUNQUE impronta registrata su questo dispositivo, non sa di chi è.\n\nControlla nelle impostazioni di Android (Sicurezza → Impronte) che ci siano soltanto le tue: se c\'è anche quella di un collaboratore, toglila prima di continuare.',
            si: 'Ho controllato: ci sono solo le mie', alt: 'Apri le impostazioni delle impronte' });
          if (r.esito === 'si') return true;
          if (r.esito !== 'alt') return false;
          try { await nat('apriImpostazioniImpronte'); } catch (_) {}
        }
      }
      // l'impronta di K si rifà quando Android ha cancellato la chiave (impronte cambiate)
      async function rifaiImpronta(chiavi, K) {
        const modo = modoDisponibile(await statoImpronta());
        if (!modo) return false;
        const ok = modo === 'impronta' ? await controllaImpronte('Le impronte del dispositivo sono cambiate da quando hai attivato la cassaforte.') : await confermaSequenza();
        if (!ok) { chiavi.impronta = null; setItemOrig.call(S, K_CHIAVI, JSON.stringify(chiavi)); return false; }
        try { await nat('eliminaChiave', { modo }); } catch (_) {}
        try { chiavi.impronta = await avvolgiConImpronta(K, 'Appoggia il dito per collegare di nuovo l\'impronta', modo); chiavi.modo = modo; }
        catch (_) { chiavi.impronta = null; }
        setItemOrig.call(S, K_CHIAVI, JSON.stringify(chiavi));
        return !!chiavi.impronta;
      }

      // ottiene K: con l'impronta, oppure con la password di emergenza
      async function prendiK(chiavi, perche) {
        if (chiavi.impronta) {
          try { return await svolgiConImpronta(chiavi.impronta, perche, chiavi.modo); }
          catch (e) {
            const codice = e && e.code;
            if (codice === 'ANNULLATO') {
              const r = await finestra({ titolo: 'Impronta', testoMsg: 'Impronta annullata.', si: 'Riprova con l\'impronta', alt: 'Usa la password di emergenza' });
              if (r.esito === 'si') return prendiK(chiavi, perche);
              if (r.esito !== 'alt') return null;
            } else if (codice === 'CHIAVE_INVALIDATA') {
              await finestra(chiavi.modo === 'sequenza'
                ? { titolo: 'Blocco del dispositivo cambiato', testoMsg: 'Il blocco del dispositivo (sequenza, PIN o password) è stato tolto o cambiato: per sicurezza Android ha annullato la chiave.\n\nSblocca con la password di emergenza; poi la cassaforte si collega di nuovo.', si: 'Continua', no: '' }
                : { titolo: 'Impronte cambiate', testoMsg: 'Sul dispositivo è stata aggiunta o tolta un\'impronta: per sicurezza Android ha annullato la chiave dell\'impronta.\n\nSblocca con la password di emergenza; poi l\'impronta si collega di nuovo.', si: 'Continua', no: '' });
              chiavi.impronta = null;
            } else if (codice === 'BLOCCATO') {
              await finestra({ titolo: 'Sensore bloccato', testoMsg: 'Troppi tentativi con l\'impronta: Android ha bloccato il sensore per un po\'. Puoi usare la password di emergenza.', si: 'Continua', no: '' });
            } else if (codice === 'NON_DISPONIBILE') {
              await finestra({ titolo: 'Impronta non disponibile', testoMsg: 'Il sensore non è disponibile o non ci sono impronte registrate su Android. Usa la password di emergenza.', si: 'Continua', no: '' });
            } else {
              await finestra({ titolo: 'Impronta', testoMsg: 'Impronta non riuscita' + (e && e.message ? ': ' + e.message : '') + '.', si: 'Continua', no: '' });
            }
          }
        }
        const K = await chiediPasswordEmergenza(chiavi, 'Scrivi la password di emergenza del titolare.');
        if (K && !chiavi.impronta) {
          const st = await statoImpronta();
          if (modoDisponibile(st)) await rifaiImpronta(chiavi, K);
        }
        return K;
      }

      // ---------- punti di ripristino (copie automatiche nel database interno): anche loro nella cassaforte ----------
      // Passando in Laboratorio si cifrano tutti in un solo record (senza «ts», quindi la pagina non lo vede come punto)
      // e si tolgono quelli in chiaro; tornando Titolare si rimettono com'erano.
      const ID_PUNTI = '__cassaforte__';
      const tuttiIPunti = () => conDbRipristino('readonly', st => richiestaDb(st.getAll()));
      async function chiudiPunti(K) {
        const tutti = await tuttiIPunti();
        const vecchio = tutti.find(p => p && p.id === ID_PUNTI);
        let punti = tutti.filter(p => p && p.id !== ID_PUNTI);
        if (vecchio && vecchio.cifrato) punti = JSON.parse(daTesto.decode(await decifraCon(K, vecchio.cifrato))).concat(punti);   // rimasti da una volta precedente
        if (!punti.length) return [];
        const chiaro = JSON.stringify(punti);
        const cifrato = await cifraCon(K, testo.encode(chiaro));
        if (daTesto.decode(await decifraCon(K, cifrato)) !== chiaro) throw new Error('verifica dei punti di ripristino non riuscita');
        await conDbRipristino('readwrite', st => { st.put({ id: ID_PUNTI, cifrato }); punti.forEach(p => { if (p.id !== ID_PUNTI) st.delete(p.id); }); });
        return punti;
      }
      async function rimettiPunti(punti) {
        if (punti && punti.length) await conDbRipristino('readwrite', st => { punti.forEach(p => st.put(p)); st.delete(ID_PUNTI); });
      }
      async function apriPunti(K) {
        const rec = await conDbRipristino('readonly', st => richiestaDb(st.get(ID_PUNTI)));
        if (!rec || !rec.cifrato) return;
        await rimettiPunti(JSON.parse(daTesto.decode(await decifraCon(K, rec.cifrato))));
      }

      // ---------- password di emergenza + impronta (una volta sola) ----------
      // Restituisce { chiavi, K } oppure null se annullato. Le chiavi si salvano solo chi chiama lo decide.
      async function creaChiavi(modo = 'impronta') {
        if (modo === 'impronta' ? !await controllaImpronte('') : !await confermaSequenza()) return null;
        const pw = await chiediNuovaPassword();
        if (!pw) return null;
        const K = casuali(32);
        attesa('Cassaforte', 'Preparo la cassaforte…');
        const emergenza = await avvolgiConPassword(K, pw);
        chiudiAttesa();
        try { await nat('eliminaChiave', { modo }); } catch (_) {}
        let impronta;
        try { impronta = await avvolgiConImpronta(K, 'Appoggia il dito per attivare la cassaforte', modo); }
        catch (e) { K.fill(0); await finestra({ titolo: modo === 'sequenza' ? 'Sequenza' : 'Impronta', testoMsg: (modo === 'sequenza' ? 'Sequenza non collegata' : 'Impronta non registrata') + ' nella cassaforte' + (e && e.code === 'ANNULLATO' ? ' (annullata)' : '') + '. Non è cambiato niente.', si: 'Chiudi', no: '' }); return null; }
        return { chiavi: { v: 1, impronta, emergenza, modo }, K };
      }
      const chiaviPronte = () => { const c = leggi(K_CHIAVI); return !!(c && c.v === 1 && c.emergenza); };
      // Al primo avvio da Titolare (e dalle Impostazioni): si preparano subito password di emergenza e impronta,
      // così il passaggio in Laboratorio poi chiede solo il dito.
      async function preparaCassaforte(primoAvvio) {
        if (chiaviPronte() || modoLab()) return;
        const st = await statoImpronta(), modo = modoDisponibile(st);
        if (!modo) {
          const msg = {
            nessuna_impronta: 'Su questo dispositivo non c\'è nessuna impronta registrata (e nemmeno una sequenza o un PIN): registra la tua impronta, o almeno una sequenza, da Impostazioni di Android → Sicurezza.',
            senza_sensore: 'Questo dispositivo non ha il sensore di impronte.',
          }[st.biometria] || 'Il sensore di impronte non è disponibile in questo momento.';
          await finestra({ titolo: 'Proteggi i tuoi dati', testoMsg: msg + '\n\nPassword di emergenza e impronta si potranno impostare dalle Impostazioni (Titolare e laboratorio) o quando passerai in Laboratorio.', si: 'Ho capito', no: '' });
          return;
        }
        const r = await finestra({ titolo: 'Proteggi i tuoi dati',
          testoMsg: (primoAvvio ? 'Prima di iniziare: ' : '') + 'imposta la password di emergenza e collega ' + (modo === 'impronta' ? 'la tua impronta' : 'la sequenza (o il PIN) del dispositivo: qui non c\'è l\'impronta') + '.\n\nServono a cifrare i tuoi dati quando il dispositivo passa in Laboratorio e a riaprirli solo tu. Si fa una volta sola.',
          si: 'Imposta ora', no: 'Più tardi' });
        if (r.esito !== 'si') return;
        const nuove = await creaChiavi(modo);
        if (!nuove) return;
        nuove.K.fill(0);
        setItemOrig.call(S, K_CHIAVI, JSON.stringify(nuove.chiavi));
        try { aggiornaRigheImp(); } catch (_) {}
        avvisoGuardia(modo === 'impronta' ? 'Password di emergenza e impronta impostate.' : 'Password di emergenza e sequenza impostate.', 'ok');
      }

      // ---------- CHIUSURA: Titolare → Laboratorio ----------
      async function chiudiCassaforte() {
        const st = await statoImpronta(), modoOra = modoDisponibile(st);
        const chiaviOra = leggi(K_CHIAVI);
        // le chiavi già fatte decidono il modo (impronta o sequenza); altrimenti quello che il dispositivo permette
        const modo = chiaviOra && chiaviOra.v === 1 && chiaviOra.emergenza && chiaviOra.impronta ? (chiaviOra.modo || 'impronta') : modoOra;
        if (!modo) {
          const msg = {
            nessuna_impronta: 'Su questo dispositivo non c\'è né un\'impronta né una sequenza (o un PIN).\nRegistra la tua impronta, o almeno una sequenza, da Impostazioni di Android → Sicurezza, poi riprova.',
            senza_sensore: 'Questo dispositivo non ha il sensore di impronte.',
          }[st.biometria] || 'Il sensore di impronte non è disponibile in questo momento.';
          const r = await finestra({ titolo: 'Impronta non disponibile', testoMsg: msg + '\n\nPuoi passare in Laboratorio anche senza cifratura: resta solo il PIN, che è un deterrente e non protegge i dati.', si: 'Annulla', alt: 'Passa in Laboratorio senza cifratura', no: '' });
          return r.esito === 'alt' ? 'senza' : 'annullato';
        }
        const ok = await finestra({ titolo: 'Passare in Laboratorio',
          testoMsg: 'Clienti, lavori, preventivi, prezzi, magazzino, agenda e rilievi vengono cifrati con ' + (modo === 'sequenza' ? 'la sequenza (o il PIN) del dispositivo' : 'la tua impronta') + ' e spariscono da questo dispositivo finché non torni Titolare.\n\nIl laboratorio vede solo i lavori in produzione (senza prezzi) e le schede di montaggio. L\'app resta a tutto schermo e fissata: per uscire serve ' + (modo === 'sequenza' ? 'la sequenza' : 'la tua impronta') + ' (o il PIN del Laboratorio).',
          si: 'Cifra e passa in Laboratorio', alt: 'Passa senza fissare l\'app' });
        if (ok.esito !== 'si' && ok.esito !== 'alt') return 'annullato';
        // di serie in Laboratorio l'app resta fissata sullo schermo (Fissa app di Android)
        try { S.setItem('doctorwood_fissa_lab', ok.esito === 'alt' ? 'no' : 'si'); } catch (_) {}

        // K: la prima volta si crea (con la password di emergenza), poi si riprende con l'impronta
        let chiavi = leggi(K_CHIAVI), K = null;
        if (chiavi && chiavi.v === 1 && chiavi.emergenza) {
          K = await prendiK(chiavi, 'Appoggia il dito per cifrare i dati del titolare');
          if (!K) return 'annullato';
          // la cassaforte era con la sequenza e ora il dispositivo ha l'impronta: si passa all'impronta, più sicura
          // (la sequenza la può vedere chi sta accanto; l'impronta no)
          if (chiavi.impronta && chiavi.modo === 'sequenza' && modoOra === 'impronta' && await controllaImpronte('Ora su questo dispositivo c\'è l\'impronta: la cassaforte passa dalla sequenza all\'impronta, più sicura.')) {
            try {
              const nuova = await avvolgiConImpronta(K, 'Appoggia il dito per collegare l\'impronta', 'impronta');
              chiavi.impronta = nuova; chiavi.modo = 'impronta';
              setItemOrig.call(S, K_CHIAVI, JSON.stringify(chiavi));
              try { await nat('eliminaChiave', { modo: 'sequenza' }); } catch (_) {}
            } catch (_) { /* annullato: resta la sequenza */ }
          }
        } else {
          const nuove = await creaChiavi(modo);
          if (!nuove) return 'annullato';
          chiavi = nuove.chiavi; K = nuove.K;
        }

        attesa('Cassaforte', 'Cifro i dati del titolare…');
        let puntiChiusi = null;
        try {
          try { salvaBozze(); } catch (_) {}
          try { salvaSubitoRilievi(); } catch (_) {}
          // i lavori in produzione per il laboratorio, presi ORA dai dati veri (senza prezzi né segreto)
          const labPrima = S.getItem('laboratorio_dati');
          let fotografia = null;
          try { if (leggiLavori().length) { fotografia = datiLabDaLavori(); fotografia.segreto = ''; } } catch (_) {}
          const valori = {};
          DA_CIFRARE.forEach(k => { const v = S.getItem(k); if (v !== null) valori[k] = v; });
          const contenuto = { v: 1, creato: Date.now(), valori, fotografia: !!fotografia, labPrima };
          const chiaro = testo.encode(JSON.stringify(contenuto));
          const cassa = Object.assign({ v: 1 }, await cifraCon(K, chiaro));
          // controllo: si rilegge prima di cancellare qualunque cosa
          const prova = daTesto.decode(await decifraCon(K, cassa));
          if (prova !== daTesto.decode(chiaro)) throw new Error('verifica non riuscita');
          puntiChiusi = await chiudiPunti(K);
          setItemOrig.call(S, K_CHIAVI, JSON.stringify(chiavi));
          setItemOrig.call(S, K_CASSA, JSON.stringify(cassa));
          setItemOrig.call(S, 'doctorwood_modalita', 'laboratorio');
          chiusuraInCorso = true;   // da qui nessun salvataggio automatico riscrive i dati in chiaro
          if (fotografia) setItemOrig.call(S, 'laboratorio_dati', JSON.stringify(fotografia));
          DA_CIFRARE.forEach(k => removeItemOrig.call(S, k));
        } catch (e) {
          chiudiAttesa();
          chiusuraInCorso = false;
          console.error(e);
          if (puntiChiusi) { try { await rimettiPunti(puntiChiusi); } catch (_) {} }
          await finestra({ titolo: 'Cassaforte', testoMsg: 'Cifratura non riuscita: non è stato cancellato niente e resti Titolare.\n\n' + (e && e.name === 'QuotaExceededError' ? 'La memoria del dispositivo è piena: fai un backup e libera spazio.' : String(e && e.message || e)), si: 'Chiudi', no: '' });
          try { S.removeItem(K_CASSA); S.setItem('doctorwood_modalita', 'titolare'); } catch (_) {}
          return 'annullato';
        } finally { K.fill(0); }
        // si riparte da zero: in memoria non resta niente dei dati del titolare (il blu copre il passaggio)
        await veloBlu(true);
        location.replace(location.pathname);
        return 'fatto';
      }

      // ---------- APERTURA: Laboratorio → Titolare ----------
      let aperturaInCorso = false;
      async function apriCassaforte() {
        if (aperturaInCorso) return;
        aperturaInCorso = true;
        try {
          const chiavi = leggi(K_CHIAVI), cassa = leggi(K_CASSA);
          if (!chiavi || !chiavi.emergenza || !cassa) { await finestra({ titolo: 'Cassaforte', testoMsg: 'La cassaforte è rovinata o incompleta. Ripristina l\'ultimo backup del titolare.', si: 'Chiudi', no: '' }); return; }
          const K = await prendiK(chiavi, 'Appoggia il dito del titolare per tornare Titolare');
          if (!K) return;
          let contenuto;
          try { contenuto = JSON.parse(daTesto.decode(await decifraCon(K, cassa))); }
          catch (_) { K.fill(0); await finestra({ titolo: 'Cassaforte', testoMsg: 'I dati cifrati non si aprono (file rovinato). Ripristina l\'ultimo backup del titolare.', si: 'Chiudi', no: '' }); return; }
          sbloccoInCorso = true;
          try {
            DA_CIFRARE.forEach(k => S.removeItem(k));
            Object.keys(contenuto.valori || {}).forEach(k => { if (SET_CIFRATE.has(k)) S.setItem(k, contenuto.valori[k]); });
            if (contenuto.fotografia) { if (contenuto.labPrima == null) S.removeItem('laboratorio_dati'); else S.setItem('laboratorio_dati', contenuto.labPrima); }
            S.setItem('doctorwood_modalita', 'titolare');
            S.removeItem(K_CASSA);   // per ultimo: se qualcosa si interrompe prima, la cassaforte c'è ancora
            aperturaFatta = true;
            // i punti di ripristino, solo ora che i dati sono a posto: se non riesce restano cifrati e si riprovano la prossima volta
            try { await apriPunti(K); } catch (e) { console.warn('Punti di ripristino non riaperti', e); }
          } catch (e) {
            await finestra({ titolo: 'Cassaforte', testoMsg: 'Ripristino non completato (' + (e && e.name === 'QuotaExceededError' ? 'memoria piena' : String(e && e.message || e)) + '). I dati cifrati sono ancora al sicuro: libera spazio e riprova.', si: 'Chiudi', no: '' });
            try { setItemOrig.call(S, 'doctorwood_modalita', 'laboratorio'); } catch (_) {}
            return;
          } finally { sbloccoInCorso = false; K.fill(0); }
          try { await CAP.nativePromise('Laboratorio', 'sbloccaApp'); } catch (_) {}   // si esce da «Fissa app»
          try { await CAP.nativePromise('Laboratorio', 'schermoIntero', { si: false }); } catch (_) {}
          try { sessionStorage.setItem('doctorwood_appena_sbloccato', '1'); } catch (_) {}   // l'impronta è appena stata data
          await veloBlu(true);   // il blu copre il passaggio e sfuma quando l'app è di nuovo pronta
          location.replace(location.pathname);
        } finally { aperturaInCorso = false; }
      }

      // ---------- collegamento alle funzioni della pagina ----------
      const scegliOrig = scegliModalita, impostaOrig = impostaModalita, esciOrig = esciLaboratorio;
      // «senza cifratura» vale per un solo passaggio: dura fino a quando la pagina chiama davvero impostaModalita
      // (anche dopo la finestra del PIN) e si azzera a ogni nuova scelta
      let senzaCifratura = false;
      async function versoLaboratorio(continua) {
        const r = await chiudiCassaforte();
        if (r === 'senza') { senzaCifratura = true; continua(); }
        else if (r === 'annullato' && !modalita()) document.getElementById('modalModalita').classList.remove('hidden');   // al primo avvio si torna alla scelta
      }
      scegliModalita = function (m) {
        senzaCifratura = false;
        if (m === 'titolare' && !modalita()) {   // primo avvio da Titolare: subito password e impronta
          const r = scegliOrig.apply(this, arguments);
          setTimeout(async () => { try { await preparaCassaforte(true); } finally { proponiCartellaDocumenti(); } }, 500);
          return r;
        }
        // primo avvio (la scelta del benvenuto copre tutta l'app: nessun dato del titolare è ancora stato scritto,
        // ci sono solo il listino e il rilievo vuoti di partenza): niente da chiudere in cassaforte
        if (m !== 'titolare' && !modalita()) { senzaCifratura = true; return scegliOrig('laboratorio'); }
        if (m !== 'titolare' && !modoLab()) { chiudiModale('modalModalita'); chiudiModale('modalImpostazioni'); versoLaboratorio(() => scegliOrig('laboratorio')); return; }
        return scegliOrig.apply(this, arguments);
      };
      impostaModalita = function (m) {
        const lab = m !== 'titolare';
        if (lab && !modoLab()) {
          if (senzaCifratura) { senzaCifratura = false; return impostaOrig.apply(this, arguments); }
          versoLaboratorio(() => impostaOrig('laboratorio')); return;
        }
        // tornare Titolare con la cassaforte chiusa (PIN, codice di sblocco o altro): serve l'impronta
        if (!lab && cassaPresente()) { apriCassaforte(); return; }
        if (!lab && modoLab()) { CAP.nativePromise('Laboratorio', 'sbloccaApp').catch(() => {}); CAP.nativePromise('Laboratorio', 'schermoIntero', { si: false }).catch(() => {}); }   // si esce da «Fissa app» e dal tutto schermo
        return impostaOrig.apply(this, arguments);
      };
      esciLaboratorio = function () {
        if (cassaPresente()) { apriCassaforte(); return; }
        return esciOrig.apply(this, arguments);
      };
      // se l'app si era interrotta a metà di una chiusura: completa la cancellazione dei dati in chiaro
      if (cassaPresente() && S.getItem('doctorwood_modalita') === 'laboratorio') DA_CIFRARE.forEach(k => { try { removeItemOrig.call(S, k); } catch (_) {} });
      // cassaforte presente ma modalità Titolare (interruzione a metà di uno sblocco): si finisce lo sblocco
      if (cassaPresente() && S.getItem('doctorwood_modalita') !== 'laboratorio') {
        setItemOrig.call(S, 'doctorwood_modalita', 'laboratorio');
        location.replace(location.pathname);
      }

      // =====================================================================
      // 2. FILE, CONDIVISIONE E STAMPA
      // =====================================================================
      const MIME = { json: 'application/json', txt: 'text/plain', pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', csv: 'text/csv' };
      const mimeDi = (nome, tipo) => (tipo && tipo !== 'application/octet-stream' ? tipo : MIME[String(nome).split('.').pop().toLowerCase()] || 'application/octet-stream');
      async function datiDi(blob) { return b64(new Uint8Array(await blob.arrayBuffer())); }

      // ---------- La cartella dei documenti: tutto in ordine, per sezione e per formato ----------
      // Scelta una volta (dopo aver scelto «Titolare»): ogni PDF, CSV, DXF, foto e backup va da solo nella sua sottocartella
      // («Taglio › PDF», «Preventivi › CSV», «Rilievi › Foto»…), senza chiedere ogni volta dove salvare.
      const SEZIONI_DOC = { jobsTool: 'Lavori', cutOptimizer: 'Taglio', quoteTool: 'Preventivi', photoSurvey: 'Rilievi', schedeTool: 'Schede di montaggio', clientsTool: 'Clienti', magazzinoTool: 'Magazzino', agendaTool: 'Agenda', dashboard: 'Generale' };
      const FORMATI_DOC = { pdf: 'PDF', csv: 'CSV', dxf: 'DXF', jpg: 'Foto', jpeg: 'Foto', png: 'Foto', json: 'Backup', txt: 'Altri file' };
      window.percorsoDocumento = nome => {
        const est = String(nome).split('.').pop().toLowerCase();
        let sezione = SEZIONI_DOC[typeof vistaCorrente === 'string' ? vistaCorrente : ''] || 'Generale';
        if (/backup|dati-clienti|dwsync/i.test(nome)) return ['Backup'];
        return [sezione, FORMATI_DOC[est] || 'Altri file'];
      };
      const leggiDocs = () => { try { const v = JSON.parse(S.getItem('doctorwood_cartella_documenti')); return v && typeof v.uri === 'string' ? v : null; } catch (_) { return null; } };
      let docsVerificata = null;   // l'ultima verifica: { uri, ok, quando }
      async function cartellaDocumenti() {
        const d = leggiDocs(); if (!d) return null;
        if (docsVerificata && docsVerificata.uri === d.uri && Date.now() - docsVerificata.quando < 60000) return docsVerificata.ok ? d : null;
        let ok = false;
        try { const r = await lab('verificaCartella', { uri: d.uri }); ok = !!(r && r.ok); } catch (_) { ok = false; }
        docsVerificata = { uri: d.uri, ok, quando: Date.now() };
        return ok ? d : null;
      }
      window.cartellaDocumentiScelta = () => { const d = leggiDocs(); return d ? d.nome || 'cartella' : ''; };
      window.scegliCartellaDocumenti = async function (conSpiegazione) {
        if (conSpiegazione) {
          const q = await finestra({ titolo: 'Dove tengo i tuoi documenti?', testoMsg: 'Scegli una cartella del telefono (o della scheda SD, o di Drive): ci metto in ordine tutti i documenti, le foto e i dati dei clienti.\n\nDentro creo da solo una sottocartella per ogni sezione (Taglio, Preventivi, Rilievi…) e dentro a ognuna una per formato (PDF, CSV, DXF, Foto…). I backup dei dati dei clienti vanno in «Backup» e sono cifrati con la tua password.\n\nDopo, quando salvi qualcosa, non ti chiedo più dove metterlo.', si: 'Scegli la cartella', no: 'Più tardi' });
          if (q.esito !== 'si') return false;
        }
        let r;
        try { r = await lab('scegliCartella'); } catch (e) { avvisoGuardia('Cartella non scelta: ' + ((e && e.message) || e), 'errore'); return false; }
        if (!r || r.annullato || !r.uri) return false;
        const prec = leggiDocs();
        setItemOrig.call(S, 'doctorwood_cartella_documenti', JSON.stringify({ uri: r.uri, nome: r.nome || 'cartella' }));
        docsVerificata = null;
        if (prec && prec.uri !== r.uri) { try { await lab('dimenticaCartella', { uri: prec.uri }); } catch (_) {} }
        avvisoGuardia(`Documenti: «${r.nome || 'cartella'}». Da ora i file si salvano lì, in ordine.`, 'ok');
        try { aggiornaRigheImp(); } catch (_) {}
        return true;
      };
      // alla prima apertura da Titolare (anche per chi aveva già l'app): si propone una volta di scegliere la cartella dei documenti
      async function proponiCartellaDocumenti() {
        if (S.getItem('doctorwood_docs_chiesto') || leggiDocs() || modoLab()) return;
        setItemOrig.call(S, 'doctorwood_docs_chiesto', 'si');
        await window.scegliCartellaDocumenti(true);
      }
      let provePropostaDocs = 0;
      const pensaAllaProposta = setInterval(() => {
        if (++provePropostaDocs > 40 || S.getItem('doctorwood_docs_chiesto') || leggiDocs()) { clearInterval(pensaAllaProposta); return; }
        if (modoLab() || !S.getItem('doctorwood_modalita')) return;   // prima si sceglie il modo; il primo avvio la propone da solo
        if (document.documentElement.hasAttribute('data-bloccato') || document.documentElement.hasAttribute('data-avvio') || document.querySelector('[id^=modal]:not(.hidden):not(#modalEditNote)')) return;
        clearInterval(pensaAllaProposta); proponiCartellaDocumenti();
      }, 4000);
      window.togliCartellaDocumenti = async function () {
        const d = leggiDocs(); if (!d) return;
        if (!(await chiedi(`Non uso più «${d.nome}» per i documenti?\n\nI file già salvati restano lì: nessuno viene cancellato. Quando salverai qualcosa ti chiederò di nuovo dove metterlo.`))) return;
        try { await lab('dimenticaCartella', { uri: d.uri }); } catch (_) {}
        S.removeItem('doctorwood_cartella_documenti'); docsVerificata = null;
        try { aggiornaRigheImp(); } catch (_) {}
      };

      // Salva un file: nella cartella dei documenti (se c'è), altrimenti «Salva come» di Android; i PDF si aprono subito dopo.
      async function salvaNativo(blob, nome) {
        const mime = mimeDi(nome, blob.type), dati = await datiDi(blob);
        let uri = '', dove = '';
        const docs = await cartellaDocumenti();
        if (docs) {
          try {
            const r = await lab('salvaInCartella', { uri: docs.uri, percorso: window.percorsoDocumento(nome), nome, mime, dati });
            uri = r.uri; dove = `${docs.nome || 'Documenti'}${r.percorso ? ' › ' + r.percorso : ''} › ${r.nome}`;
          } catch (_) { docsVerificata = null; }   // la cartella non risponde più: si chiede dove salvare
        }
        if (!uri) {
          const r = await nat('salvaFile', { nome, mime, dati });
          if (!(r && r.salvato)) return false;
          uri = r.uri || '';
        }
        if (mime === 'application/pdf' && uri) {
          try { await nat('apriUri', { uri, mime }); }
          catch (e) { if (!e || e.code !== 'NESSUNA_APP') throw e; avvisoGuardia('Il PDF è salvato, ma sul telefono non c\'è un\'app per leggerlo.', 'info'); }
        }
        return { salvato: true, dove };
      }
      // la pagina dà il backup per fatto appena chiama scaricaBlob: se poi il salvataggio viene annullato, si torna indietro
      scaricaBlob = function (blob, nome) {
        const primaBackup = S.getItem('ultimoBackup'), primaSchede = S.getItem('ultimoBackupSchede');
        salvaNativo(blob, nome).then(r => {
          if (r && r.salvato) {
            avvisoGuardia(r.dove ? `Salvato in ${r.dove}${/cifrato/.test(nome) ? ' (cifrato)' : ''}.` : `File «${nome}» salvato${/cifrato/.test(nome) ? ' (cifrato)' : ', non cifrato'}. Esce dall'app solo se sei tu a condividerlo o inviarlo.`, 'info');
            return;
          }
          throw Object.assign(new Error('annullato'), { annullato: true });
        }).catch(e => {
          try {
            if (primaBackup === null) S.removeItem('ultimoBackup'); else setItemOrig.call(S, 'ultimoBackup', primaBackup);
            if (primaSchede === null) S.removeItem('ultimoBackupSchede'); else setItemOrig.call(S, 'ultimoBackupSchede', primaSchede);
            if (typeof aggiornaStatoDati === 'function') aggiornaStatoDati();
            if (typeof aggiornaInfoSpazio === 'function') aggiornaInfoSpazio();
          } catch (_) {}
          avvisoGuardia(e && e.annullato ? `Salvataggio annullato: «${nome}» NON è stato salvato.` : `«${nome}» NON salvato: ${(e && e.message) || e}`, 'errore');
        });
      };
      scaricaImmagineRilievo = function () {
        if (indiceFotoAttiva === null) return;
        chiudiModaleNota();
        const nome = `rilievo-cantiere-${indiceFotoAttiva + 1}.jpg`;
        document.getElementById('surveyCanvas').toBlob(b => { if (b) scaricaBlob(b, nome); }, 'image/jpeg', 0.9);
      };

      // menu «Condividi» di Android al posto di quello del browser (che nella WebView non c'è)
      try { limiteCondivisione = 15 * 1048576; } catch (_) {}   // parti più piccole: passano da JavaScript ad Android
      const condividi = async d => {
        if (d && d.files && d.files.length) {
          const f = d.files[0];
          await nat('condividiFile', { nome: f.name, mime: mimeDi(f.name, f.type), dati: await datiDi(f), titolo: d.title || f.name });
        } else if (d && (d.text || d.title)) {
          await nat('condividiFile', { testo: [d.text, d.url].filter(Boolean).join('\n'), titolo: d.title || 'DoctorWood' });
        } else throw new TypeError('Niente da condividere');
      };
      const puoCondividere = d => !!(d && ((d.files && d.files.length === 1) || d.text || d.title));
      try {
        Object.defineProperty(navigator, 'share', { value: condividi, configurable: true });
        Object.defineProperty(navigator, 'canShare', { value: puoCondividere, configurable: true });
      } catch (_) {}

      // Niente stampa: i documenti si esportano in PDF (e negli altri formati) e si condividono o stampano da un'altra app.
      window.print = function () { avvisoGuardia('La stampa non c\'è: usa i tasti PDF (o gli altri formati) e, se serve, stampa il file da un\'altra app.', 'info'); };

      // =====================================================================
      // 3. FISSA APP, FLUIDITÀ DELLO SCHERMO E SINCRONIZZAZIONE TITOLARE ↔ LABORATORIO
      // =====================================================================
      const lab = (metodo, opz) => CAP.nativePromise('Laboratorio', metodo, opz || {});
      // dimensione del testo: nell'app è lo zoom del testo della WebView (Android la ricorda anche alla riapertura)
      window.__testoNativo = v => { lab('dimensioneTesto', { percento: v }).catch(() => {}); };
      try { if (typeof applicaTesto === 'function') applicaTesto(); } catch (_) {}
      const leggiJ = (k, d) => { try { const v = JSON.parse(S.getItem(k)); return v == null ? d : v; } catch (_) { return d; } };
      const scriviJ = (k, v) => { try { S.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } };
      const sha = async t => b64(new Uint8Array(await crypto.subtle.digest('SHA-256', testo.encode(t))));
      const oraBreve = ts => ts ? new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
      const quando = ts => {
        if (!ts) return 'mai';
        const d = new Date(ts), oggi = new Date();
        return d.toDateString() === oggi.toDateString() ? 'alle ' + oraBreve(ts) : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) + ' ' + oraBreve(ts);
      };
      const rigaImp = (id, icona, colore, titolo, interruttore) =>
        `<button type="button" id="${id}" ${interruttore ? 'role="switch" aria-checked="false"' : ''} class="riga-imp w-full flex items-center gap-3 rounded-xl bg-slate-900 border border-slate-700 px-3 text-left">` +
        `<i class="fa-solid ${icona} text-lg ${colore}"></i><span class="flex-1 min-w-0"><span class="block text-sm font-semibold text-white">${titolo}</span>` +
        `<span id="${id}Sotto" class="block text-[11px] text-slate-400"></span></span>${interruttore ? '<span class="interruttore" aria-hidden="true"></span>' : ''}</button>`;

      // ---------- Vibrazione: dal motore del telefono, con l'intensità scelta ----------
      try {
        Object.defineProperty(navigator, 'vibrate', { configurable: true, value: schema => {
          const tempi = (Array.isArray(schema) ? schema : [schema]).map(Number).filter(x => Number.isFinite(x) && x >= 0);
          if (!tempi.length || !tempi.some(x => x > 0)) return true;
          lab('vibra', { tempi, forza: forzaVibrazione() }).catch(() => {});
          return true;
        } });
      } catch (_) {}

      // ---------- Blocco del Titolare: impronta (o PIN del telefono) quando si torna nell'app ----------
      // Vale in modalità Titolare. Non scatta per le uscite chieste dall'app stessa (fotocamera, scelta di file,
      // salvataggio, condivisione, stampa, PDF, impostazioni di Android), a meno di restare fuori più di 10 minuti.
      // uscite verso altre app avviate da noi: valgono per qualche secondo dopo la richiesta
      const USCITE_INTERNE = new Set(['salvaFile', 'apriFile', 'apriUri', 'apriLink', 'condividiFile', 'scegliCartella', 'apriImpostazioniSicurezza', 'apriImpostazioniImpronte']);
      // richieste di impronta/PIN: valgono solo mentre sono sullo schermo (il PIN del telefono apre una schermata di Android)
      const RICHIESTE_IDENTITA = new Set(['verificaIdentita', 'cifra', 'decifra', 'scattaFoto']);   // anche la fotocamera di DoctorWood, finché è aperta
      // L'esenzione dal blocco vale solo per l'uscita che l'app ha chiesto davvero: la richiesta è ancora in corso (scelta di un
      // file, «Salva come») o è finita da pochi secondi (menu Condividi, stampa, apertura di un PDF: Android si apre subito dopo).
      // Prima valeva 15 secondi dall'ultima richiesta: chi usciva poco dopo un salvataggio rientrava senza impronta.
      let uscitaInterna = 0, richiesteAperte = 0, internePendenti = 0, ultimaInternaInizio = 0, ultimaInternaFinita = 0, fuoriPerNoi = false, uscitoAlle = 0, puoBloccare = false, sbloccoT = false;
      const npOrig = CAP.nativePromise.bind(CAP);
      CAP.nativePromise = (pl, m, o) => {
        if (USCITE_INTERNE.has(m)) {
          internePendenti++; ultimaInternaInizio = Date.now();
          return npOrig(pl, m, o).finally(() => { internePendenti = Math.max(0, internePendenti - 1); ultimaInternaFinita = Date.now(); });
        }
        if (!RICHIESTE_IDENTITA.has(m)) return npOrig(pl, m, o);
        richiesteAperte++;
        return npOrig(pl, m, o).finally(() => { setTimeout(() => { richiesteAperte = Math.max(0, richiesteAperte - 1); }, 1500); });
      };
      document.addEventListener('click', e => { if (e.target && e.target.closest && e.target.closest('input[type=file], label')) { const i = e.target.closest('input[type=file]') || (e.target.closest('label') && e.target.closest('label').querySelector('input[type=file]')); if (i) uscitaInterna = Date.now(); } }, true);
      const bloccoScelto = () => S.getItem('doctorwood_blocco_titolare') !== 'no';
      const deveBloccare = () => puoBloccare && bloccoScelto() && !modoLab() && !cassaPresente();
      const blocco = document.createElement('div');
      blocco.id = 'bloccoTitolare';
      blocco.setAttribute('role', 'dialog'); blocco.setAttribute('aria-modal', 'true'); blocco.setAttribute('aria-label', 'DoctorWood bloccato');
      Object.assign(blocco.style, { position: 'fixed', inset: '0', zIndex: '9998', background: '#1e293b', display: 'none', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '18px', padding: '24px', visibility: 'visible' });
      blocco.innerHTML = `<div class="marchio avvio-logo flex items-center justify-center" style="width:96px;height:96px;border-radius:24px"><svg viewBox="8 26 84 52" width="68" height="43" aria-hidden="true"><rect x="11" y="62" width="78" height="11" rx="3" fill="#f59e0b"/><path fill="#f59e0b" fill-rule="evenodd" d="M20 63 C19 48 23 37 32 36 C39 35.5 43 40 41.5 46 L39.5 52 C39 55 39.8 59 42 63 Z M29 47 a3.4 5.6 0 1 0 6.8 0 a3.4 5.6 0 1 0 -6.8 0 Z"/><circle cx="75" cy="50" r="7" fill="#f59e0b"/><rect x="72.5" y="54" width="5" height="9" fill="#f59e0b"/><path d="M48 62.5 L59 31 L66 33.5 L56.5 62.5 Z" fill="#e2e8f0"/></svg></div>` +
        `<div class="avvio-nome" style="font-size:26px;font-weight:800;color:#f1f5f9">Doctor<span style="color:#f59e0b">Wood</span></div>` +
        `<p id="bloccoTesto" style="font-size:13px;color:#94a3b8;text-align:center;max-width:280px;margin:0">Dati del titolare protetti</p>` +
        `<button type="button" id="bloccoSblocca" class="bg-amber-600 text-slate-900 font-bold rounded-lg" style="min-height:48px;padding:0 24px;font-size:15px">Sblocca con l'impronta</button>`;
      document.body.appendChild(blocco);
      function mostraBlocco(si) {
        blocco.style.display = si ? 'flex' : 'none';
        // sotto il blocco la pagina è nascosta davvero (non solo coperta): niente si legge né si preme, nemmeno con una tastiera
        if (si) { document.documentElement.setAttribute('data-bloccato', ''); try { document.activeElement && document.activeElement.blur(); } catch (_) {} }
        else document.documentElement.removeAttribute('data-bloccato');
      }
      let homeEntrata = false;   // l'entrata della Home dopo il primo sblocco, una volta sola
      async function sbloccaTitolare() {
        if (sbloccoT) return;
        sbloccoT = true;
        try {
          await nat('verificaIdentita', { titolo: 'DoctorWood', sottotitolo: 'Sblocca per vedere i dati del titolare' });
          if (blocco.animate && animazioniAttive()) await blocco.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'ease-out' }).finished.catch(() => {});
          mostraBlocco(false);
          $('bloccoTesto').textContent = 'Dati del titolare protetti';
          if (!homeEntrata) { homeEntrata = true; try { animaApertura(); } catch (_) {} }
        } catch (e) {
          $('bloccoTesto').textContent = e && e.code === 'ANNULLATO' ? 'Sblocco annullato.' : 'Sblocco non riuscito: riprova.';
        } finally { sbloccoT = false; }
      }
      $('bloccoSblocca').addEventListener('click', sbloccaTitolare);
      // L'apertura: il logo compare dal centro (2,9 secondi in tutto, non si salta), poi l'impronta se il blocco del
      // Titolare è attivo, poi la schermata sfuma e scopre l'app. Con le animazioni spente il logo resta fermo un attimo.
      // (Nelle prove automatiche dura un istante, salvo quando si prova proprio l'apertura: window.__avvioIntero.)
      const inAvvio = document.documentElement.hasAttribute('data-avvio');
      const durataAvvio = !inAvvio || (navigator.webdriver && !window.__avvioIntero) ? 0 : animazioniAttive() ? 1500 : 700;
      const fineAvvio = new Promise(r => setTimeout(r, Math.max(0, durataAvvio - performance.now())));   // contati dall'apertura della pagina
      async function chiudiAvvio() {
        await fineAvvio;
        const serve = deveBloccare() && (inAvvio ? true : document.documentElement.hasAttribute('data-bloccato'));
        if (inAvvio) { blocco.style.display = 'flex'; document.documentElement.removeAttribute('data-avvio'); }
        if (serve) {
          if (inAvvio) { blocco.classList.add('dopo-avvio'); setTimeout(() => blocco.classList.remove('dopo-avvio'), 900); }
          mostraBlocco(true); sbloccaTitolare(); return;
        }
        if (inAvvio && durataAvvio && blocco.animate && animazioniAttive()) await blocco.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: 'ease-in-out' }).finished.catch(() => {});
        mostraBlocco(false);
        if (inAvvio && durataAvvio) { try { animaApertura(); } catch (_) {} }   // la Home entra adesso, non sotto il logo
      }
      Promise.resolve().then(() => nat('puoSbloccare')).then(r => { puoBloccare = !!(r && r.ok); }).catch(() => {})
        .then(chiudiAvvio).then(() => { try { aggiornaRigheImp(); } catch (_) {} });
      // uscita e rientro: dalla pagina (visibilitychange) e da Android (pausa/ripresa dell'app: scatta anche quando si
      // apre solo l'elenco delle app recenti, dove la pagina non si accorge di niente)
      let inPausa = false;
      const uscitaApp = () => {
        if (inPausa) return;
        inPausa = true; uscitoAlle = Date.now();
        fuoriPerNoi = richiesteAperte > 0 || (internePendenti > 0 && Date.now() - ultimaInternaInizio < 600000) || Date.now() - ultimaInternaFinita < 4000 || Date.now() - uscitaInterna < 6000;
        if (!fuoriPerNoi && deveBloccare()) mostraBlocco(true);   // il telefono mostra già il blu nelle app recenti
      };
      const rientroApp = () => {
        if (inPausa) {
          inPausa = false;
          if (fuoriPerNoi) { fuoriPerNoi = false; if (Date.now() - uscitoAlle > 10 * 60000 && deveBloccare()) mostraBlocco(true); }
        }
        if (blocco.style.display === 'flex') sbloccaTitolare();
      };
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') uscitaApp(); else rientroApp(); });
      window.__pausaApp = uscitaApp; window.__ripresaApp = () => { if (inPausa) rientroApp(); };
      // uscire dalla fotocamera di DoctorWood (tasto Home, app recenti) conta come uscire dall'app: al ritorno chiede l'impronta
      window.__bloccaOra = async () => {
        fuoriPerNoi = false;
        if (!deveBloccare()) return;
        mostraBlocco(true); sbloccaTitolare();
        while (document.documentElement.hasAttribute('data-bloccato')) await new Promise(r => setTimeout(r, 300));
      };

      // ---------- Fotocamera di DoctorWood: «Scatta» apre la nostra (CameraX) invece di quella del telefono ----------
      // Le foto arrivano alla stessa funzione di prima (rilievi, schede), come se le avesse scelte la finestra dei file.
      document.addEventListener('click', e => {
        const input = e.target && e.target.closest && e.target.closest('input[type=file][capture]');
        if (!input) return;
        e.preventDefault(); e.stopImmediatePropagation();
        scattaConFotocamera(input);
      }, true);
      let fotocameraAperta = false;
      async function scattaConFotocamera(input) {
        if (fotocameraAperta) return;
        fotocameraAperta = true;
        let r;
        try { r = await lab('scattaFoto', { massimo: 30 }); }
        catch (err) {
          avvisoGuardia(err && err.code === 'PERMESSO'
            ? 'Per scattare serve il permesso «Fotocamera»: concedilo nelle impostazioni di Android (App → DoctorWood → Autorizzazioni).'
            : 'Fotocamera non disponibile: ' + ((err && err.message) || err), 'errore');
          return;
        } finally { fotocameraAperta = false; }
        if (r && r.uscita) { await window.__bloccaOra(); return; }
        if (!r || r.annullato || !Array.isArray(r.foto) || !r.foto.length) return;
        const files = r.foto.map(f => new File([byte(f.dati)], f.nome, { type: 'image/jpeg', lastModified: Date.now() }));
        const fn = AZIONI[input.getAttribute('data-change')];
        if (fn) fn.call(input, { type: 'change', target: { files, value: '' } }, []);
      }

      // ---------- Fissa app (tablet del laboratorio) ----------
      // In Laboratorio, se scelto, l'app resta fissata sullo schermo: per uscire servono i tasti di Android
      // (e il PIN del tablet, se in Android è attivo «Chiedi il PIN prima di sbloccare»).
      // Dal 2026-11: in Laboratorio l'app è fissata di serie e a tutto schermo; si esce solo con il PIN o l'impronta
      // del titolare (e, uscendo dal fissaggio con i tasti di Android, con il PIN del tablet se è attivo
      // «Chiedi il PIN prima di sbloccare»). Se il fissaggio viene tolto, al ritorno nell'app si rimette.
      const fissaScelta = () => S.getItem('doctorwood_fissa_lab') !== 'no';
      function applicaFissa() {
        if (document.visibilityState !== 'visible') return;
        lab('schermoIntero', { si: modoLab() }).catch(() => {});
        // durante un aggiornamento (permesso e installazione di Android) non si rifissa: Android bloccherebbe l'installazione
        if (modoLab() && fissaScelta() && !(statoAgg.inCorso || Date.now() - statoAgg.installDa < 180000)) lab('fissaApp').catch(() => {});
      }
      document.addEventListener('visibilitychange', applicaFissa);
      setTimeout(applicaFissa, 1500);

      // ---------- Aggiornamenti da GitHub ----------
      // Una volta a settimana (si può spegnere) o con «Controlla adesso». La rete la usa solo la parte nativa
      // (Aggiornamento.java: solo GitHub, solo https, impronta SHA-256 e firma controllate); qui si decide quando chiedere e cosa mostrare.
      // Anche il tablet del laboratorio si aggiorna: la domanda compare lì, e per installare l'app si sgancia da sola dallo schermo.
      const K_AGG = 'doctorwood_aggiornamenti', SETTIMANA = 7 * 864e5;
      const optAgg = () => { let o = null; try { o = JSON.parse(S.getItem(K_AGG)); } catch (_) { } o = o && typeof o === 'object' ? o : {}; return { attivo: o.attivo !== false, ultimo: Number(o.ultimo) || 0, rimandata: String(o.rimandata || '').slice(0, 20), errore: String(o.errore || '').slice(0, 200) }; };
      const salvaAgg = x => { try { S.setItem(K_AGG, JSON.stringify(Object.assign(optAgg(), x))); } catch (_) { } };
      const statoAgg = { trovata: null, inCorso: false, percento: -1, installDa: 0 };
      const mbAgg = n => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
      const quandoAgg = ts => { if (!ts) return 'mai'; const g = Math.floor((Date.now() - ts) / 864e5); return g <= 0 ? 'oggi' : g === 1 ? 'ieri' : g + ' giorni fa'; };
      function disegnaAggiornamenti() {
        const sw = $('impAggiornamenti'); if (!sw) return;
        const o = optAgg(), t = statoAgg.trovata;
        $('catAggiornamenti').classList.remove('hidden');
        sw.setAttribute('aria-checked', String(o.attivo));
        $('aggInstalla').classList.toggle('hidden', !t || statoAgg.inCorso);
        $('aggControlla').disabled = statoAgg.inCorso;
        $('aggStato').textContent = statoAgg.inCorso ? (statoAgg.percento >= 0 ? 'Scarico l\'aggiornamento… ' + statoAgg.percento + '%' : 'Controllo…')
          : t ? 'È uscita DoctorWood ' + t.versione + ' (' + mbAgg(t.dimensione) + ').' + (t.novita ? '\nNovità: ' + t.novita : '')
          : o.errore ? 'Ultimo controllo ' + quandoAgg(o.ultimo) + ': ' + o.errore
          : 'Hai l\'ultima versione. Ultimo controllo: ' + quandoAgg(o.ultimo) + '.' + (o.attivo ? '' : ' Il controllo settimanale è spento.');
        const r = $('catRiass_aggiornamenti');
        if (r) r.textContent = t ? 'Nuova versione ' + t.versione + ' · tocca per installarla' : (o.attivo ? 'Ogni settimana' : 'Controllo spento') + ' · ultimo controllo ' + quandoAgg(o.ultimo);
      }
      // chiede a GitHub; «aMano»: dal tasto (dice sempre com'è andata)
      async function controllaAggiornamenti(aMano) {
        if (statoAgg.inCorso) return statoAgg.trovata;
        statoAgg.inCorso = true; statoAgg.percento = -1; disegnaAggiornamenti();
        let r = null;
        try { r = await nat('controllaAggiornamento'); salvaAgg({ ultimo: Date.now(), errore: '' }); }
        catch (e) { salvaAgg({ ultimo: Date.now(), errore: String((e && e.message) || 'controllo non riuscito').slice(0, 200) }); }
        statoAgg.inCorso = false;
        statoAgg.trovata = r && r.nuova ? { versione: String(r.versione || '').slice(0, 20), novita: String(r.novita || '').slice(0, 1500), dimensione: Number(r.dimensione) || 0 } : null;
        disegnaAggiornamenti();
        if (aMano === true) {
          if (!r) avvisoGuardia(optAgg().errore || 'Controllo non riuscito.', 'errore');
          else if (!statoAgg.trovata) avvisoGuardia('Hai già l\'ultima versione.', 'ok');
        }
        return statoAgg.trovata;
      }
      async function installaAggiornamento() {
        if (!statoAgg.trovata || statoAgg.inCorso) return;
        statoAgg.inCorso = true; statoAgg.percento = 0; statoAgg.installDa = Date.now(); disegnaAggiornamenti();
        attesa('Aggiornamento', 'Scarico DoctorWood ' + statoAgg.trovata.versione + '…');
        try {
          const r = await nat('scaricaAggiornamento');
          chiudiAttesa();
          if (r && r.permesso === false) avvisoGuardia('Senza il permesso di installare app, DoctorWood non può aggiornarsi da sola. Puoi riprovare quando vuoi.', 'errore');
        } catch (e) {
          chiudiAttesa();
          avvisoGuardia((e && e.message) || 'Aggiornamento non riuscito.', 'errore');
        } finally { statoAgg.inCorso = false; statoAgg.percento = -1; disegnaAggiornamenti(); }
      }
      try { CAP.addListener('Cassaforte', 'aggiornamento', x => { statoAgg.percento = Math.max(0, Math.min(100, Number(x && x.percento) || 0)); const t = $('cassaTesto'); if (t && statoAgg.trovata && statoAgg.inCorso) t.textContent = 'Scarico DoctorWood ' + statoAgg.trovata.versione + '… ' + statoAgg.percento + '%'; disegnaAggiornamenti(); }); } catch (_) { }
      // controllo settimanale: all'apertura (e al ritorno nell'app) se è passata una settimana; con «Più tardi» si richiede la settimana dopo
      let chiedendoAgg = false;
      // una finestra davvero visibile (alcune restano nel documento nascoste in altro modo che con .hidden)
      const finestraAperta = () => [...document.querySelectorAll('[role="dialog"], #modalDomanda, #modalPin, #bloccoTitolare')].some(el => !el.classList.contains('hidden') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && el.offsetWidth > 0 && (() => { const r = el.getBoundingClientRect(); return r.bottom > 1 && r.top < innerHeight - 1; })());
      async function controlloSettimanale(tentativo) {
        const o = optAgg();
        if (!o.attivo || chiedendoAgg || statoAgg.inCorso || Date.now() - o.ultimo < SETTIMANA || !modalita()) return;
        if (finestraAperta()) { if ((tentativo || 0) < 15) setTimeout(() => controlloSettimanale((tentativo || 0) + 1), 4000); return; }
        const t = await controllaAggiornamenti(false);
        if (!t || finestraAperta()) return;
        chiedendoAgg = true;
        try {
          const r = await domanda({ testo: 'È uscita DoctorWood ' + t.versione + '.\n\n' + (t.novita ? 'Novità: ' + t.novita + '\n\n' : '') + 'I tuoi dati restano tutti. Android ti chiederà la conferma.', si: 'Aggiorna', no: 'Più tardi' });
          if (r && r.ok) await installaAggiornamento(); else salvaAgg({ rimandata: t.versione });
        } finally { chiedendoAgg = false; }
      }
      document.addEventListener('click', e => {
        const b = e.target && e.target.closest && e.target.closest('#impAggiornamenti, #aggInstalla, #aggControlla');
        if (!b) return;
        if (b.id === 'impAggiornamenti') { salvaAgg({ attivo: !optAgg().attivo }); disegnaAggiornamenti(); }
        else if (b.id === 'aggInstalla') installaAggiornamento();
        else controllaAggiornamenti(true);
      });
      disegnaAggiornamenti();
      setTimeout(() => controlloSettimanale(0), 8000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(() => controlloSettimanale(0), 3000); });
      window.__aggiornamenti = { controlloSettimanale, optAgg, statoAgg };   // per le prove

      // ---------- Fluidità dello schermo (60 / 90 / 120 Hz) ----------
      // Automatica: decide Android. Massima: la frequenza più alta dello schermo (più fluido, un po' più di batteria).
      // 60 Hz: risparmio. Con le animazioni spente, «Automatica» vale come 60 Hz.
      let hzMassimi = 0;
      const sceltaFrequenza = () => { const v = S.getItem('doctorwood_frequenza'); return v === 'auto' || v === '60' ? v : 'massima'; };
      function applicaFrequenza() {
        const s = sceltaFrequenza(), modo = s === 'auto' && !animazioniAttive() ? '60' : s;
        lab('impostaFrequenza', { modo }).catch(() => {});
      }
      lab('frequenze').then(r => { hzMassimi = r && r.massima || 0; aggiornaRigheImp(); }).catch(() => {});
      applicaFrequenza();
      const applicaAnimOrig = applicaAnimazioni;
      applicaAnimazioni = function () { const r = applicaAnimOrig.apply(this, arguments); try { applicaFrequenza(); } catch (_) {} return r; };

      // ---------- Sincronizzazione Titolare ↔ Laboratorio ----------
      // Due modi, stessi file cifrati:
      //  • DIRETTA (PairWood, consigliata): i dispositivi si parlano nella Wi-Fi, in TLS 1.3, solo se abbinati.
      //    La rete la usa solo PairWood (codice nativo): questa pagina resta senza rete (CSP connect-src 'none').
      //  • CARTELLA: una cartella scelta una volta, tenuta allineata da Syncthing o da un'app collegata a un cloud.
      // DoctorWood scrive e legge solo file CIFRATI.
      //  - il titolare scrive «doctorwood-laboratorio.dwsync» (lavori in produzione, senza prezzi)
      //  - ogni tablet scrive il suo «doctorwood-avanzamento-<id>.dwsync» (le spunte): nessun file ha due autori
      // Chiave: dal codice di abbinamento (20 caratteri, ~100 bit) con PBKDF2; sul dispositivo resta custodita
      // nel Keystore di Android. Chi ha la cartella ma non il codice vede solo byte cifrati.
      const K_SINC = 'doctorwood_sincronia', K_SINC_STATO = 'doctorwood_sincronia_stato';
      const NOME_LAB = 'doctorwood-laboratorio.dwsync', PREF_AVANZ = 'doctorwood-avanzamento-';
      const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // senza I, L, O, U: non si confondono
      const sinc = () => { const c = leggiJ(K_SINC, null); return c && c.v === 1 && c.chiave && (c.uri || c.tipo === 'pairwood') ? c : null; };
      const diretta = c => !!(c && c.tipo === 'pairwood');
      // PairWood: il modulo di sincronizzazione diretta (codice nativo). Cartella privata «laboratorio».
      const pw = (metodo, opz) => CAP.nativePromise('PairWood', metodo, opz || {});
      const CARTELLA_PW = 'laboratorio';
      // leggere e scrivere i file della sincronizzazione, qualunque sia il modo
      const pwAvviato = async (metodo, opz) => { await avviaPW(); return pw(metodo, opz); };
      const io = c => diretta(c) ? {
        verifica: async () => ({ ok: true }),
        elenco: async prefisso => (((await pwAvviato('elenco', { cartella: CARTELLA_PW, prefisso })).file) || []).map(f => ({ nome: f.percorso, modificato: f.modificato, dimensione: f.dimensione })),
        leggi: nome => pwAvviato('leggi', { cartella: CARTELLA_PW, percorso: nome }),
        scrivi: (nome, t) => pwAvviato('scrivi', { cartella: CARTELLA_PW, percorso: nome, testo: t }),
      } : {
        verifica: () => lab('verificaCartella', { uri: c.uri }),
        elenco: async prefisso => ((await lab('elencoCartella', { uri: c.uri, prefisso })).file) || [],
        leggi: nome => lab('leggiFile', { uri: c.uri, nome }),
        scrivi: (nome, t) => lab('scriviFile', { uri: c.uri, nome, testo: t }),
      };
      const statoSinc = () => Object.assign({ inviato: 0, ricevuto: 0, controllato: 0, hash: '', visti: {}, vecchioCodice: {}, illeggibili: {}, errore: '', creatoLab: 0, firmaLab: '' }, leggiJ(K_SINC_STATO, {}));
      const nuovoCodice = () => [...casuali(20)].map(x => ALFABETO[x & 31]).join('');
      const formattaCodice = c => c.match(/.{1,4}/g).join('-');
      const pulisciCodice = t => String(t || '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');
      const codiceValido = c => c.length === 20 && [...c].every(x => ALFABETO.includes(x));
      const chiaveDaCodice = c => chiaveDaPassword('doctorwood-sincronia:' + c, testo.encode('doctorwood-sincronia-1'), ITERAZIONI);
      async function chiaveSinc(c) { const r = await lab('riprendi', c.chiave); return byte(r.dati); }
      async function cifraSinc(K, tipo, ogg) {
        const iv = casuali(12);
        const d = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: testo.encode('doctorwood-sincronia-1|' + tipo) }, await chiaveAes(K), testo.encode(JSON.stringify(ogg)));
        return JSON.stringify({ app: 'DoctorWood', formato: 'sincronia', versione: 1, tipo, iv: b64(iv), dati: b64(new Uint8Array(d)) });
      }
      async function decifraSinc(K, tipo, txt) {
        const b = JSON.parse(txt);
        if (!b || b.app !== 'DoctorWood' || b.formato !== 'sincronia' || b.tipo !== tipo || typeof b.iv !== 'string' || typeof b.dati !== 'string') throw new Error('formato');
        const d = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: byte(b.iv), additionalData: testo.encode('doctorwood-sincronia-1|' + tipo) }, await chiaveAes(K), byte(b.dati));
        return JSON.parse(daTesto.decode(new Uint8Array(d)));
      }

      // ---------- firma del titolare sul file dei lavori ----------
      // Tutti i tablet conoscono il codice: senza firma, un tablet rubato o manomesso potrebbe scrivere un file dei
      // lavori falso (anche con il segreto di sblocco cambiato, o con una data nel futuro che blocca gli aggiornamenti
      // veri). Il titolare firma con una chiave ECDSA P-256 che ha solo lui (custodita nel Keystore); il tablet fissa
      // la chiave pubblica al primo file dopo l'abbinamento e da lì accetta solo file firmati con quella.
      const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' }, FIRMA = { name: 'ECDSA', hash: 'SHA-256' };
      const daFirmare = b => testo.encode('doctorwood-firma-1|' + b.tipo + '|' + b.iv + '|' + b.dati);
      async function chiaveFirma(c) {
        if (c.firmaPriv && c.firmaPub) {
          const r = await lab('riprendi', c.firmaPriv), raw = byte(r.dati);
          try { return await crypto.subtle.importKey('pkcs8', raw, ECDSA, false, ['sign']); } finally { raw.fill(0); }
        }
        const kp = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']);
        const priv = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
        const conf = sinc();
        conf.firmaPriv = await lab('custodisci', { dati: b64(priv) }); priv.fill(0);
        conf.firmaPub = b64(new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey)));
        scriviJ(K_SINC, conf); Object.assign(c, { firmaPriv: conf.firmaPriv, firmaPub: conf.firmaPub });
        return kp.privateKey;
      }
      async function firmaBusta(c, txt) {
        const b = JSON.parse(txt), k = await chiaveFirma(c);
        b.firma = b64(new Uint8Array(await crypto.subtle.sign(FIRMA, k, daFirmare(b))));
        b.chiave = c.firmaPub;
        return JSON.stringify(b);
      }
      // 'ok' (firmato con la chiave già fissata, o la prima volta), oppure il motivo per scartarlo
      async function controllaFirma(txt, st) {
        let b; try { b = JSON.parse(txt); } catch (_) { return 'formato'; }
        if (typeof b.firma !== 'string' || typeof b.chiave !== 'string') return st.chiaveTitolare ? 'senza firma' : 'ok';   // versioni vecchie, solo prima di fissare
        const pub = st.chiaveTitolare || b.chiave;
        try {
          const k = await crypto.subtle.importKey('spki', byte(pub), ECDSA, false, ['verify']);
          return (await crypto.subtle.verify(FIRMA, k, byte(b.firma), daFirmare(b))) ? 'ok' : 'firma sbagliata';
        } catch (_) { return 'firma illeggibile'; }
      }

      let sincInCorso = false, timerSinc = 0;
      // un giro di sincronizzazione; forza = anche se nulla sembra cambiato (pulsante «Sincronizza ora»)
      async function sincronizza(forza) {
        const c = sinc();
        if (!c || sincInCorso) return null;
        sincInCorso = true;
        const st = statoSinc(), esito = { inviato: false, ricevuti: 0 };
        st.errore = '';   // ogni giro riparte pulito: restano solo i problemi trovati adesso
        let K = null;
        const f_ = io(c);
        try {
          if (!(await f_.verifica()).ok) throw new Error('La cartella «' + c.nome + '» non è più accessibile: collegala di nuovo.');
          K = await chiaveSinc(c);
          const elenco = await f_.elenco('doctorwood-');
          const firma = f => f.modificato + ':' + f.dimensione;
          if (!modoLab()) {
            // TITOLARE: invia i lavori in produzione, riceve le spunte di tutti i tablet
            const d = datiLabDaLavori(); d.segreto = segretoTitolare();
            const h = await sha(JSON.stringify([d.lavori, d.segreto]));
            // il file dei lavori lo scrive solo questo telefono: se è cambiato senza di noi (copia vecchia, cancellato…)
            // si riscrive subito, così il tablet non resta indietro
            const fl = elenco.find(f => f.nome === NOME_LAB), toccatoDaAltri = !!(fl && st.firmaLab && firma(fl) !== st.firmaLab);
            if (forza || h !== st.hash || !fl || toccatoDaAltri) {
              await f_.scrivi(NOME_LAB, await firmaBusta(c, await cifraSinc(K, 'laboratorio', d)));
              st.hash = h; st.inviato = Date.now(); esito.inviato = true;
              // la «firma» (data e dimensione) del file appena scritto: se poi cambia, l'ha toccato qualcun altro
              const dopo = (await f_.elenco(NOME_LAB)).find(f => f.nome === NOME_LAB);
              st.firmaLab = dopo ? firma(dopo) : '';
            } else if (fl && !st.firmaLab) st.firmaLab = firma(fl);
            for (const f of elenco.filter(x => x.nome.startsWith(PREF_AVANZ) && x.nome.endsWith('.dwsync'))) {
              if (!forza && st.visti[f.nome] === firma(f)) continue;
              // scritto con il codice di prima («Cambia codice»): si salta finché il tablet non lo riscrive
              if (st.vecchioCodice && st.vecchioCodice[f.nome] === firma(f)) continue;
              // già trovato illeggibile e non cambiato da allora: si salta (lo stato lo ricorda)
              if (!forza && st.illeggibili && st.illeggibili[f.nome] === firma(f)) continue;
              const r = await f_.leggi(f.nome);
              if (!r.esiste) continue;
              let o;
              try { o = await decifraSinc(K, 'avanzamento', r.testo); }
              catch (_) {
                const nuovo = !st.illeggibili || st.illeggibili[f.nome] !== firma(f);
                st.illeggibili = Object.assign({}, st.illeggibili, { [f.nome]: firma(f) });
                if (nuovo) st.errore = `Il file «${f.nome}» non si apre con il codice di questo dispositivo: un tablet usa un codice diverso (o il file non è ancora arrivato tutto). Ricollega quel tablet con il codice giusto.`;
                continue;
              }
              if (st.illeggibili && st.illeggibili[f.nome]) { st.illeggibili = Object.assign({}, st.illeggibili); delete st.illeggibili[f.nome]; }
              const n = unisciAvanz(o.voci);
              if (n > 0) esito.ricevuti += n;
              unisciTentativi(o.tentativi);
              st.visti[f.nome] = firma(f); st.ricevuto = Date.now();
            }
            // i file illeggibili che non ci sono più: via anche la nota
            if (st.illeggibili) for (const n of Object.keys(st.illeggibili)) if (!elenco.some(f => f.nome === n)) { st.illeggibili = Object.assign({}, st.illeggibili); delete st.illeggibili[n]; }
            if (esito.ricevuti) { try { aggiornaVisteLavori(); if (lavoroAperto) disegnaLavoro(); disegnaAllarmeLab(); } catch (_) {} }
          } else {
            // LABORATORIO: riceve i lavori, invia le sue spunte
            const f = elenco.find(x => x.nome === NOME_LAB);
            if (f && (forza || st.visti[NOME_LAB] !== firma(f))) {
              const r = await f_.leggi(NOME_LAB);
              if (r.esiste) {
                let o = null;
                const fir = await controllaFirma(r.testo, st);
                if (fir !== 'ok') {
                  // file non scritto dal telefono del titolare: si scarta, e non si guarda più finché non cambia
                  st.errore = 'Nella sincronizzazione c\'è un file dei lavori NON firmato dal telefono del titolare (' + fir + '): è stato ignorato. Se succede di nuovo, controlla i dispositivi abbinati.';
                  st.visti[NOME_LAB] = firma(f);
                } else {
                  try { o = await decifraSinc(K, 'laboratorio', r.testo); }
                  catch (_) { st.errore = 'Il file dei lavori non si apre con il codice di questo tablet: ricollega la sincronizzazione con il codice giusto.'; }
                  // il primo file valido dopo l'abbinamento fissa la chiave del titolare
                  if (o && !st.chiaveTitolare) { try { const b = JSON.parse(r.testo); if (typeof b.chiave === 'string') st.chiaveTitolare = b.chiave; } catch (_) {} }
                }
                // un file dei lavori più vecchio di quello già accettato non passa: chi controlla la cartella
                // (o l'account del cloud) non può rimettere una copia vecchia per far tornare indietro il tablet
                if (o && Number(o.creato) < (st.creatoLab || 0)) {
                  st.errore = 'Nella cartella c\'è un file dei lavori più vecchio di quello che il tablet ha già: è stato ignorato. Se non l\'ha rimesso qualcuno di voi, controlla la cartella.';
                  st.visti[NOME_LAB] = firma(f);
                  o = null;
                }
                if (o) {
                  st.creatoLab = Number(o.creato) || 0;
                  const d = pulisciDatiLab(o), prima = leggiJ('laboratorio_dati', null);
                  if (!prima || JSON.stringify(prima.lavori) !== JSON.stringify(d.lavori) || prima.segreto !== d.segreto) {
                    scriviStorage('laboratorio_dati', d); esito.ricevuti = d.lavori.length || 1;
                    try { disegnaLaboratorio(); } catch (_) {}
                  }
                  st.visti[NOME_LAB] = firma(f); st.ricevuto = Date.now();
                }
              }
            }
            // finché non ha letto un file dei lavori valido, il codice non è verificato: non si scrive niente nella
            // cartella (un codice sbagliato lascerebbe lì un file che nessuno può aprire)
            if (!st.creatoLab) { st.controllato = Date.now(); if (st.errore) esito.errore = st.errore; return esito; }
            const av = { app: 'DoctorWood', formato: 'avanzamento', creato: Date.now(), voci: leggiAvanz(), tentativi: leggiTentativi(), dispositivo: c.id };
            const h = await sha(JSON.stringify([av.voci, av.tentativi]));
            const mio = PREF_AVANZ + c.id + '.dwsync';
            if (forza || h !== st.hash || !elenco.some(x => x.nome === mio)) {
              await f_.scrivi(mio, await cifraSinc(K, 'avanzamento', av));
              st.hash = h; st.inviato = Date.now(); esito.inviato = true;
            }
          }
          st.controllato = Date.now();
          if (st.errore) esito.errore = st.errore;
          return esito;
        } catch (e) {
          st.errore = (e && e.message) || String(e);
          return { errore: st.errore };
        } finally {
          if (K) K.fill(0);
          scriviJ(K_SINC_STATO, st);
          sincInCorso = false;
          aggiornaStatoSinc();
        }
      }
      function pianificaSinc(ms) { clearTimeout(timerSinc); if (sinc()) timerSinc = setTimeout(() => sincronizza(false), ms || 4000); }
      // mentre l'app è aperta: all'avvio, quando torna in primo piano, ogni minuto e poco dopo ogni modifica
      setTimeout(() => sincronizza(false), 2500);

      // ---------- PairWood (sincronizzazione diretta) ----------
      // Con l'app aperta PairWood ascolta, si annuncia nella Wi-Fi e sincronizza da solo dopo ogni scrittura;
      // quando arrivano file nuovi avvisa la pagina, che li legge subito. Con l'app chiusa: ogni 15 minuti circa.
      let pwPronto = null, retePW = null;
      function avviaPW() {
        if (!pwPronto) {
          pwPronto = pw('avvia', { cartelle: [CARTELLA_PW], nome: modoLab() ? 'Laboratorio' : 'Titolare', minutiPeriodico: 15 })
            .then(st => { if (!avviaPW.ascolto) { avviaPW.ascolto = true; try { CAP.addListener('PairWood', 'evento', eventoPW); } catch (_) {} } return st; })
            .catch(e => { pwPronto = null; throw e; });
        }
        return pwPronto;
      }
      function eventoPW(e) {
        if (!e || !diretta(sinc())) return;
        if (e.tipo === 'ricevuti') pianificaSinc(300);   // file nuovi nella cartella di PairWood: si leggono subito
        else if (e.tipo === 'presentato') { avvisoGuardia('«' + String(e.dispositivo || 'dispositivo') + '» aggiunto: te l\'ha presentato «' + String(e.da || 'un tuo dispositivo') + '».', 'ok'); pianificaSinc(500); }
        else if (e.tipo === 'abbinato') {
          // il QR sul telefono del titolare non serve più: si chiude da solo
          try { if (!fin.classList.contains('hidden') && !$('cassaQr').classList.contains('hidden')) $('cassaSi').click(); } catch (_) {}
          avvisoGuardia('Abbinato con «' + String(e.dispositivo || 'dispositivo') + '».', 'ok'); pianificaSinc(300);
        }
        else if (e.tipo === 'sincronizzato') {
          retePW = { raggiunti: Number(e.raggiunti) || 0, abbinati: Number(e.abbinati) || 0, quando: Date.now(), vecchi: (retePW && retePW.vecchi) || [] };
          aggiornaStatoSinc();
          // chi non si sente da più di 2 giorni: lo si dice (tablet spento, rotto, perso?)
          pw('stato').then(st => {
            const ora = Date.now(), G = 86400000;
            retePW.vecchi = (st && Array.isArray(st.dispositivi) ? st.dispositivi : [])
              .filter(d => Number(d.ultimoContatto) > 0 && ora - Number(d.ultimoContatto) > 2 * G)
              .map(d => ({ nome: String(d.nome || 'dispositivo').slice(0, 64), giorni: Math.floor((ora - Number(d.ultimoContatto)) / G) }));
            retePW.permesso = st && st.permessoRete === 'mancante';
            retePW.ascolto = st && st.ascolto;
            aggiornaStatoSinc();
          }).catch(() => {});
        }
        else if (e.tipo === 'avviso' && /Troppi codici|occupata|vicinanze/.test(String(e.testo || ''))) avvisoGuardia('Sincronizzazione: ' + String(e.testo), 'errore');
      }
      if (diretta(sinc())) avviaPW().catch(e => { const st = statoSinc(); st.errore = 'Sincronizzazione diretta non avviata: ' + ((e && e.message) || e); scriviJ(K_SINC_STATO, st); aggiornaStatoSinc(); });
      // «Sincronizza ora»: con la diretta prima si parla con gli altri dispositivi, poi si leggono i file
      // cosa è successo nell'ultimo giro (chi è stato raggiunto e perché no): si vede nella finestra «Sincronizzazione» e nelle segnalazioni
      async function aggiornaDiagSinc() {
        try { const r = await pw('diagnosi'); window.__diagSinc = String((r && r.testo) || '').slice(0, 900); } catch (_) {}
        return window.__diagSinc || '';
      }
      window.__aggiornaDiagSinc = aggiornaDiagSinc;
      // dal lavoro: «Manda ora al tablet» (se il tablet non è ancora collegato, apre il collegamento)
      window.__mandaLab = async () => {
        if (!sinc()) { avvisoGuardia('Il tablet non è ancora collegato: collegalo una volta sola, poi i lavori arrivano da soli.', 'info'); const r = document.getElementById('impSinc'); if (r) r.click(); return; }
        const e = await sincronizzaOraTutto();
        avvisoGuardia(e && e.errore ? 'Sincronizzazione: ' + e.errore : 'Lavori mandati al laboratorio.', e && e.errore ? 'errore' : 'ok');
      };
      async function sincronizzaOraTutto() {
        const c = sinc();
        if (diretta(c)) {
          try {
            await avviaPW(); await pw('sincronizza');
            // «Sincronizzato» solo se l'altro dispositivo è stato davvero raggiunto
            const d = await aggiornaDiagSinc(), m = /raggiunti (\d+) di (\d+)/.exec(d);
            if (m && Number(m[1]) < Number(m[2])) {
              const perche = /non raggiunti: ([^;]*(?:\([^)]*\))?[^;]*)/.exec(d);
              return { errore: 'L\'altro dispositivo non risponde' + (perche ? ' (' + perche[1].trim() + ')' : '') + '. Controlla: stessa Wi‑Fi, DoctorWood aperta (o «sempre in ascolto») sull\'altro dispositivo.' };
            }
          } catch (e) { return { errore: 'Sincronizzazione diretta: ' + ((e && e.message) || e) }; }
        }
        return sincronizza(true);
      }
      setInterval(() => { if (document.visibilityState === 'visible') sincronizza(false); }, 60000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pianificaSinc(800); });
      const CHIAVI_SINC = new Set(['lavori', 'projects', 'doctorwood_clients', 'magazzino', 'appuntamenti', 'preventivi', 'avanzamento_lab']);
      const scriviStorageOrig = scriviStorage;
      scriviStorage = function (k) { const r = scriviStorageOrig.apply(this, arguments); if (r && CHIAVI_SINC.has(k)) pianificaSinc(); return r; };

      // un comando avviato da un tasto: qualunque imprevisto diventa un messaggio chiaro (e la finestra «attendere» si chiude)
      const conMessaggio = fn => function () {
        return Promise.resolve().then(() => fn.apply(this, arguments)).catch(e => {
          try { chiudiAttesa(); } catch (_) {}
          avvisoGuardia('Non riuscito: ' + (e && e.message ? e.message : String(e)), 'errore');
        });
      };

      // ---------- abbinamento ----------
      async function sceltaModo() {
        const r = await finestra({ titolo: 'Sincronizzazione',
          testoMsg: 'Come vuoi collegare telefono e tablet?\n\n• Diretta (consigliata): i dispositivi si parlano nella stessa rete Wi‑Fi, senza cloud e senza altre app. Collegamento cifrato, solo tra dispositivi abbinati con il codice.\n• Con una cartella: tenuta allineata da Syncthing o da un\'app collegata a Google Drive (funziona anche fuori dalla Wi‑Fi).',
          si: 'Diretta (Wi‑Fi)', alt: 'Con una cartella' });
        return r.esito === 'si' ? 'diretta' : r.esito === 'alt' ? 'cartella' : null;
      }
      const DIRETTA = { tipo: 'pairwood', nome: 'Diretta Wi‑Fi' };
      async function scegliCartellaSinc() {
        const r = await finestra({ titolo: 'Cartella di sincronizzazione',
          testoMsg: 'Scegli la cartella del dispositivo che viene tenuta allineata con l\'altro dispositivo.\n\n• Con Google Drive: prima, con un\'app come Autosync o FolderSync, collega una cartella del telefono (per esempio «DoctorWood») a una cartella di Drive, in sincronizzazione nei due sensi. Poi scegli qui quella cartella del telefono. Drive non si può scegliere direttamente: Android non lo permette.\n• Senza cloud: una cartella tenuta allineata da Syncthing.\n\nDoctorWood non si collega a internet: in quella cartella scrive solo file cifrati.',
          si: 'Scegli la cartella' });
        if (r.esito !== 'si') return null;
        let c;
        try { c = await lab('scegliCartella'); }
        catch (e) { avvisoGuardia('Cartella non usabile: ' + (e && e.message ? e.message : 'Android non ha dato il permesso') + '. Scegline un\'altra.', 'errore'); return null; }
        return c && c.uri ? c : null;
      }
      async function salvaSinc(cartella, K, codice) {
        const chiave = await lab('custodisci', { dati: b64(K) });
        const conf = { v: 1, tipo: cartella.tipo === 'pairwood' ? 'pairwood' : 'cartella', uri: cartella.uri, nome: cartella.nome || 'cartella', chiave, id: (sinc() || {}).id || [...casuali(4)].map(x => x.toString(16).padStart(2, '0')).join('') };
        if (codice) conf.codice = await lab('custodisci', { dati: b64(testo.encode(codice)) });
        const prima = sinc();
        if (prima && prima.firmaPriv && prima.firmaPub) { conf.firmaPriv = prima.firmaPriv; conf.firmaPub = prima.firmaPub; }
        scriviJ(K_SINC, conf);
        scriviJ(K_SINC_STATO, {});
      }
      async function attivaSincTitolare() {
        const modo = await sceltaModo();
        if (!modo) return;
        const cartella = modo === 'diretta' ? DIRETTA : await scegliCartellaSinc();
        if (!cartella) return;
        const codice = nuovoCodice();
        attesa('Sincronizzazione', 'Preparo la chiave…');
        const K = await chiaveDaCodice(codice);
        chiudiAttesa();
        await salvaSinc(cartella, K, codice);
        K.fill(0);
        if (modo === 'diretta') {
          attesa('Sincronizzazione', 'Avvio la sincronizzazione diretta…');
          try { await avviaPW(); await pw('accettaAbbinamento', { codice, minuti: 10 }); }
          finally { chiudiAttesa(); }
          await finestra({ titolo: 'Codice di abbinamento', evidenza: formattaCodice(codice), qr: await qrDi(codice),
            testoMsg: 'Sul tablet del laboratorio: Laboratorio → «Collega la sincronizzazione» → «Diretta» → «Inquadra il QR» e punta la fotocamera qui (oppure scrivi il codice).\n\nEntro 10 minuti, con i due dispositivi nella stessa Wi‑Fi e DoctorWood aperto qui. Per un altro tablet: Impostazioni → «Codice di abbinamento» (riapre l\'abbinamento per 10 minuti).\n\nNon mandare il codice in chiaro per messaggio.',
            si: 'Fatto', no: '' });
          const e = await sincronizza(true);
          avvisoGuardia(e && e.errore ? 'Sincronizzazione: ' + e.errore : 'Sincronizzazione diretta attiva: appena il tablet si abbina, i lavori partono da soli.', e && e.errore ? 'errore' : 'ok');
          return;
        }
        await finestra({ titolo: 'Codice di abbinamento', evidenza: formattaCodice(codice), qr: await qrDi(codice),
          testoMsg: 'Sul tablet del laboratorio: Laboratorio → «Collega la sincronizzazione» → «Inquadra il QR» e punta la fotocamera qui (oppure scrivi il codice).\n\nServe una volta sola per ogni tablet. Puoi rivederlo qui nelle Impostazioni. Non mandarlo in chiaro per messaggio: chi ha il codice e la cartella può leggere i lavori.',
          si: 'Fatto', no: '' });
        const e = await sincronizza(true);
        avvisoGuardia(e && e.errore ? 'Sincronizzazione: ' + e.errore : `Sincronizzazione attiva con la cartella «${cartella.nome}».`, e && e.errore ? 'errore' : 'ok');
      }
      // Laboratorio: legge il QR di un'etichetta (fotocamera di PairWood) e lo passa alla pagina, che ritrova il pezzo
      window.scansionaEtichetta = async () => {
        const r = await pw('scansionaQr', { qualsiasi: true }).catch(e => ({ errore: (e && e.message) || 'Fotocamera non disponibile.' }));
        if (!r || r.annullato) return;
        if (r.errore) { alert(r.errore); return; }
        await window.usaEtichetta(r.codice);
      };
      // Il codice del telefono del titolare: si inquadra il QR (l'abbinamento parte da solo) oppure si scrive.
      // Risponde con il codice pulito, oppure null se la persona annulla.
      let ultimoAMano = false;   // dopo un codice scritto a mano e sbagliato si torna a scriverlo, non al QR
      async function leggiCodiceTitolare(testoMsg, errore) {
        let aMano = !!errore && ultimoAMano;
        for (;;) {
          if (!aMano) {
            const q = await finestra({ titolo: 'Codice di abbinamento', testoMsg: testoMsg + '\n\nInquadra il QR che vedi sul telefono: il collegamento parte da solo.', si: 'Inquadra il QR', alt: 'Scrivi il codice', errore });
            if (q.esito === 'alt') { aMano = true; errore = ''; continue; }
            if (q.esito !== 'si') return null;
            const r = await pw('scansionaQr').catch(e => ({ errore: (e && e.message) || 'Fotocamera non disponibile.' }));
            if (r && r.codice) {
              const letto = pulisciCodice(r.codice);
              if (!codiceValido(letto)) { errore = 'Quel QR non è un codice di abbinamento di DoctorWood.'; continue; }
              ultimoAMano = false; return letto;
            }
            if (r && r.errore) { errore = r.errore + ' Puoi scrivere il codice.'; aMano = true; }
            continue;
          }
          const r = await finestra({ titolo: 'Codice di abbinamento', testoMsg: testoMsg + '\n\nScrivi il codice (i trattini si mettono da soli).',
            si: 'Collega', alt: 'Inquadra il QR', password: 1, campo: 'testo', codice: true, segnaposto: 'XXXX-XXXX-XXXX-XXXX-XXXX', errore });
          if (r.esito === 'alt') { aMano = false; errore = ''; continue; }
          if (r.esito !== 'si') return null;
          const c = pulisciCodice(r.pw1);
          if (!codiceValido(c)) { errore = 'Il codice ha 20 caratteri (lettere e numeri): controllalo.'; continue; }
          ultimoAMano = true;
          return c;
        }
      }
      // il QR del codice, da mostrare sul telefono del titolare (null se il modulo non è disponibile)
      async function qrDi(codice) { try { return (await pw('qr', { testo: codice })).righe || null; } catch (_) { return null; } }
      async function attivaSincLaboratorio() {
        const modo = await sceltaModo();
        if (!modo) return;
        if (modo === 'diretta') return abbinaDiretta();
        const cartella = await scegliCartellaSinc();
        if (!cartella) return;
        let errore = '';
        for (;;) {
          const codice = await leggiCodiceTitolare('Sul telefono del titolare: Impostazioni → «Titolare e laboratorio» → «Codice di abbinamento».', errore);
          if (!codice) return;
          attesa('Sincronizzazione', 'Controllo il codice…');
          const K = await chiaveDaCodice(codice);
          // se il file dei lavori c'è già, il codice deve aprirlo
          let prova = 'nessun-file';
          try {
            const l = await lab('leggiFile', { uri: cartella.uri, nome: NOME_LAB });
            if (l.esiste) { await decifraSinc(K, 'laboratorio', l.testo); prova = 'ok'; }
          } catch (_) { prova = 'sbagliato'; }
          chiudiAttesa();
          if (prova === 'sbagliato') { K.fill(0); errore = 'Questo codice non apre il file dei lavori nella cartella: controlla il codice (o la cartella).'; continue; }
          await salvaSinc(cartella, K, null);
          K.fill(0);
          const e = await sincronizza(true);
          avvisoGuardia(e && e.errore ? 'Sincronizzazione: ' + e.errore
            : prova === 'ok' ? 'Sincronizzazione collegata: lavori aggiornati dal titolare.' : 'Sincronizzazione collegata. Il file dei lavori non è ancora nella cartella: arriverà appena il titolare apre l\'app.', e && e.errore ? 'errore' : 'ok');
          return;
        }
      }
      // tablet: si abbina al telefono del titolare con il codice; lo stesso codice dà la chiave dei file cifrati
      async function abbinaDiretta() {
        let errore = '';
        for (;;) {
          const codice = await leggiCodiceTitolare('Sul telefono del titolare: Impostazioni → «Titolare e laboratorio» → «Codice di abbinamento». Tieni DoctorWood aperto là, nella stessa Wi‑Fi.', errore);
          if (!codice) return;
          attesa('Sincronizzazione', 'Cerco il telefono del titolare nella Wi‑Fi…');
          let K = null, nome = '';
          try {
            K = await chiaveDaCodice(codice);
            await avviaPW();
            nome = ((await pw('abbina', { codice })) || {}).nome || '';
          } catch (e) {
            chiudiAttesa(); if (K) K.fill(0);
            errore = (e && e.message) || 'Abbinamento non riuscito.';
            continue;
          }
          await salvaSinc(DIRETTA, K, null);
          K.fill(0);
          chiudiAttesa();
          if (modoLab()) { try { await attivaAscolto(leggiOrario('lun-sab 07:00-19:00')); } catch (_) {} }
          const e = await sincronizza(true);
          avvisoGuardia(e && e.errore ? 'Sincronizzazione: ' + e.errore : 'Collegato a «' + (nome || 'titolare') + '»: i lavori arrivano da soli.' + (modoLab() ? ' Sempre in ascolto lun-sab 07:00-19:00 (si cambia da «Orario e altro»).' : ''), e && e.errore ? 'errore' : 'ok');
          if (modoLab()) await consigliaBatteria();
          return;
        }
      }
      async function disattivaSinc() {
        const c = sinc();
        const r = await finestra({ titolo: 'Sincronizzazione', testoMsg: diretta(c)
          ? 'Scollegare la sincronizzazione diretta?\n\nQuesto dispositivo dimentica gli abbinamenti e cancella le sue copie dei file di sincronizzazione (i tuoi dati restano). Per ricollegarlo servirà di nuovo il codice.'
          : 'Scollegare la cartella di sincronizzazione da questo dispositivo?\n\nI file già nella cartella restano dove sono. Potrai ricollegarla quando vuoi.', si: 'Scollega' });
        if (r.esito !== 'si') return;
        if (diretta(c)) { await pw('cancellaTutto').catch(() => {}); pwPronto = null; retePW = null; }
        else if (c) lab('dimenticaCartella', { uri: c.uri }).catch(() => {});
        S.removeItem(K_SINC); S.removeItem(K_SINC_STATO);
        aggiornaStatoSinc();
      }
      async function mostraCodice() {
        const c = sinc();
        if (!c || !c.codice) return;
        try {
          const r = await lab('riprendi', c.codice);
          const codice = daTesto.decode(byte(r.dati));
          if (diretta(c)) { await avviaPW(); await pw('accettaAbbinamento', { codice, minuti: 10 }); }
          await finestra({ titolo: 'Codice di abbinamento', evidenza: formattaCodice(codice), qr: await qrDi(codice), testoMsg: diretta(c)
            ? 'Sul tablet del laboratorio: Laboratorio → «Collega la sincronizzazione» → «Diretta» → «Inquadra il QR» (oppure scrivi il codice).\n\nL\'abbinamento resta aperto 10 minuti, per un solo tablet: tieni DoctorWood aperto, nella stessa Wi‑Fi.'
            : 'Da scrivere sul tablet del laboratorio: Laboratorio → «Collega la sincronizzazione».', si: 'Chiudi', no: '' });
        } catch (_) { avvisoGuardia('Il codice non è leggibile su questo dispositivo: disattiva e riattiva la sincronizzazione.', 'errore'); }
      }

      // cambia codice: dopo un tablet perso o un codice finito in mani sbagliate. Nuova chiave dei file e,
      // con la diretta, tutti gli abbinamenti dimenticati: ogni tablet si ricollega con il nuovo codice.
      async function cambiaCodice() {
        const c = sinc();
        if (!c || !c.codice) return;
        const r = await finestra({ titolo: 'Cambia codice', testoMsg: 'Serve se un tablet è stato perso o rubato, o se il codice è finito in mani sbagliate.\n\n' +
          '• Il codice vecchio non vale più: da ora i file si cifrano con quello nuovo.\n' +
          (diretta(c) ? '• Tutti i dispositivi abbinati vengono dimenticati.\n' : '• Chi ha la cartella e il codice vecchio non legge i file nuovi.\n') +
          '• Su ogni tablet: «Scollega» e poi «Collega la sincronizzazione» con il nuovo codice.', si: 'Cambia codice' });
        if (r.esito !== 'si') return;
        try { await nat('verificaIdentita', { titolo: 'DoctorWood', sottotitolo: 'Conferma per cambiare il codice' }); }
        catch (_) { avvisoGuardia('Codice non cambiato: identità non confermata.', 'annullato'); return; }
        const codice = nuovoCodice();
        attesa('Cambia codice', 'Preparo la nuova chiave…');
        let K = null;
        try {
          K = await chiaveDaCodice(codice);
          // i file dei tablet scritti con il codice vecchio non si leggono più: si mettono da parte finché non cambiano
          const visti = {};
          try { for (const f of await io(c).elenco(PREF_AVANZ)) visti[f.nome] = f.modificato + ':' + f.dimensione; } catch (_) {}
          if (diretta(c)) {
            await avviaPW();
            const st = await pw('stato');
            for (const d of (st && Array.isArray(st.dispositivi) ? st.dispositivi : [])) await pw('dimentica', { id: d.id });
          }
          await salvaSinc(c, K, codice);
          const st = statoSinc(); st.visti = visti; st.vecchioCodice = visti; scriviJ(K_SINC_STATO, st);
          if (diretta(c)) await pw('accettaAbbinamento', { codice, minuti: 10 });
        } finally { if (K) K.fill(0); chiudiAttesa(); }
        retePW = null;
        await sincronizza(true);   // il file dei lavori riscritto con la nuova chiave
        await finestra({ titolo: 'Nuovo codice di abbinamento', evidenza: formattaCodice(codice), qr: await qrDi(codice),
          testoMsg: 'Su ogni tablet: Laboratorio → «Sincronizzazione» → «Scollega», poi «Collega la sincronizzazione»' + (diretta(c) ? ' → «Diretta»' : '') + ' e inquadra il QR (oppure scrivi il codice).' +
            (diretta(c) ? '\n\nL\'abbinamento resta aperto 10 minuti, per un tablet; per il successivo: «Codice di abbinamento».' : ''),
          si: 'Fatto', no: '' });
      }

      // ---------- ascolto continuo in orario di lavoro (tablet del laboratorio) ----------
      // Il tablet resta raggiungibile quando è acceso e in orario (servizio di Android con notifica fissa);
      // fuori orario è in pausa; all'inizio dell'orario si riaccende e si sincronizza da solo.
      const GIORNI = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
      function leggiOrario(t) {
        const s = String(t || '').toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
        const m = s.match(/^([a-zì ,-]+?) ?(\d{1,2}(?:[:.]\d{2})?) ?- ?(\d{1,2}(?:[:.]\d{2})?)$/);
        if (!m) return null;
        const giorni = new Set();
        for (const parte of m[1].split(',').map(x => x.trim()).filter(Boolean)) {
          const [x, y] = parte.split('-').map(z => GIORNI.indexOf(z.trim().slice(0, 3)));
          const a = x, b = y === undefined ? x : y;
          if (a < 0 || b < 0) return null;
          for (let i = a; ; i = (i + 1) % 7) { giorni.add(i + 1); if (i === b) break; }
        }
        const hm = v => { const [h, mm = 0] = v.replace('.', ':').split(':').map(Number); return h <= 23 && mm <= 59 ? String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0') : null; };
        const inizio = hm(m[2]), fine = hm(m[3]);
        if (!giorni.size || !inizio || !fine || inizio === fine) return null;
        return { giorni: [...giorni].sort((p, q) => p - q), inizio, fine };
      }
      const descriviOrario = o => {
        const g = o.giorni, consecutivi = g.every((x, i) => !i || x === g[i - 1] + 1);
        return (g.length > 2 && consecutivi ? GIORNI[g[0] - 1] + '-' + GIORNI[g[g.length - 1] - 1] : g.map(x => GIORNI[x - 1]).join(', ')) + ' ' + o.inizio + '-' + o.fine;
      };
      async function attivaAscolto(o) {
        await avviaPW();
        const st = await pw('ascoltoContinuo', { attivo: true, giorni: o.giorni, inizio: o.inizio, fine: o.fine, titolo: 'DoctorWood · laboratorio' });
        pw('chiediNotifiche').catch(() => {});
        if (retePW) retePW.ascolto = st;
        aggiornaStatoSinc();
        return st;
      }
      async function consigliaBatteria() {
        const b = await pw('statoBatteria').catch(() => null);
        if (!b || !b.risparmioAttivo) return;
        const r = await finestra({ titolo: 'Batteria', testoMsg: 'Per restare raggiungibile a schermo spento, DoctorWood va escluso dal risparmio energetico di Android.\n\nNell\'elenco che si apre: «Tutte le app» → DoctorWood → «Non ottimizzare» (o «Senza restrizioni»).', si: 'Apri impostazioni', no: 'Più tardi' });
        if (r.esito === 'si') pw('apriRisparmioEnergetico').catch(() => {});
      }
      async function impostaOrario() {
        await avviaPW();
        const st = await pw('stato');
        const att = st && st.ascolto && st.ascolto.attivo ? st.ascolto : null;
        let errore = '', valore = att ? descriviOrario({ giorni: att.giorni, inizio: att.inizio, fine: att.fine }) : 'lun-sab 07:00-19:00';
        for (;;) {
          const r = await finestra({ titolo: 'Orario di lavoro', testoMsg: (att ? 'Ora: sempre in ascolto ' + att.descrizione + '.' : 'Ora: in ascolto solo con DoctorWood aperto.') +
            '\n\nScrivi giorni e orario, per esempio «lun-sab 07:00-19:00» oppure «lun, mer, ven 08:00-12:30». In quell\'orario il tablet resta raggiungibile anche a schermo spento (notifica fissa di Android).',
            si: 'Salva', alt: att ? 'Spegni' : '', no: 'Annulla', password: 1, campo: 'testo', segnaposto: valore, errore });
          if (r.esito === 'alt') { await pw('ascoltoContinuo', { attivo: false }); avvisoGuardia('Ascolto continuo spento: il tablet riceve solo con DoctorWood aperto.', 'info'); aggiornaStatoSinc(); return; }
          if (r.esito !== 'si') return;
          const o = leggiOrario(String(r.pw1 || '').trim() || valore);
          if (!o) { errore = 'Non ho capito l\'orario: scrivi per esempio «lun-sab 07:00-19:00».'; continue; }
          const fatto = await attivaAscolto(o);
          avvisoGuardia('Sempre in ascolto: ' + String((fatto && fatto.descrizione) || descriviOrario(o)) + '.', 'ok');
          await consigliaBatteria();
          return;
        }
      }

      // dispositivi abbinati: un tablet perso o rubato si «dimentica» e non riceve più niente
      async function dispositiviAbbinati() {
        await avviaPW();
        const st = await pw('stato');
        const elenco = (st && Array.isArray(st.dispositivi)) ? st.dispositivi : [];
        const riga = d => '• ' + String(d.nome || 'dispositivo').slice(0, 64) + ' (' + String(d.idLeggibile || d.id || '').slice(0, 9) + ') — ultimo contatto: ' + quando(Number(d.ultimoContatto) || 0);
        const r = await finestra({ titolo: 'Dispositivi abbinati', testoMsg: (elenco.length ? elenco.map(riga).join('\n') : 'Nessun dispositivo abbinato.') +
          '\n\nQuesto dispositivo: ' + String(st && st.id || '').slice(0, 64), si: elenco.length ? 'Dimentica un dispositivo…' : 'Chiudi', no: elenco.length ? 'Chiudi' : '' });
        if (r.esito !== 'si' || !elenco.length) return;
        for (const d of elenco) {
          const q = await finestra({ titolo: 'Dimenticare «' + String(d.nome || 'dispositivo').slice(0, 64) + '»?', testoMsg: riga(d) +
            '\n\nNon potrà più sincronizzarsi con questo dispositivo finché non lo abbini di nuovo con il codice.\n\nSe è stato perso o rubato: dimenticalo qui, poi «Scollega» e ricollega la sincronizzazione su tutti i dispositivi, così il codice cambia.',
            si: 'Dimentica', alt: elenco.indexOf(d) < elenco.length - 1 ? 'Il prossimo' : '', no: 'Annulla' });
          if (q.esito === 'si') { await pw('dimentica', { id: d.id }); avvisoGuardia('«' + String(d.nome || 'dispositivo').slice(0, 64) + '» dimenticato.', 'ok'); return; }
          if (q.esito !== 'alt') return;
        }
      }

      // ---------- stato visibile ----------
      function testoStato() {
        const c = sinc();
        if (!c) return '';
        const st = statoSinc();
        if (st.errore) return '⚠ ' + st.errore;
        const nIll = st.illeggibili ? Object.keys(st.illeggibili).length : 0;
        if (nIll) return `⚠ ${nIll === 1 ? '1 file di un tablet non si apre' : nIll + ' file dei tablet non si aprono'} (codice diverso: ricollega quel tablet) · inviato ${quando(st.inviato)} · ricevuto ${quando(st.ricevuto)}`;
        if (diretta(c)) {
          if (retePW && retePW.permesso) return '⚠ Manca il permesso «Dispositivi nelle vicinanze»: concedilo nelle impostazioni dell\'app.';
          const rete = !retePW ? '' : retePW.abbinati === 0 ? ' · nessun dispositivo abbinato'
            : retePW.raggiunti === 0 ? ' · nessuno raggiungibile ora (l\'altro ha DoctorWood aperto, nella stessa Wi‑Fi?)'
            : ` · ${retePW.raggiunti} di ${retePW.abbinati} raggiungibili`;
          const vecchi = retePW && retePW.vecchi && retePW.vecchi.length ? ' · ⚠ ' + retePW.vecchi.map(v => `«${v.nome}» non si sente da ${v.giorni} giorni`).join(', ') : '';
          const asc = retePW && retePW.ascolto && retePW.ascolto.attivo ? ' · sempre in ascolto ' + String(retePW.ascolto.descrizione || '') : '';
          return `Diretta Wi‑Fi${rete}${vecchi}${asc} · inviato ${quando(st.inviato)} · ricevuto ${quando(st.ricevuto)}`;
        }
        return `Cartella «${c.nome}» · inviato ${quando(st.inviato)} · ricevuto ${quando(st.ricevuto)}`;
      }
      function aggiornaStatoSinc() {
        if (sinc() && diretta(sinc())) aggiornaDiagSinc();
        const p = document.getElementById('labSinc');
        if (p) {
          const c = sinc();
          p.innerHTML = '';
          // non collegato: un riquadro ben visibile con i passi; collegato: una riga discreta con lo stato
          p.className = c ? 'text-[11px] text-slate-400' : 'lab-collega rounded-xl border-2 border-amber-500/60 bg-slate-800 p-4 space-y-2';
          const t = document.createElement(c ? 'span' : 'div');
          if (c) t.textContent = 'Sincronizzazione: ' + testoStato() + ' ';
          else {
            const h = document.createElement('p'); h.className = 'text-base font-bold text-white'; h.textContent = 'Collega questo tablet al telefono del titolare';
            const d = document.createElement('p'); d.className = 'text-xs text-slate-300'; d.style.whiteSpace = 'pre-line';
            d.textContent = '1. Sul telefono del titolare: Impostazioni → «Titolare e laboratorio» → «Sincronizzazione» → «Diretta»: compare un QR.\n2. Qui tocca «Collega» e inquadra quel QR: i lavori arrivano da soli.';
            t.append(h, d);
          }
          const b = document.createElement('button');
          b.type = 'button';
          if (c) { b.className = 'text-sky-300 underline'; b.style.minHeight = '32px'; }
          else { b.className = 'w-full bg-amber-500 text-slate-950 font-bold rounded-lg'; b.style.minHeight = '48px'; }
          b.textContent = c ? 'Opzioni' : 'Collega la sincronizzazione';
          b.addEventListener('click', async () => {
            if (!sinc()) return conMessaggio(attivaSincLaboratorio)();
            const d = diretta(sinc());
            const diag = await aggiornaDiagSinc();
            const r = await finestra({ titolo: 'Sincronizzazione', testoMsg: testoStato() + (diag ? '\n\nUltimo giro: ' + diag : ''), si: 'Sincronizza ora', alt: d ? 'Orario e altro…' : 'Scollega questa cartella', no: 'Chiudi' });
            if (r.esito === 'si') { const e = await sincronizzaOraTutto(); avvisoGuardia(e && e.errore ? 'Sincronizzazione: ' + e.errore : 'Sincronizzato.', e && e.errore ? 'errore' : 'ok'); }
            else if (r.esito === 'alt' && !d) conMessaggio(disattivaSinc)();
            else if (r.esito === 'alt') {
              const r2 = await finestra({ titolo: 'Sincronizzazione', testoMsg: 'Orario di lavoro: in quell\'orario il tablet resta sempre raggiungibile, anche a schermo spento.\n\nScollega: questo tablet dimentica gli abbinamenti.', si: 'Orario di lavoro', alt: 'Scollega', no: 'Chiudi' });
              if (r2.esito === 'si') conMessaggio(impostaOrario)();
              else if (r2.esito === 'alt') conMessaggio(disattivaSinc)();
            }
          });
          p.append(t, b);
        }
        aggiornaRigheImp();
      }

      // ---------- Home del titolare: «Laboratorio» (mandare i lavori al tablet, senza cercare nelle Impostazioni) ----------
      (function cardLaboratorio() {
        const home = document.getElementById('viewDashboard');
        if (!home) return;
        const card = document.createElement('section');
        card.id = 'homeLabCard'; card.className = 'home-blocco rounded-xl border border-slate-700 bg-slate-800 p-3 space-y-2';
        home.insertBefore(card, home.firstChild);
        let ultimo = '';
        function disegna() {
          if (modoLab() || home.classList.contains('hidden')) { card.classList.add('hidden'); return; }
          card.classList.remove('hidden');
          let n = 0; try { n = datiLabDaLavori().lavori.length; } catch (_) {}
          const c = sinc();
          const html = !c
            ? `<h2 class="text-sm font-bold text-white"><i class="fa-solid fa-collega text-amber-400 mr-1"></i>Manda i lavori al laboratorio</h2>
               <p class="text-xs text-slate-300">Il tablet del laboratorio non è ancora collegato. Collegalo una volta sola: poi i lavori arrivano da soli.</p>
               <p class="text-[11px] text-slate-400">1. Tocca «Collega il tablet»: compare un QR.<br>2. Sul tablet: Laboratorio → «Collega la sincronizzazione» → «Inquadra il QR».</p>
               <button type="button" id="homeLabCollega" class="w-full bg-amber-500 text-slate-950 font-bold rounded-lg" style="min-height:48px">Collega il tablet</button>`
            : `<h2 class="text-sm font-bold text-white"><i class="fa-solid fa-collega text-emerald-400 mr-1"></i>Laboratorio</h2>
               <p class="text-xs text-slate-300">${n ? `<strong>${n}</strong> ${n === 1 ? 'lavoro in produzione va' : 'lavori in produzione vanno'} al tablet da soli.` : 'Nessun lavoro da mandare adesso.'}
                 Un lavoro arriva in laboratorio quando il preventivo è accettato e ci resta fino al montaggio.</p>
               <p class="text-[11px] text-slate-400">${esc(testoStato())}</p>
               <button type="button" id="homeLabManda" class="w-full bg-amber-500 text-slate-950 font-bold rounded-lg" style="min-height:44px">Manda ora</button>`;
          if (html === ultimo) return;
          ultimo = html; card.innerHTML = html;
        }
        card.addEventListener('click', async e => {
          const b = e.target && e.target.closest && e.target.closest('button'); if (!b) return;
          if (b.id === 'homeLabCollega') { const r = document.getElementById('impSinc'); if (r) r.click(); else conMessaggio(attivaSincTitolare)(); }
          else if (b.id === 'homeLabManda') { b.disabled = true; try { const r = await sincronizzaOraTutto(); avvisoGuardia(r && r.errore ? 'Sincronizzazione: ' + r.errore : 'Lavori mandati al laboratorio.', r && r.errore ? 'errore' : 'ok'); } finally { b.disabled = false; ultimo = ''; disegna(); } }
        });
        disegna();
        setInterval(() => { if (document.visibilityState === 'visible') disegna(); }, 5000);
        document.addEventListener('visibilitychange', disegna);
      })();

      // ---------- nella pagina: Laboratorio ----------
      const info = document.getElementById('labInfo');
      if (info) {
        const p = document.createElement('p');
        p.id = 'labSinc'; p.className = 'text-[11px] text-slate-400';
        info.after(p);
      }
      // «Aggiorna lavori»: con la sincronizzazione collegata, sincronizza invece di chiedere un file
      document.addEventListener('click', e => {
        const b = e.target && e.target.closest && e.target.closest('#viewLaboratorio .lab-strum');
        if (!b || !sinc() || !/importFile/.test(b.getAttribute('data-click') || '')) return;
        e.preventDefault(); e.stopImmediatePropagation();
        sincronizzaOraTutto().then(es => avvisoGuardia(es && es.errore ? 'Sincronizzazione: ' + es.errore
          : es && es.ricevuti ? 'Lavori aggiornati dal titolare.' : 'Già aggiornato: nessun lavoro nuovo dal titolare.', es && es.errore ? 'errore' : 'info'));
      }, true);

      // ---------- nella pagina: Impostazioni ----------
      const corpoLab = document.getElementById('catCorpo_laboratorio'), corpoAsp = document.getElementById('catCorpo_aspetto');
      if (corpoLab) {
        const box = document.createElement('div');
        box.className = 'space-y-2';
        box.innerHTML = `<p class="text-sm font-semibold text-white">Sincronizzazione automatica</p>` +
          rigaImp('impSinc', 'fa-rotate-right', 'text-sky-400', 'Sincronizzazione con il laboratorio') +
          rigaImp('impSincOra', 'fa-rotate-right', 'text-emerald-400', 'Sincronizza ora') +
          rigaImp('impSincCodice', 'fa-lucchetto', 'text-amber-400', 'Codice di abbinamento') +
          rigaImp('impSincDisp', 'fa-lucchetto', 'text-sky-400', 'Dispositivi abbinati') +
          rigaImp('impSincNuovo', 'fa-lucchetto', 'text-amber-400', 'Cambia codice') +
          rigaImp('impSincNo', 'fa-xmark', 'text-slate-300', 'Scollega la cartella') +
          `<p class="text-sm font-semibold text-white" style="margin-top:8px">Questo telefono</p>` +
          rigaImp('impDocs', 'fa-folder', 'text-emerald-400', 'Cartella dei documenti') +
          rigaImp('impDocsNo', 'fa-xmark', 'text-slate-300', 'Non usare più la cartella dei documenti') +
          rigaImp('impCassa', 'fa-lucchetto', 'text-amber-400', 'Password di emergenza e impronta') +
          rigaImp('impBlocco', 'fa-lucchetto', 'text-amber-400', 'Impronta quando torni nell\'app', true) +
          `<p class="text-sm font-semibold text-white" style="margin-top:8px">Tablet del laboratorio</p>` +
          rigaImp('impFissa', 'fa-lucchetto', 'text-sky-400', 'Blocca il tablet su DoctorWood', true) +
          rigaImp('impFissaPin', 'fa-lucchetto', 'text-slate-300', 'Fissa app e PIN di Android');
        const ultimo = corpoLab.lastElementChild;
        corpoLab.insertBefore(box, ultimo && ultimo.tagName === 'P' ? ultimo : null);
        $('impSinc').addEventListener('click', () => { if (!sinc()) conMessaggio(attivaSincTitolare)(); });
        $('impSincOra').addEventListener('click', async () => { const e = await sincronizzaOraTutto(); avvisoGuardia(e && e.errore ? 'Sincronizzazione: ' + e.errore : e && e.ricevuti ? `Sincronizzato: ${e.ricevuti === 1 ? '1 novità' : e.ricevuti + ' novità'} dal laboratorio.` : 'Sincronizzato.', e && e.errore ? 'errore' : 'ok'); });
        $('impSincCodice').addEventListener('click', conMessaggio(mostraCodice));
        $('impSincDisp').addEventListener('click', conMessaggio(dispositiviAbbinati));
        $('impSincNuovo').addEventListener('click', conMessaggio(cambiaCodice));
        $('impDocs').addEventListener('click', () => { chiudiModale('modalImpostazioni'); conMessaggio(() => window.scegliCartellaDocumenti(!window.cartellaDocumentiScelta()))(); });
        $('impDocsNo').addEventListener('click', conMessaggio(window.togliCartellaDocumenti));
        $('impCassa').addEventListener('click', () => { if (!chiaviPronte()) { chiudiModale('modalImpostazioni'); conMessaggio(preparaCassaforte)(false); } });
        $('impSincNo').addEventListener('click', conMessaggio(disattivaSinc));
        $('impBlocco').addEventListener('click', () => { try { S.setItem('doctorwood_blocco_titolare', bloccoScelto() ? 'no' : 'si'); } catch (_) {} aggiornaRigheImp(); });
        $('impFissa').addEventListener('click', () => { try { S.setItem('doctorwood_fissa_lab', fissaScelta() ? 'no' : 'si'); } catch (_) {} aggiornaRigheImp(); });
        $('impFissaPin').addEventListener('click', () => lab('apriImpostazioniSicurezza').catch(() => {}));
      }
      // ---------- prima di disinstallare: cancellare ogni traccia ----------
      // Android cancella da solo la cartella privata dell'app quando la disinstalli, ma non avvisa l'app:
      // i file che DoctorWood ha scritto nella cartella di sincronizzazione resterebbero. Qui si toglie tutto.
      async function cancellaTutto() {
        const c = sinc();
        const r1 = await finestra({ titolo: 'Cancella tutto da questo dispositivo',
          testoMsg: 'Prima di disinstallare DoctorWood puoi cancellare ogni traccia:\n• tutti i dati (clienti, lavori, preventivi, magazzino, agenda, rilievi, schede, foto, impostazioni);\n• le chiavi della cassaforte e della sincronizzazione;\n' + (c && !diretta(c) ? '• i file di DoctorWood nella cartella «' + c.nome + '»;\n' : c ? '• gli abbinamenti della sincronizzazione diretta;\n' : '') + '\nRestano solo i file che hai salvato tu (backup, PDF, condivisioni)' + (c && !diretta(c) ? ' e le copie già caricate su Drive dall\'app di sincronizzazione' : '') + ': cancellali a mano se vuoi.\n\nNon si può annullare. Se ti servono i dati, fai prima un backup.',
          si: 'Continua', alt: 'Fai prima un backup' });
        if (r1.esito === 'alt') { chiudiModale('modalImpostazioni'); try { esportaBackup(); } catch (_) {} return; }
        if (r1.esito !== 'si') return;
        let errore = '';
        for (;;) {
          const r2 = await finestra({ titolo: 'Conferma', testoMsg: 'Per confermare scrivi CANCELLA.', si: 'Cancella tutto', password: 1, campo: 'testo', segnaposto: 'CANCELLA', errore });
          if (r2.esito !== 'si') return;
          if (String(r2.pw1 || '').trim().toUpperCase() === 'CANCELLA') break;
          errore = 'Scrivi CANCELLA per confermare.';
        }
        try { await nat('verificaIdentita', { titolo: 'DoctorWood', sottotitolo: 'Conferma per cancellare tutto' }); }
        catch (_) { avvisoGuardia('Cancellazione annullata: identità non confermata.', 'annullato'); return; }
        attesa('Cancella tutto', 'Cancello i dati…');
        if (c && !diretta(c)) {
          try {
            const elenco = ((await lab('elencoCartella', { uri: c.uri, prefisso: 'doctorwood-' })).file) || [];
            for (const f of elenco) if (/^doctorwood-[A-Za-z0-9._-]*\.dwsync$/.test(f.nome)) { try { await lab('eliminaFile', { uri: c.uri, nome: f.nome }); } catch (_) {} }
          } catch (_) {}
        }
        // prima Android (che controlla di nuovo impronta/PIN): se rifiuta, qui non si è cancellato ancora niente
        try { await lab('cancellaTutto'); }
        catch (e) {
          chiudiAttesa();
          avvisoGuardia('Cancellazione non fatta: ' + (e && e.code === 'IDENTITA' ? 'conferma di nuovo con impronta o PIN.' : String(e && e.message || e)), 'errore');
          return;
        }
        chiusuraInCorso = true;   // da qui nessun salvataggio automatico riscrive niente (Android sta già chiudendo l'app)
        try { S.clear(); sessionStorage.clear(); } catch (_) {}
        try { indexedDB.databases && indexedDB.databases().then(dbs => (dbs || []).forEach(d => indexedDB.deleteDatabase(d.name))).catch(() => {}); } catch (_) {}
        await veloBlu(true);
      }
      const corpoDati = document.getElementById('catCorpo_dati');
      if (corpoDati) {
        const box = document.createElement('div');
        box.innerHTML = rigaImp('impCancella', 'fa-trash-can', 'text-rose-400', 'Cancella tutto da questo dispositivo');
        corpoDati.appendChild(box);
        $('impCancella').addEventListener('click', () => { chiudiModale('modalImpostazioni'); conMessaggio(cancellaTutto)(); });
      }
      if (corpoAsp) {
        const box = document.createElement('div');
        box.innerHTML = `<p class="text-sm font-semibold text-white">Fluidità dello schermo</p>` +
          `<div id="impHz" role="radiogroup" aria-label="Fluidità dello schermo" class="grid grid-cols-3 gap-2 mt-1">` +
          `<button type="button" role="radio" data-hz="auto" class="opz-imp text-xs" style="min-height:48px">Automatica</button>` +
          `<button type="button" role="radio" data-hz="massima" class="opz-imp text-xs" style="min-height:48px">Massima</button>` +
          `<button type="button" role="radio" data-hz="60" class="opz-imp text-xs" style="min-height:48px">60 Hz</button></div>` +
          `<p id="impHzNota" class="text-[11px] text-slate-400 mt-1"></p>`;
        corpoAsp.appendChild(box);
        box.querySelectorAll('[data-hz]').forEach(b => b.addEventListener('click', () => {
          try { S.setItem('doctorwood_frequenza', b.dataset.hz); } catch (_) {}
          applicaFrequenza(); aggiornaRigheImp();
        }));
      }
      function aggiornaRigheImp() {
        const c = sinc(), set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
        const mostra = (id, si) => { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', !si); };
        set('impSincSotto', c ? testoStato() : 'Spenta · tocca per attivarla');
        mostra('impSincOra', !!c); mostra('impSincCodice', !!(c && c.codice)); mostra('impSincNo', !!c); mostra('impSincDisp', diretta(c)); mostra('impSincNuovo', !!(c && c.codice));
        set('impSincNuovoSotto', 'Dopo un tablet perso: i dispositivi si ricollegano');
        set('impSincDispSotto', 'Vedi o togli un tablet (per esempio se lo perdi)');
        set('impSincOraSotto', 'Invia i lavori, legge le spunte');
        set('impSincCodiceSotto', diretta(c) ? 'Per abbinare un tablet (10 minuti)' : 'Da scrivere sul tablet');
        set('impSincNoSotto', diretta(c) ? 'Dimentica gli abbinamenti' : 'I file restano nella cartella');
        const bl = document.getElementById('impBlocco');
        if (bl) { bl.setAttribute('aria-checked', bloccoScelto() ? 'true' : 'false'); bl.classList.toggle('hidden', !puoBloccare); }
        set('impBloccoSotto', 'Impronta o PIN del telefono');
        set('impDocsSotto', window.cartellaDocumentiScelta() ? `«${window.cartellaDocumentiScelta()}» · una sottocartella per sezione e per formato · tocca per cambiarla` : 'Non scelta · tocca per sceglierla: documenti, foto e dati in ordine');
        mostra('impDocsNo', !!window.cartellaDocumentiScelta());
        set('impCassaSotto', chiaviPronte() ? 'Impostate ✓' : 'Da impostare · tocca per farlo');
        const ic = document.getElementById('impCassa');
        if (ic) ic.style.opacity = chiaviPronte() ? '0.75' : '';
        const f = document.getElementById('impFissa');
        if (f) f.setAttribute('aria-checked', fissaScelta() ? 'true' : 'false');
        set('impFissaSotto', 'In Laboratorio resta aperta solo DoctorWood');
        set('impCancellaSotto', 'Prima di disinstallare: non resta nulla');
        set('impFissaPinSotto', 'Attiva «Chiedi il PIN prima di sbloccare»');
        const s = sceltaFrequenza();
        document.querySelectorAll('#impHz [data-hz]').forEach(b => b.setAttribute('aria-checked', b.dataset.hz === s ? 'true' : 'false'));
        const bm = document.querySelector('#impHz [data-hz="massima"]');
        if (bm) bm.textContent = hzMassimi > 60 ? `Massima (${hzMassimi} Hz)` : 'Massima';
        set('impHzNota', 'Massima: più fluida, un po\' più batteria.');
        const ra = document.getElementById('catRiass_aspetto');
        if (ra) ra.textContent = ra.textContent.replace(/ · schermo .*$/, '') + ` · schermo ${{ auto: 'automatico', massima: 'massimo', 60: '60 Hz' }[s]}`;
        const rl = document.getElementById('catRiass_laboratorio');
        if (rl) rl.textContent = rl.textContent.replace(/ · sincronizzato$/, '') + (c ? ' · sincronizzato' : '');
      }
      const riempiOrig = riempiImpostazioni;
      riempiImpostazioni = function () { const r = riempiOrig.apply(this, arguments); try { aggiornaRigheImp(); disegnaAggiornamenti(); } catch (_) {} return r; };
      aggiornaStatoSinc();
    })();
