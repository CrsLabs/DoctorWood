// Aggiornamenti da GitHub: voce nelle Impostazioni (solo app), controllo a mano, domanda settimanale, tablet del laboratorio.
// Uso: node prove/aggiornamenti.js   (server 8766 sulla cartella DoctorWood e 8765 sulla cartella www)
const { chromium, devices } = require('playwright');
let ok = 0, ko = 0;
const t = (n, c, info = '') => { (c ? ok++ : ko++); console.log((c ? '  ✓ ' : '  ✗ ') + n + (info && !c ? ' — ' + info : '')); };
const MOCK = nuova => {
  window.__chiamate = [];
  window.Capacitor = { isNativePlatform: () => true, addListener: () => ({ remove() {}, then: f => f && f({ remove() {} }) }),
    nativePromise: (pl, m, o) => { window.__chiamate.push(pl + '.' + m);
      if (m === 'controllaAggiornamento') return Promise.resolve(nuova ? { installata: 47, nuova: true, versione: '1.1.1', novita: 'Correzioni.', dimensione: 9437184 } : { installata: 47, nuova: false });
      if (m === 'scaricaAggiornamento') return Promise.resolve({ permesso: true, avviata: true });
      return Promise.resolve(m === 'puoSbloccare' || m === 'statoBiometria' ? { ok: false } : {}); } };
};
async function apri(b, url, app, extra, nuova) {
  const ctx = await b.newContext({ ...devices['Pixel 7'], locale: 'it-IT' });
  if (app) await ctx.addInitScript(MOCK, nuova);
  await ctx.addInitScript(e => { if (sessionStorage.getItem('__f')) return; sessionStorage.setItem('__f', '1'); localStorage.clear();
    const base = { doctorwood_animazioni: 'no', doctorwood_docs_chiesto: 'si', doctorwood_blocco_titolare: 'no', ultimoBackup: String(Date.now()), doctorwood_cassaforte_rimandata: 'si' };
    for (const k in Object.assign(base, e)) localStorage.setItem(k, base[k]); }, extra);
  const p = await ctx.newPage(); const err = []; p.on('pageerror', e => err.push(e.message));
  await p.goto(url); await p.waitForTimeout(1500); return { p, ctx, err };
}
const domandaAperta = p => p.evaluate(() => { const f = document.getElementById('modalDomanda'); return f && !f.classList.contains('hidden') ? f.innerText : ''; });
(async () => {
  const b = await chromium.launch();
  const recente = JSON.stringify({ ultimo: Date.now() });
  console.log('▶ Pagina web');
  { const { p, ctx, err } = await apri(b, 'http://127.0.0.1:8766/sorgente-DoctorWood.html', false, { doctorwood_modalita: 'titolare' });
    await p.evaluate(() => apriImpostazioni()); await p.waitForTimeout(500);
    t('sulla pagina web la voce Aggiornamenti non c\'è', await p.evaluate(() => document.getElementById('catAggiornamenti').classList.contains('hidden')));
    t('nessun errore', !err.length, err.join(' | ')); await ctx.close(); }

  console.log('▶ App, Titolare: controllo a mano');
  { const { p, ctx, err } = await apri(b, 'http://127.0.0.1:8765/index.html', true, { doctorwood_modalita: 'titolare', doctorwood_aggiornamenti: recente }, true);
    await p.evaluate(() => { apriImpostazioni(); apriCatImp('aggiornamenti'); }); await p.waitForTimeout(600);
    t('nelle Impostazioni c\'è «Aggiornamenti»', await p.evaluate(() => !document.getElementById('catAggiornamenti').classList.contains('hidden') && !!document.getElementById('aggControlla').offsetParent));
    t('il controllo settimanale è acceso di serie', await p.evaluate(() => document.getElementById('impAggiornamenti').getAttribute('aria-checked') === 'true'));
    await p.click('#aggControlla'); await p.waitForTimeout(500);
    const st = await p.evaluate(() => document.getElementById('aggStato').innerText);
    t('«Controlla adesso» trova la versione nuova e la descrive', /DoctorWood 1\.1\.1/.test(st) && /9,0 MB/.test(st) && /Correzioni/.test(st), st);
    t('compare il tasto «Aggiorna»', await p.evaluate(() => !!document.getElementById('aggInstalla').offsetParent));
    await p.click('#aggInstalla'); await p.waitForTimeout(500);
    t('«Aggiorna» scarica e apre l\'installazione', await p.evaluate(() => window.__chiamate.includes('Cassaforte.scaricaAggiornamento')));
    await p.click('#impAggiornamenti'); await p.waitForTimeout(200);
    t('l\'interruttore spegne il controllo settimanale', await p.evaluate(() => JSON.parse(localStorage.getItem('doctorwood_aggiornamenti')).attivo === false && document.getElementById('impAggiornamenti').getAttribute('aria-checked') === 'false'));
    t('nessun errore', !err.length, err.join(' | ')); await ctx.close(); }

  console.log('▶ App, Titolare: domanda della settimana');
  { const { p, ctx, err } = await apri(b, 'http://127.0.0.1:8765/index.html', true, { doctorwood_modalita: 'titolare' }, true);
    await p.waitForTimeout(8500);
    const d = await domandaAperta(p);
    t('dopo una settimana chiede «È uscita DoctorWood 1.1.1»', /È uscita DoctorWood 1\.1\.1/.test(d) && /Aggiorna/.test(d) && /Più tardi/.test(d), d.slice(0, 160));
    await p.click('#domNo'); await p.waitForTimeout(400);
    t('«Più tardi» la rimanda alla settimana dopo', await p.evaluate(() => { const o = JSON.parse(localStorage.getItem('doctorwood_aggiornamenti')); return o.rimandata === '1.1.1' && Date.now() - o.ultimo < 60000; }));
    t('non scarica niente senza il sì', await p.evaluate(() => !window.__chiamate.includes('Cassaforte.scaricaAggiornamento')));
    t('nessun errore', !err.length, err.join(' | ')); await ctx.close(); }

  console.log('▶ App, controllo spento o recente');
  { const { p, ctx } = await apri(b, 'http://127.0.0.1:8765/index.html', true, { doctorwood_modalita: 'titolare', doctorwood_aggiornamenti: JSON.stringify({ attivo: false }) }, true);
    await p.waitForTimeout(8500);
    t('con il controllo spento non chiede niente a GitHub', await p.evaluate(() => !window.__chiamate.includes('Cassaforte.controllaAggiornamento')));
    await ctx.close(); }
  { const { p, ctx } = await apri(b, 'http://127.0.0.1:8765/index.html', true, { doctorwood_modalita: 'titolare', doctorwood_aggiornamenti: recente }, true);
    await p.waitForTimeout(8500);
    t('con un controllo di pochi giorni fa non richiede', await p.evaluate(() => !window.__chiamate.includes('Cassaforte.controllaAggiornamento')));
    await ctx.close(); }
  { const { p, ctx } = await apri(b, 'http://127.0.0.1:8765/index.html', true, { doctorwood_modalita: 'titolare' }, false);
    await p.waitForTimeout(8500);
    t('senza versioni nuove non disturba', !(await domandaAperta(p)) && await p.evaluate(() => window.__chiamate.includes('Cassaforte.controllaAggiornamento')));
    await ctx.close(); }

  console.log('▶ App, tablet solo laboratorio');
  { const { p, ctx, err } = await apri(b, 'http://127.0.0.1:8765/index.html', true, { doctorwood_modalita: 'laboratorio', doctorwood_solo_laboratorio: 'si' }, true);
    await p.waitForTimeout(8500);
    const d = await domandaAperta(p);
    t('anche il tablet chiede di aggiornarsi', /È uscita DoctorWood 1\.1\.1/.test(d), d.slice(0, 120));
    await p.evaluate(() => { window.__chiamate.length = 0; }); await p.click('#domSi'); await p.waitForTimeout(600);
    t('sul tablet «Aggiorna» scarica e installa', await p.evaluate(() => window.__chiamate.includes('Cassaforte.scaricaAggiornamento')));
    await p.evaluate(() => { window.__chiamate.length = 0; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(400);
    t('durante l\'installazione non rifissa l\'app sullo schermo', await p.evaluate(() => !window.__chiamate.includes('Laboratorio.fissaApp')));
    t('nessun errore', !err.length, err.join(' | ')); await ctx.close(); }

  console.log(`\nAggiornamenti: ${ok} riusciti, ${ko} falliti`);
  await b.close(); process.exit(ko ? 1 : 0);
})();
