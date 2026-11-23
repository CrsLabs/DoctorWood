// DoctorWood in inglese: con i dati d'esempio (prove/risultati/dati-realistici.json, creato da prove/scenari.js) si visitano le sezioni
// e le finestre principali, da Titolare e da Laboratorio, e si controlla che nei testi mostrati non resti italiano;
// poi «Italiano» rimette tutto in italiano subito, senza ricaricare, e «English» lo ritraduce.
// Uso: node prove/inglese.js   (server 8766 sulla cartella DoctorWood)   ·   RACCOLTA=file.json salva i testi senza traduzione
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const URL = process.env.URL_WEB || 'http://127.0.0.1:8766/sorgente-DoctorWood.html';
const dati = JSON.parse(fs.readFileSync(path.join(__dirname, 'risultati', 'dati-realistici.json'), 'utf8'));
delete dati.doctorwood_pin; delete dati.doctorwood_pin_blocco;
// parole italiane che in un testo inglese non devono comparire
const ITALIANO = /[àèéìòù]|\b(il|lo|gli|di|del|della|delle|dei|che|non|più|sono|nel|nella|anche|come|quando|solo|tutti|tutte|senza|dal|dalla|alla|uno|una|lavoro|lavori|cliente|clienti|preventivo|preventivi|taglio|magazzino|rilievo|scheda|schede|pannello|pannelli|pezzi|avanzi|aggiungi|salva|chiudi|annulla|impostazioni|oggi|giorni|mese|prossimo|scegli|tocca|nuovo|nuova)\b/i;
let ok = 0, ko = 0;
const esito = (n, c, info = '') => { if (c) ok++; else ko++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (info ? ' — ' + info : '')); };

(async () => {
  const b = await chromium.launch();
  const raccolti = new Set();
  const apri = async (modalita, extra = {}) => {
    const ctx = await b.newContext({ ...devices['Pixel 7'], locale: 'it-IT' });
    await ctx.addInitScript(([d, m, e]) => {
      window.__nonTradotti = new Set();
      if (!sessionStorage.getItem('__f')) { sessionStorage.setItem('__f', '1'); localStorage.clear(); for (const k in d) localStorage.setItem(k, d[k]);
        localStorage.setItem('doctorwood_modalita', m); localStorage.setItem('doctorwood_lingua', 'en'); localStorage.setItem('doctorwood_animazioni', 'no'); for (const k in e) localStorage.setItem(k, e[k]); }
    }, [dati, modalita, extra]);
    const P = await ctx.newPage();
    P.errori = []; P.on('pageerror', e => P.errori.push(e.message));
    await P.goto(URL); await P.waitForTimeout(1800);
    return P;
  };
  const nomi = await (async () => { const n = new Set(); const giro = x => { if (Array.isArray(x)) x.forEach(giro); else if (x && typeof x === 'object') for (const k in x) { const v = x[k]; if (typeof v === 'string' && v.length > 1) n.add(v); else giro(v); } };
    for (const k in dati) { try { giro(JSON.parse(dati[k])); } catch (_) {} } return [...n].sort((a, b) => b.length - a.length); })();
  // i testi che si vedono adesso, senza i dati scritti da chi usa l'app
  const italiani = async P => {
    const testi = await P.evaluate(() => {
      const out = new Set(), w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const el = n.parentElement; if (!el || ['SCRIPT', 'STYLE', 'TEXTAREA'].includes(el.tagName) || el.closest('[data-no-tr]')) continue;
        const r = el.getBoundingClientRect(), st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || (!r.width && !r.height) || el.closest('.hidden')) continue;
        const t = n.data.trim(); if (t) out.add(t);
      }
      document.querySelectorAll('input[placeholder], textarea[placeholder], [aria-label]').forEach(e => { const r = e.getBoundingClientRect(); if (r.width && !e.closest('.hidden')) { const t = e.getAttribute('placeholder') || e.getAttribute('aria-label'); if (t) out.add(t); } });
      return [...out];
    });
    return testi.map(t => { let x = t; for (const n of nomi) x = x.split(n).join(' '); return { t, x }; }).filter(o => ITALIANO.test(o.x)).map(o => o.t);
  };
  const controlla = async (P, nome, f) => {
    try { await P.evaluate(f); await P.waitForTimeout(500); const r = await italiani(P); esito(nome, !r.length, r.slice(0, 6).join(' | ')); }
    catch (e) { ko++; console.log('  ✗ ' + nome + ' — ERRORE ' + e.message.split('\n')[0].slice(0, 160)); }
    await P.evaluate(() => { for (let i = 0; i < 6; i++) if (!(typeof chiudiFinestraAperta === 'function' && chiudiFinestraAperta())) break; }).catch(() => {});
    await P.waitForTimeout(300);
  };
  const raccogli = async P => (await P.evaluate(() => [...(window.__nonTradotti || [])])).forEach(t => raccolti.add(t));

  console.log('▶ Titolare: sezioni');
  let P = await apri('titolare');
  esito('la pagina è in inglese (lang=en)', await P.evaluate(() => document.documentElement.lang === 'en' && inglese()));
  await controlla(P, 'Home', () => mostraDashboard());
  for (const v of ['photoSurvey', 'cutOptimizer', 'magazzinoTool', 'quoteTool', 'schedeTool', 'clientsTool', 'jobsTool', 'agendaTool']) await controlla(P, v, new Function(`vaiA('${v}')`));
  console.log('▶ Titolare: finestre');
  await controlla(P, 'taglio calcolato', () => { vaiA('cutOptimizer'); apriProgetto(0); calcolaOttimizzazione(); });
  await controlla(P, 'confronta gli schemi', () => { vaiA('cutOptimizer'); apriProgetto(0); calcolaOttimizzazione(); confrontaSchemi(); });
  await controlla(P, 'mobile da modello', () => { vaiA('cutOptimizer'); apriModello(); });
  await controlla(P, 'scheda del lavoro', () => { apriLavoro(JSON.parse(localStorage.getItem('lavori'))[0].id); });
  await controlla(P, 'nuovo lavoro guidato', () => nuovoDaHome('lavoro'));
  await controlla(P, 'nuovo appuntamento', () => nuovoDaHome('appuntamento'));
  await controlla(P, 'firma del cliente', () => { vaiA('quoteTool'); apriPreventivo(JSON.parse(localStorage.getItem('preventivi'))[0].id); apriFirmaCliente(); });
  await controlla(P, 'dati della ditta', () => apriModaleDitta());
  await controlla(P, 'esporta backup', () => esportaBackup());
  await controlla(P, 'impostazioni (tutte le sezioni aperte)', () => { apriImpostazioni(); ['aspetto', 'vibrazione', 'taglio', 'preventivi', 'magazzino', 'agenda', 'lavori', 'laboratorio', 'dati'].forEach(c => { try { apriCatImp(c); } catch (_) {} }); });
  await controlla(P, 'segnala un problema', () => apriSegnalazione());
  await controlla(P, 'informazioni e licenze', () => apriInfo());
  console.log('▶ Date e numeri');
  await P.evaluate(() => mostraDashboard()); await P.waitForTimeout(400);
  const home = await P.evaluate(() => document.body.innerText);
  esito('la data della Home è in inglese', /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/.test(home) && !/\b(lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica)\b/i.test(home));
  await controlla(P, 'calendario: iniziali dei giorni', () => { vaiA('agendaTool'); vistaAgenda('mese'); });
  await P.evaluate(() => { vaiA('agendaTool'); vistaAgenda('mese'); }); await P.waitForTimeout(400);
  esito('calendario con M T W T F S S', await P.evaluate(() => /M\s*T\s*W\s*T\s*F\s*S\s*S/.test(document.body.innerText)));
  console.log('▶ PDF del preventivo in inglese');
  esito('i testi del PDF si traducono', await P.evaluate(() => { const r = aCapoPdf('Preventivo n. 3', 10, false, 400); return r.join(' ') === 'Quote no. 3'; }));
  await raccogli(P);

  console.log('▶ Di nuovo in italiano, senza ricaricare');
  await P.evaluate(() => { window.__senzaRiavvio = 1; mostraDashboard(); }); await P.waitForTimeout(300);
  await P.evaluate(() => scegliLingua('it')); await P.waitForTimeout(800);
  esito('«Italiano» rimette tutto in italiano subito', await P.evaluate(() => window.__senzaRiavvio === 1 && document.documentElement.lang === 'it' && !inglese() && /Lavori in corso/.test(document.body.innerText) && !/Jobs in progress/.test(document.body.innerText)));
  await P.evaluate(() => scegliLingua('en')); await P.waitForTimeout(800);
  esito('«English» traduce subito', await P.evaluate(() => window.__senzaRiavvio === 1 && inglese() && /Jobs in progress/.test(document.body.innerText)));
  const rimasti = await italiani(P);
  esito('dopo il cambio non resta italiano', !rimasti.length, rimasti.slice(0, 5).join(' | '));
  esito('la scelta resta salvata', await P.evaluate(() => localStorage.getItem('doctorwood_lingua') === 'en'));
  esito('nessun errore in pagina (Titolare)', !P.errori.length, P.errori.join(' | ').slice(0, 300));
  await P.context().close();

  console.log('▶ Laboratorio');
  P = await apri('laboratorio');
  await controlla(P, 'Laboratorio: Home', () => mostraDashboard());
  await controlla(P, 'Laboratorio: schede', () => apriStrumento('schedeTool'));
  await raccogli(P);
  esito('nessun errore in pagina (Laboratorio)', !P.errori.length, P.errori.join(' | ').slice(0, 300));
  await P.context().close();

  console.log('▶ Primo avvio');
  { const ctx = await b.newContext({ ...devices['Pixel 7'], locale: 'en-GB' });
    await ctx.addInitScript(() => { window.__nonTradotti = new Set(); if (!sessionStorage.getItem('__f')) { sessionStorage.setItem('__f', '1'); localStorage.clear(); localStorage.setItem('doctorwood_animazioni', 'no'); } });
    P = await ctx.newPage(); await P.goto(URL); await P.waitForTimeout(1800);
    esito('con il telefono in inglese «Automatica» sceglie l\'inglese', await P.evaluate(() => inglese() && /How do you use this device\?/.test(document.body.innerText)));
    const r = await italiani(P); esito('benvenuto senza italiano', !r.length, r.slice(0, 5).join(' | '));
    await raccogli(P); await ctx.close(); }

  if (process.env.RACCOLTA) {
    const prima = fs.existsSync(process.env.RACCOLTA) ? JSON.parse(fs.readFileSync(process.env.RACCOLTA, 'utf8')) : [];
    fs.writeFileSync(process.env.RACCOLTA, JSON.stringify([...new Set([...prima, ...raccolti])].sort(), null, 1));
  }
  console.log(`\n${ok} riuscite, ${ko} fallite`);
  await b.close();
  process.exit(ko ? 1 : 0);
})();
