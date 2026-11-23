// Dimensione del testo (Impostazioni → Aspetto) e scritte grandi del Laboratorio, dall'interfaccia.
// Uso: node prove/testo.js   (servono i due server delle prove e risultati/dati-realistici.json)
const { chromium, devices } = require('playwright');
const fs = require('fs');
const DATI = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'risultati', 'dati-realistici.json'), 'utf8'));
const MOCK = `(() => { window.__nativo = []; window.Capacitor = { isNativePlatform: () => true, addListener: () => ({ remove() {} }), nativePromise: (pl, m, o) => {
  __nativo.push([pl + '.' + m, o]);
  if (m === 'stato') return Promise.resolve({ biometria: 'pronta', chiave: false });
  return Promise.resolve({}); } }; })();`;

(async () => {
  const b = await chromium.launch();
  let ok = 0, ko = 0;
  const esito = (n, c, info = '') => { if (c) ok++; else ko++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (info ? ' — ' + info : '')); };
  const errori = [];
  async function apri(url, opz, dati, android) {
    const ctx = await b.newContext({ locale: 'it-IT', ...opz });
    if (android) await ctx.addInitScript(MOCK);
    await ctx.addInitScript(a => { if (!sessionStorage.getItem('__f')) { localStorage.clear(); for (const k in a) localStorage.setItem(k, a[k]); sessionStorage.setItem('__f', '1'); } }, dati);
    const p = await ctx.newPage();
    p.on('pageerror', e => errori.push(e.message));
    await p.goto(url); await p.waitForTimeout(1200);
    return p;
  }
  const scegli = async (p, v) => {
    await p.evaluate(() => apriImpostazioni()); await p.waitForTimeout(300);
    if (await p.locator('#catCorpo_aspetto.hidden').count()) { await p.locator(`[data-click="apriCatImp('aspetto')"]`).click(); await p.waitForTimeout(300); }
    await p.locator(`#sceltaTesto [data-testo="${v}"]`).scrollIntoViewIfNeeded();
    await p.locator(`#sceltaTesto [data-testo="${v}"]`).click(); await p.waitForTimeout(300);
  };

  console.log('▶ Pagina sul PC');
  let p = await apri('http://localhost:8766/sorgente-DoctorWood.html', { viewport: { width: 1366, height: 860 } }, { ...DATI, doctorwood_modalita: 'titolare' });
  await scegli(p, 130);
  esito('«Molto grande» selezionato', (await p.locator('#sceltaTesto [data-testo="130"]').getAttribute('aria-checked')) === 'true');
  esito('pagina ingrandita del 30%', (await p.evaluate(() => document.documentElement.style.zoom)) === '1.3');
  esito('riassunto della categoria', /testo molto grande/.test(await p.locator('#catRiass_aspetto').textContent()));
  await p.reload(); await p.waitForTimeout(1200);
  esito('resta dopo la riapertura (subito, prima di disegnare)', (await p.evaluate(() => [document.documentElement.style.zoom, document.documentElement.dataset.testo].join())) === '1.3,130');
  await scegli(p, 100);
  esito('«Normale» toglie lo zoom', (await p.evaluate(() => document.documentElement.style.zoom)) === '');
  await p.context().close();

  console.log('▶ Pagina su un telefono (lì c\'è l\'app: niente zoom della pagina)');
  p = await apri('http://localhost:8766/sorgente-DoctorWood.html', devices['Pixel 7'], { ...DATI, doctorwood_modalita: 'titolare', doctorwood_testo: '130' });
  esito('nessuno zoom della pagina sul telefono', (await p.evaluate(() => document.documentElement.style.zoom)) === '');
  await p.context().close();

  console.log('▶ App Android');
  p = await apri('http://localhost:8765/index.html', devices['Pixel 7'], { ...DATI, doctorwood_modalita: 'titolare', doctorwood_blocco_titolare: 'no', doctorwood_testo: '115' }, true);
  esito('all\'avvio chiede ad Android lo zoom del testo salvato', (await p.evaluate(() => __nativo.filter(x => x[0] === 'Laboratorio.dimensioneTesto').map(x => x[1].percento))).includes(115));
  esito('nell\'app nessuno zoom della pagina', (await p.evaluate(() => document.documentElement.style.zoom)) === '');
  await scegli(p, 130);
  esito('scelta → zoom del testo 130% ad Android', (await p.evaluate(() => __nativo.filter(x => x[0] === 'Laboratorio.dimensioneTesto').map(x => x[1].percento).pop())) === 130);
  esito('etichette della barra compensate (restano 11 px dopo lo zoom)', Math.abs((await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.navBtn > span:last-child')).fontSize))) * 1.3 - 11) < 0.2);
  await p.context().close();

  console.log('▶ App Android sul tablet (schermo largo)');
  p = await apri('http://localhost:8765/index.html', devices['Galaxy Tab S4'], { ...DATI, doctorwood_modalita: 'titolare', doctorwood_blocco_titolare: 'no', doctorwood_testo: '130' }, true);
  esito('nessuno zoom della pagina nemmeno sul tablet', (await p.evaluate(() => document.documentElement.style.zoom)) === '');
  await p.context().close();

  console.log('▶ Laboratorio: scritte grandi');
  const lab = { app: 'DoctorWood', formato: 'laboratorio', creato: Date.now(), segreto: '', lavori: [{ id: 'l1', titolo: 'Cucina su misura', cliente: 'Mario Rossi', indirizzo: '', stato: 'produzione', montaggio: null,
    tagli: [{ id: 't1', nome: 'Basi', tipo: '', l: 2800, w: 2070, pezzi: [{ nome: 'Fianco base', l: 720, w: 560, qta: 4, mat: '', bL: 0, bW: 0 }] }], materiali: [] }] };
  p = await apri('http://localhost:8765/index.html', devices['Galaxy Tab S4'], { ...DATI, doctorwood_modalita: 'laboratorio', laboratorio_dati: JSON.stringify(lab) }, true);
  await p.locator('#viewLaboratorio [data-click^="apriLavoroLab"]').first().click(); await p.waitForTimeout(400);
  const misure = await p.evaluate(() => {
    const fs = sel => { const e = document.querySelector(sel); return e ? parseFloat(getComputedStyle(e).fontSize) : 0; };
    return { titolo: fs('#viewLaboratorio .lab-lavoro .text-base'), pezzo: fs('#viewLaboratorio .lab-spunta .text-sm'), misura: fs('#viewLaboratorio .lab-spunta .text-\\[11px\\]'), casella: document.querySelector('#viewLaboratorio .lab-casella').getBoundingClientRect().width };
  });
  esito('titolo del lavoro 20 px', misure.titolo === 20, JSON.stringify(misure));
  esito('nome del pezzo 17 px', misure.pezzo === 17);
  esito('misure 14 px', misure.misura === 14);
  esito('casella da spuntare 34 px', Math.round(misure.casella) === 34);
  await p.context().close();

  esito('nessun errore in pagina', errori.length === 0, errori.slice(0, 2).join(' | '));
  await b.close();
  console.log(`\nTesto: ${ok} riusciti, ${ko} falliti`);
  process.exit(ko ? 1 : 0);
})();
