// File in entrata (foto, PDF, logo, backup finti o rotti) e salvataggi su Android.
const { rispondiDomande, impostaDomande, leggiDomande } = require('./domande');
const { chromium, devices } = require('playwright');
const fs = require('fs');
const S = require('path').join(__dirname, 'file') + '/';
const DATI = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'risultati', 'dati-realistici.json'), 'utf8'));
const MOCK = `(() => { window.__nativo = []; window.Capacitor = { isNativePlatform: () => true, nativePromise: (pl, m, o) => {
  __nativo.push([pl + '.' + m, o && o.nome]);
  if (m === 'puoSbloccare') return Promise.resolve({ ok: false });
  if (m === 'stato') return Promise.resolve({ biometria: 'pronta', chiave: true });
  if (m === 'salvaFile') return Promise.resolve({ salvato: true });
  return Promise.resolve({}); } }; })();`;
(async () => {
  const b = await chromium.launch();
  let ok = 0, ko = 0;
  const esito = (n, c, i = '') => { c ? ok++ : ko++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (i ? ' — ' + i : '')); };
  for (const android of [false, true]) {
    console.log(android ? '\n== App Android (ponte simulato)' : '== Pagina web');
    const ctx = await b.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
    if (android) await ctx.addInitScript(MOCK);
    const p = await ctx.newPage();
    const errori = []; p.on('pageerror', e => errori.push(e.message)); p.on('console', m => { if (m.type() === 'error') errori.push(m.text().slice(0, 150)); });
    const avvisi = []; p.on('dialog', d => { avvisi.push(d.message().slice(0, 80)); d.accept(); });
    await rispondiDomande(p, { accetta: true });
    const scaricati = []; p.on('download', d => scaricati.push(d.suggestedFilename()));
    await p.goto(android ? 'http://localhost:8765/index.html' : 'http://localhost:8766/sorgente-DoctorWood.html');
    await p.evaluate(D => { localStorage.clear(); for (const [k, v] of Object.entries(D)) localStorage.setItem(k, v); localStorage.setItem('doctorwood_cassaforte_chiavi', JSON.stringify({ v: 1, emergenza: {}, impronta: {} })); }, DATI);
    await p.reload(); await p.waitForTimeout(1000);

    // Schede: pagine da immagine e da PDF
    await p.evaluate(() => { apriStrumento('schedeTool'); apriDettaglioScheda(leggiSchede()[0].id); }); await p.waitForTimeout(500);
    const pag0 = await p.evaluate(() => (leggiSchede()[0].pagine || leggiSchede()[0].nPagine || 0));
    await p.locator('#schedeFileInput').setInputFiles([S + 'foto-verticale.jpg']); await p.waitForTimeout(2500);
    if (await p.locator('#modalRaddrizza').isVisible()) {
      esito('immagine → finestra «Raddrizza»', true);
      await p.locator('#modalRaddrizza [data-click="radApplica()"]').click(); await p.waitForTimeout(2500);
      await p.locator('#modalRaddrizza [data-click="radRuota(1)"]').click(); await p.waitForTimeout(800);
      await p.locator('#modalRaddrizza [data-click="radModo(\'scansione\')"]').click(); await p.waitForTimeout(1200);
      await p.locator('#modalRaddrizza [data-click="radSalva()"]').click(); await p.waitForTimeout(2500);
      esito('pagina raddrizzata, ruotata e salvata', await p.locator('#modalRaddrizza').isHidden());
    }
    await p.locator('#schedeFileInput').setInputFiles([S + 'scheda-prova.pdf']); await p.waitForTimeout(2000);
    const det = await p.evaluate(() => document.getElementById('schedaDettaglio') ? document.getElementById('schedaDettaglio').innerText : '');
    esito('pagine della scheda aggiunte (foto + PDF)', /PDF|pagin/i.test(det), det.replace(/\s+/g, ' ').slice(0, 90));
    // file rotto
    avvisi.length = 0; await p.evaluate(() => { if (window.__domande) window.__domande.messaggi.length = 0; });
    await p.locator('#schedeFileInput').setInputFiles([S + 'rotta.jpg']); await p.waitForTimeout(2000);
    const vis = await p.evaluate(() => (document.getElementById('avvisoGuardiaTesto') || {}).textContent || '');
    avvisi.push(...(await leggiDomande(p)).messaggi);
    esito('immagine rotta: messaggio chiaro, niente blocchi', avvisi.length > 0 || /non|errore|leggib/i.test(vis), (avvisi[0] || vis).slice(0, 80));
    await p.evaluate(() => { for (let i = 0; i < 6 && chiudiFinestraAperta(); i++); });

    // Logo della ditta
    await p.evaluate(() => apriModaleDitta()); await p.waitForTimeout(400);
    await p.locator('#dittaLogoFile').setInputFiles(S + 'foto-verticale.jpg'); await p.waitForTimeout(1500);
    const logo = await p.evaluate(() => { const i = document.querySelector('#modalDitta img'); return i && i.src ? i.src.slice(0, 22) : ''; });
    esito('logo caricato e mostrato', logo.startsWith('data:image'), logo);
    await p.evaluate(() => { for (let i = 0; i < 6 && chiudiFinestraAperta(); i++); });

    // Backup finto / non cifrato
    avvisi.length = 0; await p.evaluate(() => { if (window.__domande) window.__domande.messaggi.length = 0; });
    await p.locator('#importFile').setInputFiles(S + 'finto.json'); await p.waitForTimeout(1200);
    const msg = await p.evaluate(() => (document.getElementById('avvisoGuardiaTesto') || {}).textContent || '');
    avvisi.push(...(await leggiDomande(p)).messaggi);
    esito('backup finto rifiutato con un messaggio', avvisi.length > 0 || msg.length > 0, (avvisi[0] || msg).slice(0, 90));
    const cli = await p.evaluate(() => JSON.parse(localStorage.getItem('doctorwood_clients') || '[]').length);
    esito('dati intatti dopo il file finto', cli === JSON.parse(DATI.doctorwood_clients).length, cli + ' clienti');
    await p.evaluate(() => { for (let i = 0; i < 6 && chiudiFinestraAperta(); i++); });

    // Rilievo: foto, poi «Scarica immagine» e PDF
    await p.evaluate(() => apriStrumento('photoSurvey')); await p.waitForTimeout(400);
    await p.locator('#viewPhotoSurvey input[type=file]:not([capture])').first().setInputFiles(S + 'foto-verticale.jpg'); await p.waitForTimeout(2500);
    await p.evaluate(() => scaricaImmagineRilievo()); await p.waitForTimeout(1500);
    await p.evaluate(() => esportaRilieviInPDF()); await p.waitForTimeout(2500);
    if (android) {
      const n = await p.evaluate(() => __nativo.filter(x => x[0] === 'Cassaforte.salvaFile').map(x => x[1]));
      esito('Android: «Scarica immagine» apre «Salva come»', n.some(x => /\.jpg$/.test(x)), n.join(', '));
      // i PDF si aprono con l'app del telefono (da lì si salvano o si condividono); «Salva come» solo se manca un lettore
      const pdf = await p.evaluate(() => __nativo.filter(x => x[0] === 'Cassaforte.apriFile' || x[0] === 'Cassaforte.salvaFile').map(x => x[1]));
      esito('Android: PDF del rilievo si apre con l\'app del telefono', pdf.some(x => /\.pdf$/.test(x)), pdf.join(', '));
    } else {
      esito('web: immagine e PDF scaricati', scaricati.some(x => /\.jpg$/.test(x)) && scaricati.some(x => /\.pdf$/.test(x)), scaricati.join(', '));
    }
    esito('nessun errore in pagina', !errori.length, errori.join(' | ').slice(0, 200));
    await ctx.close();
  }
  console.log(`\nRisultato: ${ok} riusciti, ${ko} falliti`);
  await b.close();
})();
