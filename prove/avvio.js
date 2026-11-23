// L'apertura dell'app Android: il logo compare dal centro in dissolvenza, non si può saltare, poi (da Titolare con il
// blocco) si chiede l'impronta; solo dopo si vede l'app. In Laboratorio: il logo, poi direttamente l'app.
//   node prove/avvio.js      (serve il server della pagina dell'app: python3 -m http.server 8765 -d www)
const { chromium, devices } = require('playwright');
const MOCK = () => {
  window.__avvioIntero = true;
  window.__chiamate = [];
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', addListener: () => ({ remove() {} }),
    nativePromise: (pl, m) => { window.__chiamate.push(pl + '.' + m);
      if (m === 'puoSbloccare') return Promise.resolve({ ok: true });
      if (m === 'stato') return Promise.resolve({ biometria: 'pronta', chiave: false, sequenza: true });
      if (m === 'frequenze') return Promise.resolve({ massima: 60 });
      return Promise.resolve({}); } };
};
(async () => {
  const b = await chromium.launch();
  let ok = 0, ko = 0;
  const esito = (n, c, info = '') => { if (c) ok++; else ko++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (info ? ' — ' + info : '')); };
  const apri = async dati => {
    const ctx = await b.newContext({ locale: 'it-IT', ...devices['Pixel 7'] });
    await ctx.addInitScript(MOCK);
    await ctx.addInitScript(d => { if (!sessionStorage.getItem('__fatto')) { for (const k in d) localStorage.setItem(k, d[k]); sessionStorage.setItem('__fatto', '1'); } }, dati);
    const p = await ctx.newPage(); const errori = []; p.on('pageerror', e => errori.push(e.message));
    await p.goto('http://localhost:8765/index.html');
    return { p, errori, ctx };
  };
  const stato = p => p.evaluate(() => { const l = document.getElementById('bloccoTitolare'); return {
    logo: !!l && getComputedStyle(l).display === 'flex' && getComputedStyle(l).visibility === 'visible',
    opacita: l ? Number(getComputedStyle(l.querySelector('.avvio-logo')).opacity) : -1,
    tasto: l ? getComputedStyle(document.getElementById('bloccoSblocca')).visibility : '',
    sotto: getComputedStyle(document.querySelector('main')).visibility,
    impronta: window.__chiamate.filter(x => x === 'Cassaforte.verificaIdentita').length }; });

  console.log('▶ Titolare con il blocco: logo, poi impronta');
  let { p, errori, ctx } = await apri({ doctorwood_modalita: 'titolare' });
  await p.waitForTimeout(250);
  let s = await stato(p);
  esito('subito: solo il logo che sta comparendo, l\'app è nascosta', s.logo && s.opacita > 0 && s.opacita < 1 && s.sotto === 'hidden', JSON.stringify(s));
  esito('durante l\'apertura niente da toccare e niente impronta', s.tasto === 'hidden' && s.impronta === 0);
  await p.mouse.click(200, 400); await p.keyboard.press('Escape'); await p.evaluate(() => { try { chiudiFinestraAperta(); window.dispatchEvent(new PopStateEvent('popstate')); } catch (_) {} }); await p.waitForTimeout(600);
  s = await stato(p);
  esito('non si salta: toccando o premendo Indietro il logo resta', s.logo && s.sotto === 'hidden' && s.impronta === 0, JSON.stringify(s));
  await p.waitForTimeout(1100);
  s = await stato(p);
  esito('finita l\'apertura (circa 1,5 secondi) chiede l\'impronta', s.impronta === 1, JSON.stringify(s));
  await p.waitForTimeout(1000);
  s = await stato(p);
  esito('dopo l\'impronta si vede l\'app', !s.logo && s.sotto === 'visible', JSON.stringify(s));
  esito('nessun errore in pagina', errori.length === 0, errori.join(' | ').slice(0, 200));
  await ctx.close();

  console.log('▶ Laboratorio: logo, poi l\'app senza impronta');
  ({ p, errori, ctx } = await apri({ doctorwood_modalita: 'laboratorio' }));
  await p.waitForTimeout(600);
  s = await stato(p);
  esito('il logo si vede anche in Laboratorio', s.logo && s.sotto === 'hidden', JSON.stringify(s));
  await p.waitForTimeout(1800);
  s = await stato(p);
  esito('poi l\'app, senza impronta', !s.logo && s.sotto === 'visible' && s.impronta === 0, JSON.stringify(s));
  esito('nessun errore in pagina', errori.length === 0, errori.join(' | ').slice(0, 200));
  await ctx.close();

  console.log('▶ Primo avvio: logo, poi il benvenuto');
  ({ p, errori, ctx } = await apri({}));
  await p.waitForTimeout(500);
  s = await stato(p);
  esito('al primo avvio prima il logo', s.logo, JSON.stringify(s));
  await p.waitForTimeout(1800);
  esito('poi la scelta Titolare / Laboratorio', !(await stato(p)).logo && await p.locator('#modalModalita').isVisible());
  esito('nessun errore in pagina', errori.length === 0, errori.join(' | ').slice(0, 200));
  await ctx.close();

  console.log(`\nAvvio: ${ok} riusciti, ${ko} falliti`);
  await b.close(); process.exit(ko ? 1 : 0);
})();
