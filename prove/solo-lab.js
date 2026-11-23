// «Solo Laboratorio» al primo avvio e controllo dei dati che vanno al tablet (niente prezzi, telefoni, email, P.IVA).
// Uso: node prove/solo-lab.js   (server 8766 sulla cartella DoctorWood e 8765 sulla cartella www)
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
let ok = 0, ko = 0;
const t = (n, c, info = '') => { (c ? ok++ : ko++); console.log((c ? '  ✓ ' : '  ✗ ') + n + (info && !c ? ' — ' + info : '')); };
const MOCK = () => { window.Capacitor = { isNativePlatform: () => true, addListener: () => ({ remove() {}, then: f => f && f({ remove() {} }) }),
  nativePromise: (pl, m) => Promise.resolve(m === 'puoSbloccare' || m === 'statoBiometria' ? { ok: false } : {}) }; };

async function primoAvvio(b, url, app, risposta) {
  const ctx = await b.newContext({ ...devices['Pixel 7'], locale: 'it-IT' });
  if (app) await ctx.addInitScript(MOCK);
  await ctx.addInitScript(() => { if (!sessionStorage.getItem('__f')) { sessionStorage.setItem('__f', '1'); localStorage.clear(); localStorage.setItem('doctorwood_animazioni', 'no'); localStorage.setItem('doctorwood_docs_chiesto', 'si'); } });
  const p = await ctx.newPage(); const err = []; p.on('pageerror', e => err.push(e.message));
  await p.goto(url); await p.waitForTimeout(1500);
  await p.evaluate(() => document.querySelector('[data-click="scegliIniziale(\'laboratorio\')"]').click());
  await p.waitForTimeout(1800);
  const domanda = await p.evaluate(() => { const f = document.getElementById('modalDomanda'); return f && !f.classList.contains('hidden') ? f.innerText : ''; });
  t('al primo avvio «Laboratorio» chiede se il tablet è solo per il laboratorio', /solo per il laboratorio/.test(domanda), domanda.slice(0, 120));
  await p.evaluate(r => document.getElementById(r ? 'domSi' : 'domNo').click(), risposta); await p.waitForTimeout(1500);
  return { p, ctx, err };
}

(async () => {
  const b = await chromium.launch();
  for (const [nome, url, app] of [['Pagina web', 'http://127.0.0.1:8766/sorgente-DoctorWood.html', false], ['App Android (simulata)', 'http://127.0.0.1:8765/index.html', true]]) {
    console.log('▶ ' + nome + ': «Sì, solo laboratorio»');
    let { p, ctx, err } = await primoAvvio(b, url, app, true);
    const s = await p.evaluate(() => ({ mod: localStorage.getItem('doctorwood_modalita'), solo: localStorage.getItem('doctorwood_solo_laboratorio'), pin: localStorage.getItem('doctorwood_pin'),
      pinAperto: !document.getElementById('modalPin').classList.contains('hidden'), classe: document.body.classList.contains('solo-lab'),
      tasto: [...document.querySelectorAll('[data-click="esciLaboratorio()"]')].some(e => e.offsetParent) }));
    t('resta in Laboratorio, segnato «solo laboratorio»', s.mod === 'laboratorio' && /si/.test(s.solo || '') && s.classe, JSON.stringify(s));
    t('nessun PIN chiesto né salvato', !s.pin && !s.pinAperto);
    t('il tasto «Titolare» non c\'è', !s.tasto);
    await p.evaluate(() => esciLaboratorio()); await p.waitForTimeout(600);
    t('anche chiamando l\'uscita, resta in Laboratorio e lo spiega', await p.evaluate(() => localStorage.getItem('doctorwood_modalita') === 'laboratorio' && /solo per il laboratorio/.test(document.body.innerText)));
    await p.evaluate(() => scegliModalita('titolare')); await p.waitForTimeout(600);
    t('nemmeno dalle Impostazioni diventa Titolare', await p.evaluate(() => localStorage.getItem('doctorwood_modalita') === 'laboratorio'));
    await p.reload(); await p.waitForTimeout(1500);
    t('dopo la riapertura è ancora solo Laboratorio', await p.evaluate(() => localStorage.getItem('doctorwood_modalita') === 'laboratorio' && document.body.classList.contains('solo-lab')));
    t('nessun errore in pagina', !err.length, err.join(' | '));
    await ctx.close();

    console.log('▶ ' + nome + ': «No, anche Titolare»');
    ({ p, ctx, err } = await primoAvvio(b, url, app, false));
    const n = await p.evaluate(() => ({ pinAperto: !document.getElementById('modalPin').classList.contains('hidden'), solo: localStorage.getItem('doctorwood_solo_laboratorio') }));
    t('chiede il PIN per uscire dal Laboratorio, come prima', n.pinAperto && !n.solo, JSON.stringify(n));
    t('nessun errore in pagina', !err.length, err.join(' | '));
    await ctx.close();
  }

  console.log('▶ Cosa va al tablet');
  const dati = JSON.parse(fs.readFileSync(path.join(__dirname, 'risultati', 'dati-realistici.json'), 'utf8'));
  const ctx = await b.newContext({ locale: 'it-IT', viewport: { width: 1200, height: 900 } });
  await ctx.addInitScript(d => { if (sessionStorage.getItem('__f')) return; sessionStorage.setItem('__f', '1'); localStorage.clear(); for (const k in d) localStorage.setItem(k, typeof d[k] === 'string' ? d[k] : JSON.stringify(d[k])); localStorage.setItem('doctorwood_modalita', 'titolare'); localStorage.setItem('doctorwood_blocco_titolare', 'no'); localStorage.setItem('doctorwood_docs_chiesto', 'si'); localStorage.setItem('doctorwood_animazioni', 'no'); }, dati);
  const p = await ctx.newPage(); await p.goto('http://127.0.0.1:8766/sorgente-DoctorWood.html'); await p.waitForTimeout(1500);
  // tutti i lavori «mandati al laboratorio»: è il caso con più dati possibili sul tablet
  const r = await p.evaluate(() => {
    const L = leggiLavori(); L.forEach(l => { l.labDa = Date.now(); }); scriviStorage('lavori', L);
    const d = datiLabDaLavori(), json = JSON.stringify(d);
    const chiavi = new Set(); (function giro(o) { if (Array.isArray(o)) o.forEach(giro); else if (o && typeof o === 'object') for (const k in o) { chiavi.add(k); giro(o[k]); } })(d);
    const cli = getClienti(), segreti = [];
    cli.forEach(c => ['phone', 'telefono', 'email', 'piva', 'notes', 'note'].forEach(k => { const v = c[k]; if (typeof v === 'string' && v.trim().length >= 5) segreti.push(v.trim()); }));
    return { n: d.lavori.length, chiavi: [...chiavi], trovati: segreti.filter(x => json.includes(x)), segreti: segreti.length, euro: /€|prezz|costo|import|totale|iva|sconto|incass|acconto/i.test(Object.keys(Object.fromEntries([...chiavi].map(k => [k, 1]))).join(' ')) };
  });
  const AMMESSE = ['app', 'formato', 'creato', 'lavori', 'id', 'titolo', 'cliente', 'indirizzo', 'stato', 'montaggio', 'data', 'ora', 'tagli', 'nome', 'tipo', 'l', 'w', 'pezzi', 'qta', 'mat', 'bL', 'bW', 'materiali', 'k', 'unita', 'segreto'];
  t('ci sono lavori da mandare (la prova ha senso)', r.n > 0, String(r.n));
  t('solo voci ammesse: lavori, pezzi, materiali, cliente e indirizzo del montaggio', r.chiavi.every(k => AMMESSE.includes(k)), r.chiavi.filter(k => !AMMESSE.includes(k)).join(', '));
  t('nessun prezzo, costo, importo, IVA o incasso', !r.euro);
  t('nessun telefono, email, P.IVA o nota dei clienti (' + r.segreti + ' controllati)', !r.trovati.length, r.trovati.join(', '));
  await ctx.close();
  console.log(`\nSolo Laboratorio e dati del tablet: ${ok} riusciti, ${ko} falliti`);
  await b.close();
  process.exit(ko ? 1 : 0);
})();
