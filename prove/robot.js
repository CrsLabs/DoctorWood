// Il robot dei tasti: in ogni sezione e finestra preme tutti i comandi visibili, uno per volta,
require('fs').mkdirSync(require('path').join(__dirname, 'risultati'), { recursive: true });
// e dentro le finestre che si aprono preme anche i loro. Registra errori, comandi mancanti, pagine che sbordano.
// Uso: node robot.js <nome-combinazione>
const { rispondiDomande, impostaDomande, leggiDomande } = require('./domande');
const { chromium, devices } = require('playwright');
const fs = require('fs');
const D = require('path').join(__dirname, 'risultati') + '/';
const COMBO = {
  'web-titolare-telefono-scuro':  { url: 'http://localhost:8766/sorgente-DoctorWood.html', dev: 'Pixel 7', tema: 'dark', modo: 'titolare', dati: 'realistici' },
  'web-titolare-pc-chiaro':       { url: 'http://localhost:8766/sorgente-DoctorWood.html', dev: 'pc', tema: 'light', modo: 'titolare', dati: 'realistici' },
  'web-titolare-telefono-vuoto':  { url: 'http://localhost:8766/sorgente-DoctorWood.html', dev: 'Pixel 7', tema: 'dark', modo: 'titolare', dati: 'vuoti' },
  'web-titolare-veleno':          { url: 'http://localhost:8766/sorgente-DoctorWood.html', dev: 'Pixel 7', tema: 'dark', modo: 'titolare', dati: 'veleno' },
  'android-titolare-telefono':    { url: 'http://localhost:8765/index.html', dev: 'Pixel 7', tema: 'dark', modo: 'titolare', dati: 'realistici', android: true },
  'android-titolare-tablet':      { url: 'http://localhost:8765/index.html', dev: 'Galaxy Tab S4', tema: 'light', modo: 'titolare', dati: 'realistici', android: true },
  'web-laboratorio-tablet':       { url: 'http://localhost:8766/sorgente-DoctorWood.html', dev: 'Galaxy Tab S4', tema: 'dark', modo: 'laboratorio', dati: 'realistici' },
  'android-laboratorio-telefono': { url: 'http://localhost:8765/index.html', dev: 'Pixel 7', tema: 'dark', modo: 'laboratorio', dati: 'realistici', android: true },
};
const nome = process.argv[2], C = COMBO[nome];
if (C && process.env.URL_WEB) C.url = C.url.replace('http://localhost:8766', process.env.URL_WEB);
if (C && process.env.URL_APP) C.url = C.url.replace('http://localhost:8765', process.env.URL_APP);
// combinazioni «leggere»: tutti i tasti di primo livello, conferme accettate (le complete sono le tre principali)
const LEGGERO = !['web-titolare-telefono-scuro', 'android-titolare-telefono', 'web-titolare-veleno'].includes(nome);
if (!C) { console.log('Combinazioni:', Object.keys(COMBO).join(', ')); process.exit(1); }

const MOCK_ANDROID = `(() => {
  const ok = (v) => Promise.resolve(v || {});
  window.__nativo = [];
  window.Capacitor = { isNativePlatform: () => true, nativePromise: (pl, m, o) => {
    __nativo.push(pl + '.' + m);
    if (m === 'puoSbloccare') return ok({ ok: false });
    if (m === 'stato') return ok({ biometria: 'pronta', chiave: false });
    if (m === 'frequenze') return ok({ massima: 120, attuale: 60 });
    if (m === 'statoFissaggio') return ok({ fissata: false });
    if (m === 'cancellaTutto') return Promise.reject(Object.assign(new Error('bloccato nella prova'), { code: 'PROVA' }));
    if (m === 'cifra' || m === 'decifra' || m === 'verificaIdentita' || m === 'scegliCartella' || m === 'scattaFoto') return Promise.reject(Object.assign(new Error('annullato'), { code: 'ANNULLATO' }));
    if (m === 'salvaFile') return ok({ salvato: false });
    return ok({});
  } };
})();`;

// dati
const realistici = JSON.parse(fs.readFileSync(D + 'dati-realistici.json', 'utf8'));
const P = `x"'><b data-pwn="1">PWN</b>`;
const campiV = ['name', 'nome', 'titolo', 'title', 'l', 'w', 'qta', 'n', 'numero', 'prezzo', 'cliente', 'lavoro', 'address', 'phone', 'email', 'note', 'descr', 'desc', 'tipo', 'stato', 'codice', 'fornitore', 'unita', 'sottocategoria', 'materiale', 'mat', 'ora', 'quantita', 'testo', 'produttore'];
const avvelena = v => Array.isArray(v) ? v.map(avvelena) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, campiV.includes(k) ? P : avvelena(x)])) : v;
function datiIniziali() {
  if (C.dati === 'vuoti') return { doctorwood_modalita: 'titolare' };
  const d = { ...realistici };
  if (C.dati === 'veleno') for (const k of ['doctorwood_clients', 'lavori', 'preventivi', 'magazzino', 'appuntamenti', 'schede', 'projects']) {
    try { d[k] = JSON.stringify(avvelena(JSON.parse(d[k]))); } catch (_) {}
  }
  d.doctorwood_modalita = C.modo;
  if (C.modo === 'laboratorio') { d.doctorwood_pin = d.doctorwood_pin || ''; }
  return d;
}

(async () => {
  const b = await chromium.launch();
  const opz = C.dev === 'pc' ? { viewport: { width: 1366, height: 860 } } : { ...devices[C.dev] };
  const ctx = await b.newContext({ locale: 'it-IT', ...opz, colorScheme: C.tema, acceptDownloads: true });
  if (C.android) await ctx.addInitScript(MOCK_ANDROID);
  await ctx.addInitScript(() => {
    window.__pwn = new Set();
    new MutationObserver(() => document.querySelectorAll('[data-pwn]').forEach(e => window.__pwn.add((e.closest('[id]') || {}).id || '?'))).observe(document, { childList: true, subtree: true });
    window.print = () => {};   // la finestra di stampa del browser bloccherebbe la prova
    window.__nonTradotti = new Set();   // INGLESE=1: i testi rimasti in italiano
  });
  let p = await ctx.newPage();
  const problemi = new Map();   // messaggio -> contesti
  let dove = '';
  const segna = (tipo, msg) => { const k = tipo + ': ' + String(msg).slice(0, 220); if (!problemi.has(k)) problemi.set(k, new Set()); problemi.get(k).add(dove); };
  let dialoghi = 0, accetta = true;
  const collega = () => {
  p.on('pageerror', e => segna('ERRORE', e.message));
  p.on('console', m => {
    const t = m.text();
    if (/non registrato|Content Security|Refused to/.test(t) || (m.type() === 'error' && !/Failed to load resource|net::ERR_FILE_NOT_FOUND|favicon/.test(t))) segna('CONSOLE', t);
    if (/non permesso in Laboratorio/.test(t) && C.modo === 'titolare') segna('BLOCCATO', t);
  });
  // «beforeunload» (es. taglio non salvato) arriva solo dal ricaricamento fatto dal robot fra un tasto e l'altro: si accetta sempre
  p.on('dialog', d => { if (d.type() === 'beforeunload') { d.accept().catch(() => {}); return; } dialoghi++; (d.type() === 'prompt' ? d.accept('12') : accetta ? d.accept() : d.dismiss()).catch(() => {}); });
  rispondiDomande(p, { accetta, testo: '12' }).catch(() => {});
  p.on('filechooser', () => {});
  p.on('download', d => d.cancel().catch(() => {}));

  };
  collega();
  const DATI = datiIniziali();
  if (process.env.INGLESE) DATI.doctorwood_lingua = 'en';
  const nonTradotti = new Map();   // testo -> dove
  const raccogli = () => p.evaluate(() => [...(window.__nonTradotti || [])]).then(l => l.forEach(t => { if (!nonTradotti.has(t)) nonTradotti.set(t, dove); })).catch(() => {});
  await p.goto(C.url);
  const ripristina = async () => {
    if (process.env.INGLESE) await raccogli();
    // la pagina risponde ancora? (un ciclo infinito la bloccherebbe)
    const viva = await Promise.race([p.evaluate(() => 1).catch(() => 0), new Promise(r => setTimeout(() => r(-1), 8000))]);
    if (viva !== 1) {
      segna('BLOCCO', viva === -1 ? 'la pagina non risponde più (codice bloccato?)' : 'pagina chiusa o rotta');
      try { await p.close({ runBeforeUnload: false }); } catch (_) {}
      p = await ctx.newPage(); collega(); await p.goto(C.url);
    }
    if (p.url().split('#')[0] !== C.url) { segna('NAVIGAZIONE', 'la pagina è andata a ' + p.url().slice(0, 80)); await p.goto(C.url); }
    await p.evaluate(D => { localStorage.clear(); sessionStorage.clear(); for (const [k, v] of Object.entries(D)) localStorage.setItem(k, v); }, DATI);
    try { await p.reload({ timeout: 20000 }); } catch (e) { segna('BLOCCO', 'ricaricamento non riuscito: ' + e.message.split('\n')[0]); try { await p.close({ runBeforeUnload: false }); } catch (_) {} p = await ctx.newPage(); collega(); await p.goto(C.url); await p.evaluate(D => { localStorage.clear(); for (const [k, v] of Object.entries(D)) localStorage.setItem(k, v); }, DATI); await p.reload(); }
    await p.waitForTimeout(700);
    await p.evaluate(() => { const a = document.getElementById('modalCassaforte'); if (a && !a.classList.contains('hidden')) document.getElementById('cassaNo').click(); });
  };
  const chiudiTutto = () => p.evaluate(() => {
    for (let i = 0; i < 8; i++) {
      const c = document.getElementById('modalCassaforte');
      if (c && !c.classList.contains('hidden')) { document.getElementById('cassaNo').click(); continue; }
      if (!(typeof chiudiFinestraAperta === 'function' && chiudiFinestraAperta())) break;
    }
  }).catch(() => {});

  // un tocco vero in un punto innocuo (il sottotitolo in alto), come fa una persona prima di ogni comando
  const gesto = async () => { const r = await p.evaluate(() => { const e = document.getElementById('headerSubtitle'); if (!e) return null; const b = e.getBoundingClientRect(); const sopra = document.elementFromPoint(b.left + 3, b.top + b.height / 2); return sopra === e ? { x: b.left + 3, y: b.top + b.height / 2 } : null; }).catch(() => null); if (r) await p.mouse.click(r.x, r.y); };
  // i contesti: come arrivarci
  const TIT = [
    ['Home', 'mostraDashboard()'],
    ['Taglio · calcolo', "apriStrumento('cutOptimizer'); cambiaSchedaTaglio('calc')"],
    ['Taglio · calcolato', "apriStrumento('cutOptimizer'); cambiaSchedaTaglio('calc'); calcolaOttimizzazione()"],
    ['Taglio · pannelli', "apriStrumento('cutOptimizer'); cambiaSchedaTaglio('panels')"],
    ['Taglio · progetti', "apriStrumento('cutOptimizer'); cambiaSchedaTaglio('projects')"],
    ['Rilievo', "apriStrumento('photoSurvey')"],
    ['Preventivi', "apriStrumento('quoteTool')"],
    ['Clienti', "apriStrumento('clientsTool'); vaiA('clientsTool')"],
    ['Clienti · dettaglio', "apriStrumento('clientsTool'); vaiA('clientsTool'); apriDettaglioCliente(getClienti()[0] && getClienti()[0].id)"],
    ['Lavori', "apriStrumento('clientsTool'); vaiA('jobsTool')"],
    ['Lavoro aperto', "apriStrumento('clientsTool'); vaiA('jobsTool'); leggiLavori()[0] && apriLavoro(leggiLavori()[0].id)"],
    ['Agenda · mese', "apriStrumento('agendaTool'); vistaAgenda('mese')"],
    ['Agenda · settimana', "apriStrumento('agendaTool'); vistaAgenda('settimana')"],
    ['Magazzino', "apriStrumento('magazzinoTool')"],
    ['Schede', "apriStrumento('schedeTool')"],
    ['Scheda aperta', "apriStrumento('schedeTool'); leggiSchede()[0] && apriDettaglioScheda(leggiSchede()[0].id)"],
    ['Impostazioni', 'apriImpostazioni()'],
    ...['aspetto', 'vibrazione', 'taglio', 'preventivi', 'magazzino', 'agenda', 'lavori', 'laboratorio', 'dati'].map(c => ['Impostazioni · ' + c, `apriImpostazioni(); apriCatImp('${c}')`]),
  ];
  const LAB = [
    ['Laboratorio', 'mostraDashboard()'],
    ['Laboratorio · lavoro aperto', "mostraDashboard(); (function(){ const b = document.querySelector('#viewLaboratorio [data-click^=\"apriLavoroLab\"]'); if (b) b.click(); })()"],
    ['Laboratorio · schede', "apriStrumento('schedeTool')"],
    ['Laboratorio · scheda aperta', "apriStrumento('schedeTool'); leggiSchede()[0] && apriDettaglioScheda(leggiSchede()[0].id)"],
  ];
  let CONTESTI = C.modo === 'laboratorio' ? LAB : TIT;
  if (process.env.SOLO) CONTESTI = CONTESTI.filter(c => c[0].startsWith(process.env.SOLO));

  // i comandi visibili nella parte in primo piano (la finestra più in alto, se c'è; altrimenti la pagina)
  const elenca = () => p.evaluate(() => {
    const aperte = [...document.querySelectorAll('[id^=modal]:not(.hidden)')].filter(m => m.id !== 'modalEditNote' || m.getBoundingClientRect().top < innerHeight - 4);
    const radice = aperte.sort((a, b) => (+getComputedStyle(b).zIndex || 0) - (+getComputedStyle(a).zIndex || 0))[0] || document.body;
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.hidden'); };
    const el = [...radice.querySelectorAll('[data-click], button, a[href], select, input:not([type=hidden]), textarea, [role=switch], [role=radio]')]
      .filter(e => vis(e) && !e.disabled);
    window.__el = el;
    return { radice: radice.id || 'pagina', voci: el.map(e => (e.getAttribute('data-click') || e.getAttribute('data-change') || e.getAttribute('aria-label') || e.tagName + ':' + (e.type || '')) + ' «' + (e.textContent || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 30) + '»') };
  });
  // preme il comando n-esimo (come una persona: tocco vero se si può, altrimenti evento)
  const premi = async i => {
    await gesto();
    const tipo = await p.evaluate(i => { const e = window.__el[i]; if (!e) return null; e.scrollIntoView({ block: 'center' }); return e.tagName + ':' + (e.type || ''); }, i);
    if (!tipo) return;
    if (tipo.startsWith('SELECT')) {
      await p.evaluate(i => { const s = window.__el[i]; const o = [...s.options].filter(o => !o.disabled); if (o.length) { s.value = o[o.length > 1 ? 1 : 0].value; s.dispatchEvent(new Event('change', { bubbles: true })); } }, i);
    } else if (/INPUT:(text|number|search|tel|email|date|time|password)|TEXTAREA/.test(tipo)) {
      await p.evaluate(i => { const e = window.__el[i]; e.focus(); e.value = e.type === 'date' ? '2026-12-15' : e.type === 'time' ? '10:30' : e.type === 'number' || e.inputMode === 'decimal' || e.inputMode === 'numeric' ? '12' : 'Prova 12'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); e.blur(); }, i);
    } else if (/INPUT:range/.test(tipo)) {
      await p.evaluate(i => { const e = window.__el[i]; e.value = e.max || 1; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, i);
    } else if (/INPUT:file/.test(tipo)) {
      return;   // i file si provano a parte
    } else {
      await p.evaluate(i => window.__el[i].click(), i);
    }
    await p.waitForTimeout(160);
  };

  let premuti = 0;
  const t0 = Date.now();
  for (const [nomeC, apri] of CONTESTI) {
    for (const modoDialoghi of (LEGGERO ? [true] : [true, false])) {   // conferme accettate, poi rifiutate
      accetta = modoDialoghi; await impostaDomande(p, { accetta }).catch(() => {});
      await ripristina();
      dove = nomeC; await gesto(); try { await p.evaluate(apri); } catch (e) { segna('APERTURA', e.message); continue; }
      await p.waitForTimeout(400);
      // sborda in larghezza?
      const largo = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (largo > 2) segna('LAYOUT', `la pagina sborda di ${largo}px`);
      const { voci } = await elenca();
      for (let i = 0; i < voci.length; i++) {
        await ripristina();
        await gesto(); try { await p.evaluate(apri); } catch (_) {}
        await p.waitForTimeout(250);
        const ora = await elenca();
        if (i >= ora.voci.length) break;
        dove = `${nomeC} → ${ora.voci[i]}${modoDialoghi ? '' : ' [Annulla]'}`;
        const primaRad = ora.radice;
        try { await premi(i); premuti++; } catch (e) { segna('PREMUTO', e.message.split('\n')[0]); continue; }
        // si è aperta una finestra nuova? allora si premono anche i suoi comandi (secondo livello)
        if (!modoDialoghi || LEGGERO) continue;
        const dopo = await elenca().catch(() => ({ radice: '', voci: [] }));
        if (dopo.radice !== primaRad && dopo.radice !== 'pagina' && dopo.voci.length) {
          const largoF = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          if (largoF > 2) segna('LAYOUT', `con la finestra ${dopo.radice} la pagina sborda di ${largoF}px`);
          for (let j = 0; j < dopo.voci.length && j < 40; j++) {
            await ripristina();
            await gesto(); try { await p.evaluate(apri); } catch (_) {}
            await p.waitForTimeout(200);
            await elenca(); await premi(i).catch(() => {});
            const f = await elenca();
            if (f.radice !== dopo.radice || j >= f.voci.length) break;
            dove = `${nomeC} → ${ora.voci[i]} → ${f.voci[j]}`;
            try { await premi(j); premuti++; } catch (e) { segna('PREMUTO', e.message.split('\n')[0]); }
          }
        }
      }
    }
    process.stdout.write(`· ${nomeC}: fatto (${Math.round((Date.now() - t0) / 1000)} s, ${premuti} tasti)\n`);
  }
  // in fondo: nessuna iniezione con i dati avvelenati
  const pwn = await p.evaluate(() => [...window.__pwn]);
  if (pwn.length) segna('INIEZIONE', 'elementi iniettati in ' + pwn.join(', '));
  const r = { combinazione: nome, tastiPremuti: premuti, dialoghi, secondi: Math.round((Date.now() - t0) / 1000), problemi: [...problemi].map(([k, v]) => ({ problema: k, dove: [...v].slice(0, 6), volte: v.size })) };
  if (process.env.INGLESE) { await raccogli(); fs.writeFileSync(D + 'non-tradotti-' + nome + '.json', JSON.stringify([...nonTradotti], null, 1)); console.log(`testi senza traduzione: ${nonTradotti.size}`); }
  fs.writeFileSync(D + 'robot-' + nome + '.json', JSON.stringify(r, null, 1));
  console.log(`\n${nome}: ${premuti} tasti premuti, ${dialoghi} richieste di conferma, ${r.problemi.length} problemi diversi`);
  r.problemi.forEach(x => console.log(' - ' + x.problema + '  [' + x.volte + ' volte] es.: ' + x.dove.slice(0, 2).join(' | ')));
  await b.close();
})();
