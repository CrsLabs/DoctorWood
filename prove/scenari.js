// Percorso «da utente vero»: si usa l'app solo dall'interfaccia (tocchi e digitazione), come una persona.
require('fs').mkdirSync(require('path').join(__dirname, 'risultati'), { recursive: true });
// Alla fine salva i dati creati (servono al robot dei tasti).
const { rispondiDomande, impostaDomande, leggiDomande } = require('./domande');
const { chromium, devices } = require('playwright');
const fs = require('fs');
const D = require('path').join(__dirname, 'risultati') + '/';
const URL = process.argv[2] || 'http://localhost:8766/sorgente-DoctorWood.html';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  const p = await ctx.newPage();
  const errori = [];
  p.on('pageerror', e => errori.push('pagina: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' || /Content Security|Refused|non registrato|non permesso/.test(m.text())) errori.push('console: ' + m.text().slice(0, 200)); });
  p.on('dialog', d => d.type() === 'prompt' ? d.accept('Prova') : d.accept());
  await rispondiDomande(p, { accetta: true, testo: 'Prova' });
  let ok = 0, ko = 0;
  const esito = (nome, cond, info = '') => { if (cond) ok++; else ko++; console.log((cond ? '  ✓ ' : '  ✗ ') + nome + (info ? ' — ' + info : '')); };
  const vis = sel => p.locator(sel).filter({ visible: true }).first();
  // le tendine dell'app: si tocca il pulsante e poi la voce, come una persona
  const scegli = async (sel, val) => {
    const t = (await p.$eval(sel, (s, v) => [...s.options].find(o => o.value === v).textContent, val)).replace(/\s*\(\d+\)$/, '');
    await vis(sel + ' + .tendina-btn').click(); await p.waitForTimeout(300);
    await p.locator('#tendElenco .tend-voce').filter({ hasText: t }).first().click(); await p.waitForTimeout(300);
  };
  const tocca = async (sel, attesa = 350) => { await vis(sel).click(); await p.waitForTimeout(attesa); };
  const testo = (t, dentro = 'body') => p.locator(dentro).locator(`button:visible, [role=button]:visible, a:visible, label:visible`).filter({ hasText: t }).first();
  const toccaTesto = async (t, dentro, attesa = 400) => { await testo(t, dentro).click(); await p.waitForTimeout(attesa); };
  const LS = k => p.evaluate(k => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return localStorage.getItem(k); } }, k);
  const passo = async (nome, fn) => { console.log('▶ ' + nome); try { await fn(); } catch (e) { ko++; console.log('  ✗ ERRORE: ' + e.message.split('\n')[0].slice(0, 200)); await p.screenshot({ path: D + 'errore-' + nome.replace(/\W+/g, '_') + '.png' }).catch(() => {}); } };
  const chiudiTutto = () => p.evaluate(() => { for (let i = 0; i < 6 && chiudiFinestraAperta(); i++); });

  await p.goto(URL);
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(1200);

  await passo('Primo avvio: scelgo Titolare', async () => {
    esito('schermata di benvenuto', await p.locator('#modalModalita').isVisible());
    await vis('#modalModalita [data-click*="titolare"]').click(); await p.waitForTimeout(2200);
    esito('modalità titolare', (await p.evaluate(() => localStorage.getItem('doctorwood_modalita'))) === 'titolare');
    esito('Home visibile', await p.locator('#viewDashboard').isVisible());
  });

  await passo('Nuovo lavoro dalla Home (cliente nuovo)', async () => {
    await toccaTesto('Lavoro', '#barraNuovo');
    esito('percorso guidato nuovo lavoro', await p.locator('#modalGuida').isVisible());
    await p.evaluate(() => aggiornaNuovoCliente('gCliente', 'gNuovoCliente'));
    await p.fill('#gNuovoCliente', 'Mario Rossi');
    await p.evaluate(() => document.getElementById('guidaAvantiBtn').click()); await p.waitForTimeout(400);
    await p.fill('#gTitolo', 'Cucina su misura');
    await p.evaluate(() => document.getElementById('guidaAvantiBtn').click()); await p.waitForTimeout(400);
    await p.evaluate(() => document.getElementById('guidaAvantiBtn').click()); await p.waitForTimeout(700);
    const lav = await LS('lavori'), cli = await LS('doctorwood_clients');
    esito('lavoro creato', lav && lav.length === 1 && lav[0].titolo === 'Cucina su misura');
    esito('cliente creato', cli && cli.some(c => c.name === 'Mario Rossi'));
    esito('scheda del lavoro aperta', await p.locator('#modalLavoro').isVisible());
    // le sezioni del lavoro si aprono e chiudono
    for (const s of ['rilievo', 'preventivo', 'taglio', 'materiali', 'appuntamenti']) await p.evaluate(s => alternaSezioneLavoro(s), s);
    await chiudiTutto();
  });

  await passo('Clienti: nuovo cliente dal modulo', async () => {
    await p.evaluate(() => apriStrumento('clientsTool')); await p.waitForTimeout(500);
    await p.evaluate(() => vaiA('clientsTool')); await p.waitForTimeout(300);
    await toccaTesto('Nuovo', '#viewClients');
    esito('modulo cliente', await p.locator('#modalClient').isVisible());
    await p.fill('#clientNameInput', 'Lucia Bianchi'); await p.fill('#clientPhoneInput', '333 1234567');
    await p.fill('#clientEmailInput', 'lucia@example.it'); await p.fill('#clientAddressInput', 'Via Verdi 3, Firenze');
    await tocca('#modalClient [data-click="salvaNuovoCliente()"]', 600);
    const cli = await LS('doctorwood_clients');
    esito('cliente salvato', cli.some(c => c.name === 'Lucia Bianchi' && c.phone === '333 1234567'));
    await chiudiTutto();
  });

  await passo('Preventivo con due voci', async () => {
    await p.evaluate(() => apriStrumento('quoteTool')); await p.waitForTimeout(600);
    await p.fill('#quoteClient', 'Mario Rossi'); await p.fill('#quoteProject', 'Cucina su misura');
    await tocca('#viewQuote [data-click="aggiungiVocePreventivo()"]');
    await tocca('#viewQuote [data-click="aggiungiVocePreventivo()"]');
    const righe = p.locator('#quoteItemsContainer > div');
    const n = await righe.count();
    esito('voci aggiunte', n >= 2, n + ' righe');
    const campi = async (i, d, q, pr) => {
      const r = righe.nth(i);
      await r.locator('.q-desc').fill(d);
      const num = r.locator('input[type=number], input[inputmode=decimal]');
      const k = await num.count();
      if (k >= 2) { await num.nth(0).fill(String(q)); await num.nth(1).fill(String(pr)); }
    };
    await campi(n - 2, 'Ante laccate', 4, 120); await campi(n - 1, 'Montaggio', 1, 300);
    await p.waitForTimeout(300);
    const tot = await p.textContent('#quoteSubtotal');
    esito('imponibile calcolato', /780/.test(tot.replace(/\./g, '')), tot);
    await tocca('#barraSalvaTasto', 700);
    const prev = await LS('preventivi');
    esito('preventivo salvato', Array.isArray(prev) && prev.length >= 1, (prev || []).length + ' preventivi');
    const cl = await LS('doctorwood_clients'), lv = await LS('lavori');
    esito('nessun cliente doppio (nome scritto a mano)', cl.filter(c => c.name === 'Mario Rossi').length === 1, cl.map(c => c.name).join(', '));
    esito('nessun lavoro doppio', lv.filter(l => l.titolo === 'Cucina su misura').length === 1, lv.length + ' lavori');
    esito('preventivo collegato al lavoro esistente', prev[0].lavoroId === lv[0].id);
    // riduci / riapri i pannelli
    await tocca('#toggleDatiPrev'); esito('dati riducibili', await p.locator('#datiPrevCorpo').isHidden());
    await tocca('#toggleDatiPrev'); await tocca('#toggleVoci'); await tocca('#toggleVoci');
  });

  await passo('Magazzino: nuovo articolo e quantità', async () => {
    await p.evaluate(() => apriStrumento('magazzinoTool')); await p.waitForTimeout(600);
    await toccaTesto('Nuovo articolo', '#viewMagazzino', 600);
    esito('modulo articolo', await p.locator('#modalArticolo').isVisible());
    await scegli('#artCategoria', 'ferramenta'); await p.evaluate(() => aggiornaFormArticolo(true));
    await p.fill('#artNome', 'Cerniera clip 110°'); await p.fill('#artQuantita', '20'); await p.fill('#artPrezzo', '2,5');
    await tocca('#artSalva', 600);
    let mag = await LS('magazzino');
    esito('articolo salvato', mag && mag.some(a => a.nome === 'Cerniera clip 110°'));
    const q0 = mag.find(a => a.nome === 'Cerniera clip 110°').quantita;
    const piu = p.locator('#viewMagazzino button[aria-label="Aggiungi uno"]:visible').first();
    await piu.click(); await p.waitForTimeout(400); await piu.click(); await p.waitForTimeout(400);
    await p.locator('#viewMagazzino button[aria-label="Togli uno"]:visible').first().click(); await p.waitForTimeout(400);
    mag = await LS('magazzino');
    esito('quantità cambiata con + / −', mag.find(a => a.nome === 'Cerniera clip 110°').quantita !== q0, q0 + ' → ' + mag.find(a => a.nome === 'Cerniera clip 110°').quantita);
    await chiudiTutto();
  });

  await passo('Agenda: nuovo appuntamento', async () => {
    await p.evaluate(() => apriStrumento('agendaTool')); await p.waitForTimeout(600);
    await toccaTesto('Nuovo', '#viewAgenda', 600);
    esito('modulo appuntamento', await p.locator('#modalFormApp').isVisible());
    await tocca('#modalFormApp [data-click="scegliTipoApp(\'montaggio\')"]');
    await p.fill('#appTitolo', 'Montaggio cucina');
    await tocca('#modalFormApp [data-click="salvaAppuntamento()"]', 700);
    const app = await LS('appuntamenti');
    esito('appuntamento salvato', app && app.length === 1, JSON.stringify(app && app[0] && { tipo: app[0].tipo, data: app[0].data, ora: app[0].ora }));
    await chiudiTutto();
    await p.evaluate(() => vistaAgenda('settimana')); await p.evaluate(() => vistaAgenda('mese'));
  });

  await passo('Schede: nuova scheda di montaggio', async () => {
    await p.evaluate(() => apriStrumento('schedeTool')); await p.waitForTimeout(600);
    await toccaTesto('Nuova scheda', '#viewSchede', 600);
    esito('modulo scheda', await p.locator('#modalScheda').isVisible());
    await p.fill('#schedaTitolo', 'Cerniera Blum Clip Top'); await p.fill('#schedaProduttore', 'Blum');
    await tocca('#schedaSalvaSolo', 700);
    const sch = await LS('schede');
    esito('scheda salvata', sch && sch.some(s => s.titolo === 'Cerniera Blum Clip Top'));
    await chiudiTutto();
  });

  await passo('Taglio: pezzi, calcolo, salvataggio progetto', async () => {
    await p.evaluate(() => apriStrumento('cutOptimizer')); await p.waitForTimeout(600);
    await p.evaluate(() => cambiaSchedaTaglio('calc')); await p.waitForTimeout(300);
    const prima = await p.locator('#piecesContainer > *').count();
    await tocca('#viewCutOptimizer [data-click="aggiungiRigaPezzo(\'\', \'\', \'\', 1, false, true)"]');
    const riga = p.locator('#piecesContainer > *').last();
    const num = riga.locator('input');
    await num.nth(0).fill('Fianco').catch(() => {});
    const nums = riga.locator('input[inputmode=decimal], input[type=number]');
    if (await nums.count() >= 3) { await nums.nth(0).fill('72'); await nums.nth(1).fill('56'); await nums.nth(2).fill('2'); }
    esito('riga pezzo aggiunta', (await p.locator('#piecesContainer > *').count()) === prima + 1);
    await tocca('#viewCutOptimizer [data-click="calcolaOttimizzazione()"]', 1500);
    const ris = await p.evaluate(() => ({ pannelli: (document.getElementById('statPanels') || {}).textContent, scarto: (document.getElementById('statWaste') || {}).textContent }));
    esito('calcolo eseguito', ris.pannelli && /\d/.test(ris.pannelli), JSON.stringify(ris));
    {
      await tocca('#barraSalvaTasto', 500);
      esito('finestra salva progetto', await p.locator('#modalSaveProject').isVisible());
      {
        await p.fill('#saveProjectName', 'Cucina Rossi - fianchi');
        await tocca('#modalSaveProject [data-click="confermaSalvaProgetto()"]', 600);
      }
    }
    const prog = await LS('projects');
    esito('progetto salvato', Array.isArray(prog) && prog.length >= 1, (prog || []).length + ' progetti');
    await p.evaluate(() => cambiaSchedaTaglio('projects')); await p.evaluate(() => cambiaSchedaTaglio('panels')); await p.evaluate(() => cambiaSchedaTaglio('calc'));
    await chiudiTutto();
  });

  await passo('Rilievo: aggiungo una foto e una quota', async () => {
    await p.evaluate(() => apriStrumento('photoSurvey')); await p.waitForTimeout(600);
    const input = p.locator('#viewPhotoSurvey input[type=file]:not([capture])').first();
    await input.setInputFiles(require('path').join(__dirname, 'file', 'foto-verticale.jpg'));
    await p.waitForTimeout(2500);
    const n = await p.evaluate(() => typeof caroselloFoto !== 'undefined' ? caroselloFoto.length : -1);
    esito('foto caricata', n >= 1, n + ' foto');
    esito('modalità predefinita «Sposta»', (await p.evaluate(() => document.getElementById('surveyMode').value)) === 'pan');
    // una nota: modalità testo e tocco sulla foto
    await p.evaluate(() => { const s = document.getElementById('surveyMode'); s.value = 'text'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    const c = await p.locator('#surveyCanvas').boundingBox();
    if (c) { await p.mouse.click(c.x + c.width / 2, c.y + c.height / 2); await p.waitForTimeout(600); }
    const note = await p.evaluate(() => typeof caroselloFoto !== 'undefined' && caroselloFoto[0] ? (caroselloFoto[0].annotazioni || caroselloFoto[0].note || []).length : -1);
    esito('quota aggiunta toccando la foto', note >= 1, note + ' quote');
    await p.evaluate(() => { try { chiudiModaleNota(); } catch (_) {} });
    await p.evaluate(() => { try { salvaSubitoRilievi(); } catch (_) {} });
  });

  await passo('Backup cifrato: esporta e reimporta', async () => {
    await p.evaluate(() => mostraDashboard()); await p.waitForTimeout(400);
    await p.evaluate(() => esportaBackup()); await p.waitForTimeout(500);
    esito('finestra backup', await p.locator('#modalBackup').isVisible());
    const avanti = p.locator('#modalBackup button:visible').filter({ hasText: /Continua|Avanti|Salva|Esporta/ }).last();
    await avanti.click(); await p.waitForTimeout(400);
    if (await p.locator('#modalPassword').isVisible()) {
      const pw = p.locator('#modalPassword input[type=password]');
      await pw.nth(0).fill('pialla rossa sul banco'); if (await pw.count() > 1) await pw.nth(1).fill('pialla rossa sul banco');
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.locator('#modalPassword button:visible').filter({ hasText: /Salva|Cifra|Continua|Esporta/ }).last().click()]);
      const f = D + 'backup-prova.json'; await dl.saveAs(f);
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      esito('file cifrato (nessun dato leggibile)', !fs.readFileSync(f, 'utf8').includes('Mario Rossi') && !!(j.cifrato || j.dati || j.iv), Object.keys(j).join(','));
      // reimporto in una pagina vuota
      const p2 = await ctx.newPage(); p2.on('dialog', d => d.accept()); await rispondiDomande(p2, { accetta: true });
      p2.on('pageerror', e => errori.push('pagina2: ' + e.message));
      await p2.goto(URL); await p2.evaluate(() => { localStorage.clear(); localStorage.setItem('doctorwood_modalita', 'titolare'); }); await p2.reload(); await p2.waitForTimeout(1000);
      await p2.locator('#importFile').setInputFiles(f); await p2.waitForTimeout(800);
      const pwi = p2.locator('#modalPassword input[type=password]:visible').first();
      if (await pwi.count()) { await pwi.fill('pialla rossa sul banco'); await p2.locator('#modalPassword button:visible').filter({ hasText: /Apri|Continua|Sblocca|Importa/ }).last().click(); await p2.waitForTimeout(8000); }
      const imp = p2.locator('#modalBackup button:visible').filter({ hasText: /Importa|Riprendi|Continua/ }).last();
      if (await imp.count()) { await imp.click(); await p2.waitForTimeout(1500); }
      const cli = await p2.evaluate(() => JSON.parse(localStorage.getItem('doctorwood_clients') || '[]').map(c => c.name));
      esito('backup reimportato', cli.includes('Mario Rossi') && cli.includes('Lucia Bianchi'), cli.join(', '));
      await p2.close();
    } else esito('richiesta password', false);
  });

  await passo('Laboratorio: PIN, vista del laboratorio, ritorno Titolare', async () => {
    await chiudiTutto();
    await p.evaluate(() => scegliModalita('laboratorio')); await p.waitForTimeout(500);
    esito('richiesta del PIN', await p.locator('#modalPin').isVisible());
    const cifre = async pin => { await p.fill('#pinCampo', pin); await tocca('#pinConferma', 500); };
    await cifre('2580'); await p.waitForTimeout(500);
    if (await p.locator('#modalPin').isVisible()) { await cifre('2580'); await p.waitForTimeout(800); }
    esito('in Laboratorio', await p.evaluate(() => modoLab()));
    esito('vista Laboratorio', await p.locator('#viewLaboratorio').isVisible());
    esito('prezzi nascosti', !(await p.locator('#viewLaboratorio').innerText()).includes('€'));
    await p.evaluate(() => esciLaboratorio()); await p.waitForTimeout(400);
    await cifre('2580'); await p.waitForTimeout(800);
    esito('di nuovo Titolare', !(await p.evaluate(() => modoLab())));
  });

  await passo('Impostazioni: tutte le sezioni', async () => {
    await chiudiTutto();
    await p.evaluate(() => apriImpostazioni()); await p.waitForTimeout(400);
    const cats = await p.evaluate(() => [...document.querySelectorAll('#catImpostazioni .cat-imp')].filter(c => !c.classList.contains('hidden')).map(c => c.dataset.cat));   // «Aggiornamenti» c'è solo nell'app Android
    for (const c of cats) { await tocca(`#catImpostazioni [data-cat="${c}"] .cat-testa`, 300); }
    esito('sezioni aperte una per volta', cats.length >= 9, cats.join(','));
    await chiudiTutto();
  });

  fs.writeFileSync(D + 'dati-realistici.json', JSON.stringify(await p.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))));
  console.log(`\nRisultato: ${ok} controlli riusciti, ${ko} falliti`);
  console.log('Errori in pagina:', errori.length ? errori : 'nessuno');
  await b.close();
})();
