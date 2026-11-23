// Sincronizzazione titolare ↔ laboratorio in TUTTE le combinazioni, solo dall'interfaccia:
//   modo: diretta (PairWood) | cartella (Syncthing/Drive)  ×  tablet: 1 | 2  ×  chi comincia: titolare | tablet
// In ogni combinazione: abbinamento, lavori verso i tablet, spunte verso il titolare (da ogni tablet), riavvio
// dell'app su tutti i dispositivi a metà e di nuovo andata e ritorno. Nessun errore in pagina.
// PairWood e la cartella condivisa sono simulati in Node (la cartella come se Syncthing fosse istantaneo).
// Uso: node prove/combinazioni.js [http://localhost:8765/index.html]
const { chromium, devices } = require('playwright');
// il codice si scrive a mano: se c'è la scelta «Inquadra il QR / Scrivi il codice», prima «Scrivi il codice»
async function scriviCodice(P, cod) {
  await P.waitForTimeout(150);
  if (!(await P.locator('#cassaPw1').isVisible()) && /Scrivi il codice/.test(await P.locator('#cassaAlt').textContent())) { await P.locator('#cassaAlt').click(); await P.waitForTimeout(300); }
  await P.locator('#cassaPw1').fill(cod);
}
const URL = process.argv[2] || 'http://localhost:8765/index.html';

const MOCK = `(() => {
  const ok = v => Promise.resolve(v || {});
  window.__ascolto = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    addListener: (pl, ev, cb) => { if (pl === 'PairWood' && ev === 'evento') __ascolto.push(cb); return { remove() {} }; },
    nativePromise: (pl, m, o) => {
      if (pl === 'PairWood' || ['scegliCartella', 'verificaCartella', 'elencoCartella', 'leggiFile', 'scriviFile', 'eliminaFile', 'dimenticaCartella'].includes(m))
        return window.__nat(pl, m, o || {}).then(r => r && r.errore ? Promise.reject(Object.assign(new Error(r.errore), { code: 'X' })) : r.v);
      if (m === 'stato') return ok({ biometria: 'pronta', chiave: false });
      if (m === 'puoSbloccare') return ok({ ok: false });
      if (m === 'frequenze') return ok({ massima: 120, attuale: 60 });
      if (m === 'statoFissaggio') return ok({ fissata: false });
      if (m === 'custodisci') return ok({ iv: 'AAAA', dati: o.dati });
      if (m === 'riprendi') return ok({ dati: o.dati });
      return ok({});
    } };
  window.__evento = e => __ascolto.forEach(f => { try { f(e); } catch (_) {} });
})();`;

async function combinazione(b, modo, nTablet, primoTablet) {
  const nome = `${modo} · ${nTablet} tablet · comincia ${primoTablet ? 'il tablet' : 'il titolare'}`;
  console.log('▶ ' + nome);
  let ok = 0, ko = 0;
  const esito = (n, c, info = '') => { if (c) ok++; else ko++; if (!c) console.log('  ✗ ' + n + (info ? ' — ' + info : '')); };
  const errori = [];
  let orologio = Date.now();
  const cartella = {};   // la cartella condivisa (modo cartella)
  const disp = {};
  const evento = (d, e) => d.pagina && d.pagina.evaluate(e => window.__evento(e), e).catch(() => {});
  function giro(da) {
    let ric = 0, rag = 0;
    for (const x of Object.values(disp)) {
      if (x === da || !da.fidati.has(x.nome) || !x.fidati.has(da.nome) || !x.avviato) continue;
      rag++;
      for (const p of new Set([...Object.keys(da.file), ...Object.keys(x.file)])) {
        const a = da.file[p], c = x.file[p];
        if (a && (!c || a.m > c.m)) { x.file[p] = { ...a }; evento(x, { tipo: 'ricevuti', dispositivo: da.nome, quanti: 1 }); }
        else if (c && (!a || c.m > a.m)) { da.file[p] = { ...c }; ric++; evento(da, { tipo: 'ricevuti', dispositivo: x.nome, quanti: 1 }); }
      }
    }
    evento(da, { tipo: 'sincronizzato', raggiunti: rag, abbinati: da.fidati.size, ricevuti: ric });
    return ric;
  }
  async function nativo(d, pl, m, o) {
    if (pl !== 'PairWood') switch (m) {   // la cartella condivisa
      case 'scegliCartella': return { v: { uri: 'content://prova/DoctorWood', nome: 'DoctorWood' } };
      case 'verificaCartella': return { v: { ok: true } };
      case 'elencoCartella': return { v: { file: Object.entries(cartella).filter(([n]) => n.startsWith(o.prefisso || '')).map(([n, f]) => ({ nome: n, modificato: f.m, dimensione: f.t.length })) } };
      case 'leggiFile': return { v: cartella[o.nome] ? { esiste: true, testo: cartella[o.nome].t } : { esiste: false } };
      case 'scriviFile': cartella[o.nome] = { t: o.testo, m: ++orologio }; return { v: {} };
      case 'eliminaFile': delete cartella[o.nome]; return { v: {} };
      default: return { v: {} };
    }
    if (m !== 'avvia' && m !== 'cancellaTutto' && !d.avviato) return { errore: 'PairWood non è avviato' };
    switch (m) {
      case 'avvia': d.avviato = true; return { v: { avviato: true } };
      case 'stato': return { v: { avviato: true, id: d.nome, dispositivi: [...d.fidati].map(n => ({ id: n, nome: n, ultimoContatto: Date.now() })), permessoRete: 'ok', ascolto: { attivo: !!d.ascolto } } };
      case 'accettaAbbinamento': d.accetta = o.codice; return { v: {} };
      case 'abbina': {
        const x = Object.values(disp).find(y => y !== d && y.avviato && y.accetta);
        if (!x) return { errore: 'Nessun dispositivo trovato: apri l\'app sull\'altro dispositivo, nella stessa Wi‑Fi, e attiva lì l\'abbinamento.' };
        if (x.accetta !== o.codice) return { errore: 'Codice di abbinamento sbagliato.' };
        x.accetta = null; d.fidati.add(x.nome); x.fidati.add(d.nome); evento(x, { tipo: 'abbinato', dispositivo: d.nome }); giro(d);
        return { v: { nome: x.nome } };
      }
      case 'sincronizza': return { v: { ricevuti: giro(d) } };
      case 'scrivi': d.file[o.percorso] = { t: o.testo, m: ++orologio }; setTimeout(() => giro(d), 300); return { v: {} };
      case 'leggi': { const f = d.file[o.percorso]; return { v: f ? { esiste: true, testo: f.t, modificato: f.m, dimensione: f.t.length } : { esiste: false } }; }
      case 'elenco': return { v: { file: Object.entries(d.file).filter(([p]) => p.startsWith(o.prefisso || '')).map(([p, f]) => ({ percorso: p, modificato: f.m, dimensione: f.t.length })) } };
      case 'ascoltoContinuo': d.ascolto = o.attivo !== false; return { v: { attivo: d.ascolto } };
      case 'statoBatteria': return { v: { risparmioAttivo: false } };
      case 'cancellaTutto': Object.assign(d, { avviato: false, file: {}, fidati: new Set(), accetta: null }); return { v: {} };
      default: return { v: {} };
    }
  }
  async function apri(chiave, dev, modalita) {
    const d = disp[chiave] = { nome: chiave, avviato: false, file: {}, fidati: new Set(), accetta: null, pagina: null };
    const ctx = await b.newContext({ locale: 'it-IT', ...devices[dev] });
    await ctx.addInitScript(MOCK);
    await ctx.addInitScript(a => { if (!sessionStorage.getItem('__fatto')) { localStorage.clear(); for (const k in a) localStorage.setItem(k, a[k]); sessionStorage.setItem('__fatto', '1'); } },
      { doctorwood_modalita: modalita, doctorwood_blocco_titolare: 'no', doctorwood_docs_chiesto: 'si' });   // la proposta della cartella dei documenti ha la sua prova (file.js)
    await ctx.exposeFunction('__nat', (pl, m, o) => nativo(d, pl, m, o));
    const p = await ctx.newPage();
    p.on('pageerror', e => errori.push(chiave + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' || /Content Security|Refused/.test(m.text())) errori.push(chiave + ' console: ' + m.text().slice(0, 160)); });
    await p.goto(URL); await p.waitForTimeout(1300);
    d.pagina = p;
    return p;
  }
  const tocca = async (p, sel, t = 350) => { await p.locator(sel).filter({ visible: true }).first().click(); await p.waitForTimeout(t); };
  const finestra = p => p.locator('#modalCassaforte:not(.hidden)').waitFor({ timeout: 8000 });
  const LS = (p, k) => p.evaluate(k => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } }, k);
  const errore = p => p.locator('#cassaErrore:not(.hidden)').textContent({ timeout: 15000 }).catch(() => '');
  // chiude le finestre aperte con «Annulla»/«Chiudi» (o con l'unico tasto, se è l'unico)
  const chiudiFinestre = async p => {
    for (let i = 0; i < 4 && await p.locator('#modalCassaforte:not(.hidden)').count(); i++)
      await tocca(p, (await p.locator('#cassaNo:visible').count()) ? '#cassaNo' : '#cassaSi', 400);
  };

  const T = await apri('Titolare', 'Pixel 7', 'titolare');
  const tablet = [];
  for (let i = 1; i <= nTablet; i++) tablet.push(await apri('Laboratorio' + i, i === 1 ? 'Galaxy Tab S4' : 'Pixel 7', 'laboratorio'));
  let codice = '';

  async function attivaTitolare() {
    await T.evaluate(() => apriImpostazioni());
    await T.waitForTimeout(400);
    if (await T.locator('#catCorpo_laboratorio.hidden').count()) await tocca(T, `[data-click="apriCatImp('laboratorio')"]`, 400);
    await T.locator('#impSinc').scrollIntoViewIfNeeded();
    await tocca(T, '#impSinc'); await finestra(T);
    await tocca(T, modo === 'diretta' ? '#cassaSi' : '#cassaAlt', 300);
    if (modo === 'cartella') { await finestra(T); await tocca(T, '#cassaSi', 300); }
    await T.locator('#cassaEvidenza:not(.hidden)').waitFor({ timeout: 20000 });
    codice = (await T.locator('#cassaEvidenza').textContent()).replace(/-/g, '');
    await tocca(T, '#cassaSi', 1200);
    await T.evaluate(() => { for (let i = 0; i < 6 && chiudiFinestraAperta(); i++); });
  }
  async function collegaTablet(L, cod, atteso) {
    await L.locator('#labSinc button').waitFor({ timeout: 6000 });
    await tocca(L, '#labSinc button'); await finestra(L);
    await tocca(L, modo === 'diretta' ? '#cassaSi' : '#cassaAlt', 300);
    if (modo === 'cartella') { await finestra(L); await tocca(L, '#cassaSi', 300); await finestra(L); }
    await scriviCodice(L, cod);
    await tocca(L, '#cassaSi', 300);
    if (atteso === 'errore') return errore(L);
    await L.locator('#modalCassaforte').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
    await chiudiFinestre(L);
    await L.waitForTimeout(800);
    return '';
  }
  const leggiStato = p => LS(p, 'doctorwood_sincronia_stato').then(s => s || {});
  const sincronizzaTitolare = async () => { await T.evaluate(() => document.getElementById('impSincOra').click()); await T.waitForTimeout(2200); };

  try {
    if (primoTablet) {
      // il tablet prova prima che il titolare abbia attivato: errore chiaro, niente di rotto
      const e = await collegaTablet(tablet[0], 'ABCD-EFGH-JKMN-PQRS-TVWX', 'errore');
      esito('tablet per primo: errore chiaro', modo === 'diretta' ? /Nessun dispositivo/.test(e) : /Il file dei lavori non è ancora|controlla il codice|apre/.test(e) || e === '', e);
      await chiudiFinestre(tablet[0]);
      if (modo === 'cartella' && !(await LS(tablet[0], 'doctorwood_sincronia'))) esito('tablet per primo: niente configurazione a metà', true);
      // (con la cartella vuota il tablet si collega comunque: il file dei lavori arriverà; si scollega per ricominciare pulito)
      if (await LS(tablet[0], 'doctorwood_sincronia')) await tablet[0].evaluate(() => { localStorage.removeItem('doctorwood_sincronia'); localStorage.removeItem('doctorwood_sincronia_stato'); });
    }
    await attivaTitolare();
    esito('codice mostrato', /^[0-9A-Z]{20}$/.test(codice));
    for (let i = 0; i < nTablet; i++) {
      if (modo === 'diretta' && i > 0) {
        // un secondo tablet senza riaprire l'abbinamento: rifiutato; poi «Codice di abbinamento» lo riapre
        const e = await collegaTablet(tablet[i], codice, 'errore');
        esito('secondo tablet: serve riaprire l\'abbinamento', /Nessun dispositivo/.test(e), e);
        await chiudiFinestre(tablet[i]);
        await T.evaluate(() => document.getElementById('impSincCodice').click()); await finestra(T); await tocca(T, '#cassaSi', 400);
      }
      await collegaTablet(tablet[i], codice);
      const conf = await LS(tablet[i], 'doctorwood_sincronia');
      esito(`tablet ${i + 1} collegato`, conf && conf.tipo === (modo === 'diretta' ? 'pairwood' : 'cartella'), JSON.stringify(conf && conf.tipo));
    }
    const giroCompleto = async (fase) => {
      // lavori: il titolare scrive, ogni tablet li riceve (con la cartella si legge al prossimo controllo: lo si forza)
      const prima = await Promise.all(tablet.map(leggiStato));
      await sincronizzaTitolare();
      for (const [i, L] of tablet.entries()) {
        if (modo === 'cartella') { await tocca(L, '#labSinc button'); await finestra(L); await tocca(L, '#cassaSi', 1200); await chiudiFinestre(L); }
        else await L.waitForTimeout(600);
        const st = await leggiStato(L);
        esito(`${fase}: tablet ${i + 1} riceve i lavori`, st.ricevuto > (prima[i].ricevuto || 0) && !st.errore, st.errore || '');
        esito(`${fase}: tablet ${i + 1} ha fissato la firma del titolare`, !!st.chiaveTitolare);
      }
      // spunte: ogni tablet ne fa una; il titolare le vede tutte
      for (const [i, L] of tablet.entries()) await L.evaluate(id => spuntaLab(id, 'pronto'), 'lavoro-' + fase + '-' + i);
      await T.waitForTimeout(5500);
      await sincronizzaTitolare();
      const stT = await leggiStato(T);
      const visti = Object.keys(stT.visti || {}).filter(n => n.startsWith('doctorwood-avanzamento-'));
      esito(`${fase}: il titolare legge le spunte di tutti i tablet`, visti.length === nTablet && !stT.errore, `${visti.length} file · ${stT.errore || ''}`);
    };
    await giroCompleto('prima del riavvio');
    // riavvio dell'app su tutti i dispositivi: la sincronizzazione riparte da sola, con gli stessi abbinamenti
    for (const p of [T, ...tablet]) { await p.reload(); }
    await T.waitForTimeout(3500);
    await giroCompleto('dopo il riavvio');
    if (modo === 'cartella' && nTablet === 1 && !primoTablet) {
      // un file di un tablet con un altro codice (vecchio, o tablet configurato male): segnalato una volta, poi una nota
      cartella['doctorwood-avanzamento-orfano.dwsync'] = { t: JSON.stringify({ app: 'DoctorWood', formato: 'sincronia', versione: 1, tipo: 'avanzamento', iv: 'AAAAAAAAAAAAAAAA', dati: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }), m: ++orologio };
      await T.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await T.waitForTimeout(2500);
      const s1 = await leggiStato(T);
      esito('file illeggibile: segnalato', /un tablet usa un codice diverso/.test(s1.errore || ''), s1.errore || '');
      await T.waitForTimeout(500); await T.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await T.waitForTimeout(2500);
      const s2 = await leggiStato(T);
      esito('poi non si ripete a ogni giro', !s2.errore, s2.errore || '');
      const sotto = await T.locator('#impSincSotto').textContent();
      esito('resta una nota nello stato', /1 file di un tablet non si apre/.test(sotto), sotto);
      delete cartella['doctorwood-avanzamento-orfano.dwsync'];
      await T.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await T.waitForTimeout(2500);
      esito('tolto il file, sparisce anche la nota', !/non si apre/.test(await T.locator('#impSincSotto').textContent()));
    }
    esito('nessun errore in pagina', errori.length === 0, errori.slice(0, 2).join(' | '));
  } catch (e) {
    const dove = (e.stack || '').split('\n').filter(l => l.includes('combinazioni.js:')).map(l => l.split('combinazioni.js:')[1]).join(' < ');
    ko++; console.log('  ✗ ERRORE: ' + e.message.split('\n')[0].slice(0, 200) + ' @ ' + dove);
  }
  for (const p of [T, ...tablet]) await p.context().close().catch(() => {});
  console.log(`  ${ok} riuscite, ${ko} fallite`);
  return { nome, ok, ko };
}

(async () => {
  const b = await chromium.launch();
  const risultati = [];
  for (const modo of ['diretta', 'cartella'])
    for (const n of [1, 2])
      for (const primoTablet of [false, true]) {
        // SOLO=diretta,2,true per provarne una sola
        if (process.env.SOLO && process.env.SOLO !== [modo, n, primoTablet].join(',')) continue;
        risultati.push(await combinazione(b, modo, n, primoTablet));
      }
  await b.close();
  const tot = risultati.reduce((a, r) => ({ ok: a.ok + r.ok, ko: a.ko + r.ko }), { ok: 0, ko: 0 });
  console.log(`\nCombinazioni: ${risultati.length} · ${tot.ok} controlli riusciti, ${tot.ko} falliti`);
  process.exit(tot.ko ? 1 : 0);
})();
