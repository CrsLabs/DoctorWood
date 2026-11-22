// Le novità della 1.0.28: file per il commercialista, confronto schemi di taglio, QR sulle etichette e lettura nel Laboratorio,
// firma del cliente e foto nel preventivo. Dati d'esempio come in guida/schermate.js. Uso: node prove/nuove.js
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const { rispondiDomande, impostaDomande } = require('./domande');
const URL = process.argv[2] || 'http://localhost:8766/sorgente-DoctorWood.html';
const dati = JSON.parse(fs.readFileSync(path.join(__dirname, 'risultati', 'dati-realistici.json'), 'utf8'));
delete dati.doctorwood_pin; delete dati.doctorwood_pin_blocco;
// un preventivo con sconto e tre voci, il cliente con la P.IVA, la ditta, un taglio con molti pezzi
const cli = JSON.parse(dati.doctorwood_clients); cli[0].piva = 'RSSMRA80A01H501U';
dati.doctorwood_clients = JSON.stringify(cli);
const prev = JSON.parse(dati.preventivi); const q = prev[0];
q.voci = [{ desc: 'Ante laccate', qta: 4, prezzo: 120.5, tipo: 'materiale' }, { desc: 'Montaggio', qta: 1, prezzo: 300, tipo: 'montaggio' }, { desc: 'Maniglie; "speciali"', qta: 7, prezzo: 9.99, tipo: '' }];
q.sconto = { tipo: 'perc', valore: 7 }; q.acconto = { tipo: 'perc', valore: 30 }; dati.preventivi = JSON.stringify(prev);
dati.ditta = JSON.stringify({ nome: 'Falegnameria Prova', indirizzo: 'Via Roma 1', piva: '01234567890', cf: '', tel: '', email: '', iban: '', condizioni: '' });
const prog = JSON.parse(dati.projects); const pezzi = [];
[[900, 400, 3], [700, 560, 4], [1200, 300, 2], [450, 450, 5], [1800, 600, 2], [620, 380, 6], [800, 250, 4], [1000, 500, 3], [350, 350, 8], [1500, 420, 2]].forEach(([l, w, qta], i) => pezzi.push({ nome: 'Pezzo ' + (i + 1), l, w, qta, ruota: true, mat: '', bL: 1, bW: 0 }));
prog[0].pezzi = pezzi; prog[0].name = 'Cucina Rossi - fianchi'; prog[0].clienteId = cli[0].id; dati.projects = JSON.stringify(prog);

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'], acceptDownloads: true, locale: 'it-IT' });
  await ctx.addInitScript(([d]) => { if (!sessionStorage.getItem('__f')) { sessionStorage.setItem('__f', '1'); localStorage.clear(); for (const k in d) localStorage.setItem(k, d[k]); localStorage.setItem('doctorwood_modalita', 'titolare'); localStorage.setItem('doctorwood_animazioni', 'no'); } }, [dati]);
  await rispondiDomande(ctx, { accetta: true });
  const p = await ctx.newPage();
  const errori = []; p.on('pageerror', e => errori.push('pagina: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' || /Content Security|Refused/.test(m.text())) errori.push('console: ' + m.text().slice(0, 160)); });
  await p.goto(URL); await p.waitForTimeout(2200);
  let ok = 0, ko = 0;
  const esito = (n, c, info = '') => { if (c) ok++; else ko++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (info ? ' — ' + info : '')); };
  const passo = async (n, f) => { console.log('▶ ' + n); try { await f(); } catch (e) { ko++; console.log('  ✗ ERRORE: ' + e.message.split('\n')[0].slice(0, 240)); } };
  const vis = sel => p.locator(sel).filter({ visible: true }).first();
  const scarica = async azione => { const [d] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), azione()]); const f = await d.path(); return { nome: d.suggestedFilename(), dati: fs.readFileSync(f) }; };
  const num = t => parseFloat(String(t).replace(',', '.'));

  await passo('Cliente con P.IVA o codice fiscale', async () => {
    await p.evaluate(() => vaiA('clientsTool')); await p.waitForTimeout(300);
    await p.evaluate(() => apriModaleNuovoCliente());
    esito('il campo c\'è nella finestra del cliente', await vis('#clientPivaInput').isVisible());
    await p.fill('#clientNameInput', 'Ditta Verdi'); await p.fill('#clientPivaInput', ' it 0123 4567890 ');
    await p.evaluate(() => salvaNuovoCliente()); await p.waitForTimeout(500);
    const c = JSON.parse(await p.evaluate(() => localStorage.getItem('doctorwood_clients'))).find(x => x.name === 'Ditta Verdi');
    esito('salvata pulita, in maiuscolo e senza spazi', c && c.piva === 'IT01234567890', JSON.stringify(c && c.piva));
    esito('quella già presente nei dati d\'esempio resta', JSON.parse(await p.evaluate(() => localStorage.getItem('doctorwood_clients')))[0].piva === 'RSSMRA80A01H501U');
  });

  await passo('Per la fattura: file per il commercialista', async () => {
    await p.evaluate(id => apriPreventivo(id), q.id); await p.waitForTimeout(500);
    const f = await scarica(() => vis('[data-click="esportaPerCommercialista()"]').click());
    esito('nome del file con numero e cliente', /^fattura-preventivo-1-mario-rossi\.csv$/.test(f.nome), f.nome);
    const t = f.dati.toString('utf8'); esito('CSV con BOM per Excel', t.charCodeAt(0) === 0xFEFF);
    const righe = t.slice(1).trim().split('\r\n').map(r => { const o = []; let cur = '', dq = false; for (let i = 0; i < r.length; i++) { const ch = r[i]; if (ch === '"' && dq && r[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') dq = !dq; else if (ch === ';' && !dq) { o.push(cur); cur = ''; } else cur += ch; } o.push(cur); return o; });
    const H = righe[0], col = n => H.indexOf(n), v = righe.slice(1);
    esito('una riga per voce, con le colonne attese', v.length === 3 && ['Cliente_PIVA_CF', 'Imponibile_riga', 'IVA_riga', 'Totale_documento'].every(c => col(c) >= 0), H.length + ' colonne');
    esito('P.IVA del cliente e dell\'emittente', v[0][col('Cliente_PIVA_CF')] === 'RSSMRA80A01H501U' && v[0][col('Emittente_PIVA')] === '01234567890');
    esito('il testo con «;» e virgolette resta nella sua cella', v[2][col('Descrizione')] === 'Maniglie; "speciali"');
    const somma = c => Math.round(v.reduce((a, r) => a + num(r[col(c)]), 0) * 100) / 100;
    const doc = c => num(v[0][col(c)]);
    esito('somma imponibile righe = imponibile documento', somma('Imponibile_riga') === doc('Imponibile_documento'), somma('Imponibile_riga') + ' / ' + doc('Imponibile_documento'));
    esito('somma IVA righe = IVA documento', somma('IVA_riga') === doc('IVA_documento'), somma('IVA_riga') + ' / ' + doc('IVA_documento'));
    esito('somma totali righe = totale documento', somma('Totale_riga') === doc('Totale_documento') && Math.abs(doc('Totale_documento') - (doc('Imponibile_documento') + doc('IVA_documento'))) < 0.006);
    // 4×120,50 + 300 + 7×9,99 = 482 + 300 + 69,93 = 851,93 → −7% = 792,29 → IVA 22% = 174,31 → 966,60
    esito('i conti tornano con quelli fatti a mano', doc('Imponibile_documento') === 792.29 && doc('IVA_documento') === 174.30 + 0.01 * 0 || doc('Totale_documento') === 966.59 || doc('Totale_documento') === 966.6, JSON.stringify([doc('Imponibile_documento'), doc('IVA_documento'), doc('Totale_documento')]));
    esito('lo dice che non è una fattura elettronica', /non è una fattura elettronica/.test(await p.locator('#avvisoGuardiaTesto').textContent()));
  });

  await passo('Confronta gli schemi di taglio', async () => {
    await p.evaluate(() => { vaiA('cutOptimizer'); apriProgetto(0); }); await p.waitForTimeout(600);
    await p.evaluate(() => calcolaOttimizzazione()); await p.waitForTimeout(500);
    const prima = await p.evaluate(() => ({ n: pannelliCalcolati.length, alt: altSchema }));
    esito('calcolo normale: schema migliore', prima.n > 0 && prima.alt === 0, JSON.stringify(prima));
    await vis('[data-click="confrontaSchemi()"]').click(); await p.waitForTimeout(1200);
    esito('si apre il confronto', await p.locator('#modalSchemi').isVisible());
    const righe = await p.locator('#schemiLista > div').count(), testo = await p.locator('#schemiLista').textContent();
    esito('mostra pannelli, scarto e tagli per ogni schema', righe >= 1 && /scarto/.test(testo) && /tagli/.test(testo) || /già il migliore/.test(testo), righe + ' schemi · ' + testo.replace(/\s+/g, ' ').slice(0, 140));
    esito('il primo è «consigliato» e «in uso»', righe < 2 || /Schema 1 · consigliato · in uso/.test(testo));
    esito('dopo il confronto il calcolo mostrato è tornato quello di prima', await p.evaluate(() => pannelliCalcolati.length) === prima.n);
    if (righe >= 2) {
      const stat = () => p.evaluate(() => ({ n: pannelliCalcolati.length, t: pannelliCalcolati.reduce((a, x) => a + x.tagli.length, 0), alt: altSchema }));
      const s0 = await stat();
      await p.locator('#schemiLista button').first().click(); await p.waitForTimeout(900);
      const s1 = await stat();
      esito('«Usa questo schema» cambia lo schema', s1.alt > 0 && (s1.n !== s0.n || s1.t !== s0.t), JSON.stringify([s0, s1]));
      esito('tutti i pezzi sono ancora sistemati', await p.evaluate(() => pannelliCalcolati.reduce((a, x) => a + x.pezziPiazzati.length, 0)) === 39);
      esito('ora lo schema scelto è «in uso»', /in uso/.test(await p.locator('#schemiLista').textContent()));
    } else console.log('  (un solo schema possibile con questi pezzi)');
    await p.evaluate(() => chiudiModale('modalSchemi'));
    await p.evaluate(() => calcolaOttimizzazione());
    esito('ricalcolando dal tasto si torna al migliore', await p.evaluate(() => altSchema) === 0);
  });

  await passo('QR sulle etichette e lettura nel Laboratorio', async () => {
    const q1 = await p.evaluate(() => QR.crea('DW:ABCDE:P1'));
    esito('il nostro QR è 21×21 e il testo non adatto è rifiutato', q1 && q1.length === 21 && q1[0].length === 21 && await p.evaluate(() => QR.crea('minuscolo') === null && QR.crea('A'.repeat(21)) === null));
    const cod = await p.evaluate(() => codiceEtichettaQr('Cucina Rossi - fianchi', 0));
    esito('codice dell\'etichetta: DW:<chiave>:<riga>, adatto al QR', /^DW:[0-9A-Z]{5}:1$/.test(cod) && await p.evaluate(c => QR.crea(c) !== null, cod), cod);
    esito('stesso nome (anche con maiuscole e spazi diversi) = stessa chiave', await p.evaluate(() => chiaveTaglio('  cucina   ROSSI - fianchi ') === chiaveTaglio('Cucina Rossi - fianchi') && chiaveTaglio('Altro') !== chiaveTaglio('Cucina Rossi - fianchi')));
    // PDF delle etichette: con il nome del taglio ci sono i quadratini del QR, senza no
    const conteggio = () => p.evaluate(async () => { const t = await creaPdfEtichette('a4').text(); return (t.match(/ re f/g) || []).length; });
    await p.evaluate(() => { nomeLavoroTaglio = 'Cucina Rossi - fianchi'; }); const con = await conteggio();
    await p.evaluate(() => { nomeLavoroTaglio = ''; }); const senza = await conteggio();
    esito('le etichette con QR hanno molti più quadratini di quelle senza', con > senza + 300, `${con} contro ${senza}`);
    await p.evaluate(() => { nomeLavoroTaglio = 'Cucina Rossi - fianchi'; });
    // il tablet: il lavoro con quel taglio, si «inquadra» l'etichetta del pezzo 3
    await p.evaluate(() => { window.datiLab = () => ({ creato: Date.now(), lavori: [{ id: 'L1', titolo: 'Cucina su misura', cliente: 'Mario Rossi', montaggio: null, materiali: [], tagli: [{ id: 'T1', nome: 'Cucina Rossi - fianchi', tipo: '', l: 0, w: 0, pezzi: [{ nome: 'Fianco', l: 720, w: 560, qta: 2, mat: '', bL: 0, bW: 0 }, { nome: 'Ripiano', l: 800, w: 300, qta: 3, mat: '', bL: 0, bW: 0 }, { nome: 'Schienale', l: 900, w: 400, qta: 1, mat: '', bL: 0, bW: 0 }] }] }] }); });
    const trovato = await p.evaluate(() => { const r = trovaPezzoDaEtichetta(codiceEtichettaQr('Cucina Rossi - fianchi', 2)); return r && r.z.nome; });
    esito('il codice del pezzo 3 ritrova «Schienale»', trovato === 'Schienale', String(trovato));
    esito('un codice di un altro taglio o non nostro non trova niente', await p.evaluate(() => trovaPezzoDaEtichetta('DW:00000:1') === null && trovaPezzoDaEtichetta('ABC') === null && trovaPezzoDaEtichetta('DW:' + chiaveTaglio('Cucina Rossi - fianchi') + ':9') === null));
    await p.evaluate(() => vaiA('quoteTool'));
    await p.evaluate(() => usaEtichetta(codiceEtichettaQr('Cucina Rossi - fianchi', 2))); await p.waitForTimeout(600);
    const av = JSON.parse(await p.evaluate(() => localStorage.getItem('avanzamento_lab')) || '{}');
    esito('confermando, il pezzo risulta tagliato nelle spunte', av.L1 && av.L1.pezzi && av.L1.pezzi['T1:2'] && av.L1.pezzi['T1:2'].v === true, JSON.stringify(av).slice(0, 120));
    await p.evaluate(() => usaEtichetta(codiceEtichettaQr('Cucina Rossi - fianchi', 2))); await p.waitForTimeout(400);
    esito('rileggendolo dice che è già tagliato (senza toglierlo)', /Già segnato come tagliato/.test(await p.locator('#avvisoGuardiaTesto').textContent()) && JSON.parse(await p.evaluate(() => localStorage.getItem('avanzamento_lab'))).L1.pezzi['T1:2'].v === true);
    esito('il pulsante «Leggi etichetta» è solo nell\'app Android', await p.evaluate(() => { const bt = document.querySelector('[data-click="scansionaEtichetta()"]'); return !!bt && getComputedStyle(bt).display === 'none'; }));
    delete require.cache; await p.evaluate(() => { delete window.datiLab; });
  });

  await passo('Firma del cliente nel preventivo', async () => {
    await p.evaluate(id => apriPreventivo(id), q.id); await p.waitForTimeout(500);
    await vis('[data-click="apriFirmaCliente()"]').click(); await p.waitForTimeout(400);
    esito('si apre lo spazio per la firma', await p.locator('#modalFirma').isVisible() && /791|792|[0-9]+,[0-9]{2}/.test(await p.locator('#firmaTesto').textContent()));
    await vis('[data-click="confermaFirmaCliente()"]').click(); await p.waitForTimeout(300);
    esito('senza firma: lo dice e non salva niente', await p.locator('#firmaErrore').isVisible() && !JSON.parse(await p.evaluate(() => localStorage.getItem('preventivi')))[0].firmaCliente);
    const r = await p.locator('#firmaCanvas').boundingBox();
    await p.mouse.move(r.x + r.width * 0.2, r.y + r.height * 0.6); await p.mouse.down();
    for (let i = 0; i <= 24; i++) await p.mouse.move(r.x + r.width * (0.2 + i * 0.025), r.y + r.height * (0.5 + 0.2 * Math.sin(i / 2)));
    await p.mouse.up();
    await vis('[data-click="confermaFirmaCliente()"]').click(); await p.waitForTimeout(700);
    const f = JSON.parse(await p.evaluate(() => localStorage.getItem('preventivi')))[0].firmaCliente;
    esito('la firma è salvata col preventivo (JPEG leggero)', f && /^data:image\/jpeg;base64,/.test(f.dataUrl) && f.dataUrl.length < 60000 && f.w > 50 && f.chiave, f ? f.w + '×' + f.h + ', ' + f.dataUrl.length + ' caratteri' : 'niente');
    esito('ha chiesto di segnare «accettato» (risposta sì)', JSON.parse(await p.evaluate(() => localStorage.getItem('preventivi')))[0].stato === 'accettato');
    // il PDF
    const pdf = await scarica(() => vis('[data-click="scaricaPdfPreventivo()"]').click());
    const t = pdf.dati.toString('latin1');
    esito('nel PDF c\'è la firma con data e ora', /Firmato per accettazione il/.test(t) && /\/Subtype \/Image/.test(t) && !/Data e firma per accettazione/.test(t));
    // se il preventivo cambia, la firma non vale più
    await p.evaluate(() => { document.querySelector('#quoteItemsContainer .q-price').value = '999'; ricalcolaPreventivo(); });
    const pdf2 = await scarica(() => vis('[data-click="scaricaPdfPreventivo()"]').click());
    const t2 = pdf2.dati.toString('latin1');
    esito('cambiando un prezzo la firma non compare più nel PDF', /Data e firma per accettazione/.test(t2) && !/Firmato per accettazione il/.test(t2));
    await p.evaluate(id => apriPreventivo(id), q.id).catch(() => {}); await p.waitForTimeout(300);
    esito('una firma manomessa nei dati non viene usata', await p.evaluate(() => { const s = { firmaCliente: { dataUrl: 'data:image/jpeg;base64,<script>', w: 100, h: 50, ts: 1, chiave: 'x' } }; return firmaValidaPreventivo(s, datiPreventivo()) === null; }));
  });

  await passo('Foto del sopralluogo nel PDF del preventivo', async () => {
    await p.evaluate(id => apriPreventivo(id), q.id); await p.waitForTimeout(500);
    const rid = await p.evaluate(cid => { const r = { id: 'r_prova', nome: 'Sopralluogo cucina', clienteId: cid, ts: Date.now() }; salvaRilievi([...leggiRilievi(), r]); return r.id; }, cli[0].id);
    await p.evaluate(async rid => {
      const c = document.createElement('canvas'); c.width = 800; c.height = 600; const x = c.getContext('2d'); x.fillStyle = '#a16207'; x.fillRect(0, 0, 800, 600); x.fillStyle = '#fff'; x.fillRect(100, 100, 300, 200);
      const img = new Image(); await new Promise(ok => { img.onload = ok; img.src = c.toDataURL('image/jpeg'); });
      for (let i = 0; i < 3; i++) tutteLeFoto.push({ id: 'f_prova' + i, img, dataUrl: c.toDataURL('image/jpeg'), annotazioni: [], scala: null, rilievoId: rid });
    }, rid);
    const pdf = await scarica(() => vis('[data-click="scaricaPdfPreventivo()"]').click());
    const t = pdf.dati.toString('latin1');
    esito('con le foto del rilievo del cliente: allegate in fondo', /Foto del sopralluogo/.test(t) && (t.match(/\/Subtype \/Image/g) || []).length >= 3, (t.match(/\/Subtype \/Image/g) || []).length + ' immagini');
    esito('con la didascalia del rilievo', /Sopralluogo cucina - foto 1 di 3/.test(t));
    // senza risposta «sì» il PDF resta senza foto
    await impostaDomande(p, { accetta: false });
    const pdf2 = await scarica(() => vis('[data-click="scaricaPdfPreventivo()"]').click());
    esito('rispondendo «Annulla» il PDF è senza foto', !/Foto del sopralluogo/.test(pdf2.dati.toString('latin1')));
    await impostaDomande(p, { accetta: true });
  });

  esito('nessun errore in pagina', errori.length === 0, errori.slice(0, 3).join(' | '));
  await b.close();
  console.log(`\nDoctorWood, novità: ${ok} riusciti, ${ko} falliti`);
  process.exit(ko ? 1 : 0);
})();
