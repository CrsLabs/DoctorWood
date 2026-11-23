// Praticità: ogni schermata, in titolare e laboratorio, su quattro schermi (telefono stretto 320 px, telefono, tablet,
// PC). Per ogni schermata misura ciò che rende l'app scomoda da usare con le dita o con un lettore vocale:
//  - tasti piccoli (lato minore < 32 px: difficili da prendere con il dito; la guida Android consiglia 48 dp)
//  - tasti senza nome (né testo, né aria-label, né title: il lettore vocale dice solo «pulsante»)
//  - campi senza etichetta (né label, né aria-label, né segnaposto)
//  - pagina che sborda di lato (scorrimento orizzontale)
//  - testo minuscolo (< 11 px)
//  - tasti coperti da un altro elemento (non si possono toccare)
// Uso: node prove/pratica.js   (servono i due server delle prove e risultati/dati-realistici.json di scenari.js)
const { rispondiDomande, impostaDomande, leggiDomande } = require('./domande');
const { chromium, devices } = require('playwright');
const fs = require('fs');
const D = require('path').join(__dirname, 'risultati') + '/';
const DATI = JSON.parse(fs.readFileSync(D + 'dati-realistici.json', 'utf8'));
const MOCK = `(() => { window.Capacitor = { isNativePlatform: () => true, addListener: () => ({ remove() {} }), nativePromise: (pl, m) => {
  if (m === 'stato') return Promise.resolve({ biometria: 'pronta', chiave: false });
  if (m === 'puoSbloccare') return Promise.resolve({ ok: false });
  if (m === 'statoFissaggio') return Promise.resolve({ fissata: false });
  return Promise.resolve({}); } }; })();`;

const TIT = [
  ['Home', 'mostraDashboard()'], ['Taglio · calcolo', "apriStrumento('cutOptimizer'); cambiaSchedaTaglio('calc')"],
  ['Taglio · calcolato', "apriStrumento('cutOptimizer'); cambiaSchedaTaglio('calc'); calcolaOttimizzazione()"],
  ['Taglio · pannelli', "apriStrumento('cutOptimizer'); cambiaSchedaTaglio('panels')"], ['Taglio · progetti', "apriStrumento('cutOptimizer'); cambiaSchedaTaglio('projects')"],
  ['Rilievo', "apriStrumento('photoSurvey')"], ['Preventivi', "apriStrumento('quoteTool')"],
  ['Clienti', "apriStrumento('clientsTool'); vaiA('clientsTool')"],
  ['Cliente', "apriStrumento('clientsTool'); vaiA('clientsTool'); apriDettaglioCliente(getClienti()[0] && getClienti()[0].id)"],
  ['Lavori', "apriStrumento('clientsTool'); vaiA('jobsTool')"], ['Lavoro aperto', "apriStrumento('clientsTool'); vaiA('jobsTool'); leggiLavori()[0] && apriLavoro(leggiLavori()[0].id)"],
  ['Agenda · mese', "apriStrumento('agendaTool'); vistaAgenda('mese')"], ['Agenda · settimana', "apriStrumento('agendaTool'); vistaAgenda('settimana')"],
  ['Magazzino', "apriStrumento('magazzinoTool')"], ['Schede', "apriStrumento('schedeTool')"],
  ['Scheda aperta', "apriStrumento('schedeTool'); leggiSchede()[0] && apriDettaglioScheda(leggiSchede()[0].id)"],
  ...['aspetto', 'vibrazione', 'taglio', 'preventivi', 'magazzino', 'agenda', 'lavori', 'laboratorio', 'dati'].map(c => ['Impostazioni · ' + c, `apriImpostazioni(); apriCatImp('${c}')`]),
];
const LAB = [
  ['Laboratorio', 'mostraDashboard()'],
  ['Laboratorio · lavoro', "mostraDashboard(); (function(){ const b = document.querySelector('#viewLaboratorio [data-click^=\"apriLavoroLab\"]'); if (b) b.click(); })()"],
  ['Laboratorio · schede', "apriStrumento('schedeTool')"],
];
const SCHERMI = [
  ['telefono stretto 320', { viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['telefono', devices['Pixel 7']], ['tablet', devices['Galaxy Tab S4']], ['PC', { viewport: { width: 1366, height: 860 } }],
];

// TESTO=115|130: dimensione del testo. Nella pagina web è lo zoom vero (impostazione salvata); nell'app Android si
// simula lo zoom del testo della WebView: ogni scritta prende la sua dimensione calcolata × il fattore.
const TESTO = [115, 130].includes(Number(process.env.TESTO)) ? Number(process.env.TESTO) : 100;
const EMULA_ZOOM_TESTO = f => {
  for (const e of document.querySelectorAll('[data-zfs]')) { const o = e.getAttribute('data-zfs'); if (o) e.style.setProperty('font-size', o); else e.style.removeProperty('font-size'); e.removeAttribute('data-zfs'); }
  const el = [...document.querySelectorAll('body, body *')].map(e => [e, parseFloat(getComputedStyle(e).fontSize)]);
  for (const [e, px] of el) { e.setAttribute('data-zfs', e.style.getPropertyValue('font-size') || ''); e.style.setProperty('font-size', (px * f) + 'px', 'important'); }
};
const MISURA = () => {
  const vis = e => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('.hidden') && r.bottom > 0 && r.top < innerHeight * 3; };
  // le finestre davvero aperte (la nota del rilievo resta parcheggiata sotto lo schermo: non conta)
  const aperte = [...document.querySelectorAll('[id^=modal]:not(.hidden)')].filter(vis).filter(m => m.getBoundingClientRect().top < innerHeight - 4);
  const radice = aperte.sort((a, b) => (+getComputedStyle(b).zIndex || 0) - (+getComputedStyle(a).zIndex || 0))[0] || document.body;
  const descr = e => (e.id ? '#' + e.id : e.tagName.toLowerCase()) + ' «' + ((e.innerText || e.getAttribute('aria-label') || e.title || e.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 30)) + '»' + (e.dataset.click ? ' [' + e.dataset.click.slice(0, 30) + ']' : '');
  const comandi = [...radice.querySelectorAll('button, a[href], [role=button], [data-click], input:not([type=hidden]), select, textarea')].filter(vis)
    .filter(e => !(e.tagName === 'INPUT' && e.type === 'file' && getComputedStyle(e).opacity === '0'));
  const piccoli = [], senzaNome = [], campi = [], coperti = [];
  for (const e of comandi) {
    const r = e.getBoundingClientRect();
    const campo = /^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName);
    if (Math.min(r.width, r.height) < 32 && !(e.type === 'checkbox' || e.type === 'radio') && !e.closest('label')) piccoli.push(descr(e) + ` ${Math.round(r.width)}×${Math.round(r.height)}`);
    if (!campo && !(e.innerText || e.textContent || '').trim() && !e.getAttribute('aria-label') && !e.title && !e.getAttribute('aria-labelledby') && !e.querySelector('img[alt]:not([alt=""])')) senzaNome.push(descr(e));
    if (campo && e.type !== 'checkbox' && e.type !== 'radio' && e.type !== 'range' && e.type !== 'color' && !e.getAttribute('aria-label') && !e.placeholder && !e.title && !e.closest('label') && !(e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)) && !e.getAttribute('aria-labelledby')) campi.push(descr(e));
    const coperto = () => {
      const q = e.getBoundingClientRect();
      if (q.top < 0 || q.bottom > innerHeight || q.left < 0 || q.right > innerWidth) return null;
      const sopra = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      return sopra && sopra !== e && !e.contains(sopra) && !sopra.contains(e) && !(sopra.closest('label') && sopra.closest('label').contains(e)) ? sopra : null;
    };
    // coperto anche dopo averlo portato al centro dello schermo (come farebbe una persona scorrendo)? allora è un problema vero
    if (coperto()) { e.scrollIntoView({ block: 'center', behavior: 'instant' }); const s2 = coperto(); if (s2) coperti.push(descr(e) + ' ← ' + descr(s2)); }
  }
  const minuscoli = [...radice.querySelectorAll('*')].filter(e => e.children.length === 0 && (e.innerText || '').trim() && vis(e) && parseFloat(getComputedStyle(e).fontSize) < 11).map(e => ((e.innerText || '').trim().slice(0, 25)) + ' ' + getComputedStyle(e).fontSize);
  // testo che non entra nel suo riquadro e viene tagliato (o finisce sopra altro)
  const tagliati = [...radice.querySelectorAll('button, a, span, label, p, div, h1, h2, h3, h4, strong')].filter(e => vis(e) && e.children.length === 0 && (e.innerText || '').trim() && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && getComputedStyle(e).textOverflow !== 'ellipsis' && getComputedStyle(e).overflowX !== 'auto' && getComputedStyle(e).overflowX !== 'scroll')
    .map(e => ((e.innerText || '').trim().slice(0, 30)) + ` ${e.scrollWidth}/${e.clientWidth}`)
    // e le scritte che escono dal proprio tasto (anche quelle «in linea», che non hanno una larghezza propria)
    .concat([...radice.querySelectorAll('button span, button, a span, [role=button] span')].filter(e => vis(e) && e.children.length === 0 && (e.innerText || '').trim()).filter(e => {
      const t = e.closest('button, a, [role=button]'); if (!t || t === e) return false;
      const a = e.getBoundingClientRect(), c = t.getBoundingClientRect(); return a.left < c.left - 1 || a.right > c.right + 1;
    }).map(e => ((e.innerText || '').trim().slice(0, 30)) + ' esce dal tasto'));
  const larghezza = document.documentElement.scrollWidth - innerWidth;
  return { comandi: comandi.length, piccoli, senzaNome, campi, coperti, minuscoli, tagliati, debordo: larghezza > 1 ? larghezza : 0 };
};

(async () => {
  const b = await chromium.launch();
  const totale = { comandi: 0, piccoli: 0, senzaNome: 0, campi: 0, coperti: 0, minuscoli: 0, tagliati: 0, debordo: 0 };
  const esempi = { piccoli: new Map(), senzaNome: new Map(), campi: new Map(), coperti: new Map(), minuscoli: new Map(), tagliati: new Map(), debordo: new Map() };
  const errori = [];
  for (const [schermo, opz] of SCHERMI) for (const [modo, url, contesti] of [
    ['titolare web', 'http://localhost:8766/sorgente-DoctorWood.html', TIT], ['titolare Android', 'http://localhost:8765/index.html', TIT], ['laboratorio Android', 'http://localhost:8765/index.html', LAB]]) {
    const ctx = await b.newContext({ locale: 'it-IT', ...opz });
    if (/Android/.test(modo)) await ctx.addInitScript(MOCK);
    const dati = { ...DATI, doctorwood_modalita: modo.startsWith('lab') ? 'laboratorio' : 'titolare', doctorwood_blocco_titolare: 'no', doctorwood_testo: String(TESTO) };
    await ctx.addInitScript(a => { if (!sessionStorage.getItem('__fatto')) { localStorage.clear(); for (const k in a) localStorage.setItem(k, a[k]); sessionStorage.setItem('__fatto', '1'); } }, dati);
    const p = await ctx.newPage();
    p.on('pageerror', e => errori.push(`${schermo} ${modo}: ${e.message}`));
    p.on('dialog', d => d.dismiss().catch(() => {}));
    await rispondiDomande(p, { accetta: false });
    await p.goto(url); await p.waitForTimeout(1200);
    for (const [nome, js] of contesti) {
      await p.evaluate(() => { for (let i = 0; i < 6 && typeof chiudiFinestraAperta === 'function' && chiudiFinestraAperta(); i++); }).catch(() => {});
      await p.evaluate(js).catch(() => {});
      await p.waitForTimeout(450);
      if (TESTO !== 100 && /Android/.test(modo)) { await p.evaluate(EMULA_ZOOM_TESTO, TESTO / 100).catch(() => {}); await p.waitForTimeout(150); }
      const m = await p.evaluate(MISURA).catch(e => null);
      if (!m) continue;
      totale.comandi += m.comandi;
      const dove = `${schermo} · ${modo} · ${nome}`;
      for (const k of ['piccoli', 'senzaNome', 'campi', 'coperti', 'minuscoli', 'tagliati']) {
        totale[k] += m[k].length;
        if (k === 'piccoli' && /telefono/.test(schermo)) totale.piccoliTelefono = (totale.piccoliTelefono || 0) + m[k].length;
        for (const x of m[k]) { const chiave = x.replace(/ \d+×\d+$/, '').replace(/ \d+(\.\d+)?px$/, '').replace(/ \d+\/\d+$/, ''); if (!esempi[k].has(chiave)) esempi[k].set(chiave, `${x} — ${dove}`); }
      }
      if (m.debordo) { totale.debordo++; esempi.debordo.set(dove, `sborda di ${m.debordo} px`); }
    }
    await ctx.close();
  }
  await b.close();
  const N = { piccoli: 'Tasti piccoli (< 32 px)', senzaNome: 'Tasti senza nome', campi: 'Campi senza etichetta', coperti: 'Tasti coperti', minuscoli: 'Testo < 11 px', tagliati: 'Testo tagliato (non entra nel riquadro)', debordo: 'Schermate che sbordano' };
  console.log(`Dimensione del testo: ${TESTO}%`);
  console.log(`Comandi misurati: ${totale.comandi} · tasti piccoli sui telefoni: ${totale.piccoliTelefono || 0}`);
  for (const k of Object.keys(N)) {
    console.log(`\n${N[k]}: ${totale[k]} (diversi: ${esempi[k].size})`);
    const elenco = [...esempi[k].values()];
    // prima i telefoni (dove le dita contano), poi il resto
    elenco.sort((x, y) => (/— telefono/.test(y) ? 1 : 0) - (/— telefono/.test(x) ? 1 : 0));
    elenco.slice(0, process.env.TUTTI ? 999 : 40).forEach(x => console.log('  - ' + x));
  }
  console.log('\nErrori in pagina: ' + (errori.length ? errori.slice(0, 5).join(' | ') : 'nessuno'));
})();
