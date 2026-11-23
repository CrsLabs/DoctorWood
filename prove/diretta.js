// Sincronizzazione DIRETTA (PairWood) tra due dispositivi simulati: telefono del titolare e tablet del laboratorio.
// Ogni dispositivo è una pagina dell'app Android (www/index.html) con il ponte di Capacitor simulato.
// PairWood è simulato qui in Node: una «rete» che copia i file tra le due cartelle private e manda gli eventi
// (ricevuti, abbinato, sincronizzato), come fa il modulo nativo. Si prova tutto dall'interfaccia, con tocchi veri.
// Il motore vero (TLS, abbinamento, blocchi) ha le sue prove nel progetto «sincronia» (gradle :motore:test).
// Uso: node prove/diretta.js [http://localhost:8765/index.html]
const { chromium, devices } = require('playwright');
// il codice si scrive a mano: se c'è la scelta «Inquadra il QR / Scrivi il codice», prima «Scrivi il codice»
async function scriviCodice(P, cod) {
  await P.waitForTimeout(150);
  if (!(await P.locator('#cassaPw1').isVisible()) && /Scrivi il codice/.test(await P.locator('#cassaAlt').textContent())) { await P.locator('#cassaAlt').click(); await P.waitForTimeout(300); }
  await P.locator('#cassaPw1').fill(cod);
}
const path = require('path');
const fs = require('fs');
const D = path.join(__dirname, 'risultati') + '/';
fs.mkdirSync(D, { recursive: true });
const URL = process.argv[2] || 'http://localhost:8765/index.html';

const MOCK = `(() => {
  const ok = v => Promise.resolve(v || {});
  window.__nativo = []; window.__ascolto = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    addListener: (pl, ev, cb) => { if (pl === 'PairWood' && ev === 'evento') __ascolto.push(cb); return { remove() {} }; },
    nativePromise: (pl, m, o) => {
      __nativo.push(pl + '.' + m);
      if (pl === 'PairWood') return window.__pw(m, o || {}).then(r => r && r.errore ? Promise.reject(Object.assign(new Error(r.errore), { code: 'NON_RIUSCITO' })) : r.v);
      if (m === 'stato') return ok({ biometria: 'pronta', chiave: false });
      if (m === 'puoSbloccare') return ok({ ok: false });
      if (m === 'frequenze') return ok({ massima: 120, attuale: 60 });
      if (m === 'statoFissaggio') return ok({ fissata: false });
      if (m === 'custodisci') return ok({ iv: 'AAAA', dati: o.dati });
      if (m === 'riprendi') return ok({ dati: o.dati });
      if (m === 'cancellaTutto') return Promise.reject(Object.assign(new Error('bloccato nella prova'), { code: 'PROVA' }));
      return ok({});
    } };
  window.__evento = e => __ascolto.forEach(f => { try { f(e); } catch (_) {} });
})();`;

// ---------- PairWood simulato ----------
const nuovoDisp = nome => ({ nome, avviato: false, file: {}, fidati: new Set(), accetta: null, pagina: null, chiamate: [], contatti: {}, ascolto: null, risparmio: true });
const statoAscolto = d => d.ascolto ? { attivo: true, descrizione: d.ascolto.descr, giorni: d.ascolto.giorni, inizio: d.ascolto.inizio, fine: d.ascolto.fine, dentro: true } : { attivo: false };
const disp = { T: nuovoDisp('Titolare'), L: nuovoDisp('Laboratorio'), X: nuovoDisp('Estraneo') };
const evento = (d, e) => d.pagina && d.pagina.evaluate(e => window.__evento(e), e).catch(() => {});
const PERCORSO_OK = p => typeof p === 'string' && p.length > 0 && p.length < 1024 && !p.startsWith('/') && !p.split('/').some(x => !x || x === '.' || x === '..') && !p.startsWith('.sincronia');
// allinea due dispositivi abbinati: vince il file più recente; risponde con quanti file ha ricevuto ciascuno
function allinea(a, b) {
  const n = { [a.nome]: 0, [b.nome]: 0 };
  for (const p of new Set([...Object.keys(a.file), ...Object.keys(b.file)])) {
    const fa = a.file[p], fb = b.file[p];
    if (fa && (!fb || fa.modificato > fb.modificato)) { b.file[p] = { ...fa }; n[b.nome]++; }
    else if (fb && (!fa || fb.modificato > fa.modificato)) { a.file[p] = { ...fb }; n[a.nome]++; }
  }
  return n;
}
function giro(da) {
  let ricevuti = 0, raggiunti = 0;
  for (const altro of Object.values(disp)) {
    if (altro === da || !da.fidati.has(altro.nome) || !altro.fidati.has(da.nome) || !altro.avviato) continue;
    raggiunti++;
    da.contatti[altro.nome] = altro.contatti[da.nome] = Date.now();
    const n = allinea(da, altro);
    ricevuti += n[da.nome];
    if (n[altro.nome]) evento(altro, { tipo: 'ricevuti', dispositivo: da.nome, quanti: n[altro.nome] });
    if (n[da.nome]) evento(da, { tipo: 'ricevuti', dispositivo: altro.nome, quanti: n[da.nome] });
  }
  evento(da, { tipo: 'sincronizzato', raggiunti, abbinati: da.fidati.size, ricevuti });
  return ricevuti;
}
let orologio = Date.now();
async function pairwood(d, m, o) {
  d.chiamate.push(m);
  const st = () => ({ avviato: true, acceso: true, id: d.nome.toUpperCase(), dispositivi: [...d.fidati].map(n => ({ id: n, nome: n, ultimoContatto: d.contatti[n] || 0 })), permessoRete: 'ok', ascolto: statoAscolto(d) });
  if (m !== 'avvia' && m !== 'cancellaTutto' && !d.avviato) return { errore: 'PairWood non è avviato: chiama prima avvia().' };
  switch (m) {
    case 'avvia': d.avviato = true; return { v: st() };
    case 'stato': return { v: st() };
    case 'accettaAbbinamento': if (!/^[0-9A-Z]{20}$/.test(o.codice)) return { errore: 'codice non valido' }; d.accetta = o.codice; return { v: {} };
    case 'abbina': {
      const altro = Object.values(disp).find(x => x !== d && x.avviato && x.accetta);
      if (!altro) return { errore: 'Nessun dispositivo nuovo trovato: apri l\'app sull\'altro dispositivo, nella stessa Wi‑Fi, e attiva lì l\'abbinamento.' };
      if (altro.accetta !== o.codice) return { errore: 'Codice di abbinamento sbagliato.' };
      altro.accetta = null; d.fidati.add(altro.nome); altro.fidati.add(d.nome);
      evento(altro, { tipo: 'abbinato', dispositivo: d.nome });
      giro(d);
      return { v: { nome: altro.nome } };
    }
    case 'sincronizza': return { v: { ricevuti: giro(d) } };
    case 'scrivi': {
      if (!PERCORSO_OK(o.percorso)) return { errore: 'percorso non valido' };
      d.file[o.percorso] = { testo: o.testo, modificato: ++orologio, dimensione: o.testo.length };
      if (o.sincronizza !== false) setTimeout(() => giro(d), 300);   // come cambiato(): poco dopo, da solo
      return { v: { dimensione: o.testo.length, modificato: orologio } };
    }
    case 'leggi': { if (!PERCORSO_OK(o.percorso)) return { errore: 'percorso non valido' }; const f = d.file[o.percorso]; return { v: f ? { esiste: true, ...f } : { esiste: false } }; }
    case 'elenco': return { v: { file: Object.entries(d.file).filter(([p]) => p.startsWith(o.prefisso || '')).map(([p, f]) => ({ percorso: p, dimensione: f.dimensione, modificato: f.modificato })) } };
    case 'elimina': { const c = !!d.file[o.percorso]; delete d.file[o.percorso]; return { v: { eliminato: c } }; }
    case 'cancellaTutto': Object.assign(d, { avviato: false, file: {}, fidati: new Set(), accetta: null, ascolto: null }); return { v: {} };   // gli altri non lo sanno
    case 'ascoltoContinuo': {
      if (o.attivo === false) { d.ascolto = null; return { v: statoAscolto(d) }; }
      if (!Array.isArray(o.giorni) || !o.giorni.length || !/^\d\d:\d\d$/.test(o.inizio) || !/^\d\d:\d\d$/.test(o.fine)) return { errore: 'orario non valido' };
      const N = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
      d.ascolto = { giorni: o.giorni, inizio: o.inizio, fine: o.fine, titolo: o.titolo, descr: o.giorni.map(g => N[g - 1]).join(',') + ' ' + o.inizio + '–' + o.fine };
      return { v: statoAscolto(d) };
    }
    case 'chiediNotifiche': return { v: { concesso: true } };
    case 'qr': return { v: { righe: Array.from({ length: 21 }, (_, y) => Array.from({ length: 21 }, (_, x) => (x * y + x) % 3 ? '0' : '1').join('')) } };
    case 'scansionaQr': return { v: d.qrLetto ? { codice: d.qrLetto } : { annullato: true } };
    case 'statoBatteria': return { v: { risparmioAttivo: d.risparmio } };
    case 'apriRisparmioEnergetico': d.risparmio = false; return { v: {} };
    case 'dimentica': d.fidati.delete(o.id); return { v: {} };
    default: return { errore: 'comando sconosciuto: ' + m };
  }
}

(async () => {
  const b = await chromium.launch();
  let ok = 0, ko = 0;
  const esito = (nome, cond, info = '') => { if (cond) ok++; else ko++; console.log((cond ? '  ✓ ' : '  ✗ ') + nome + (info ? ' — ' + info : '')); };
  const errori = [];
  async function apri(chiave, dev, archivio) {
    const d = disp[chiave];
    const ctx = await b.newContext({ locale: 'it-IT', ...devices[dev] });
    await ctx.addInitScript(MOCK);
    await ctx.addInitScript(a => { if (!sessionStorage.getItem('__fatto')) { localStorage.clear(); for (const k in a) localStorage.setItem(k, a[k]); sessionStorage.setItem('__fatto', '1'); } }, archivio);
    await ctx.exposeFunction('__pw', (m, o) => pairwood(d, m, o));
    const p = await ctx.newPage();
    p.on('pageerror', e => errori.push(d.nome + ' pagina: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' || /Content Security|Refused/.test(m.text())) errori.push(d.nome + ' console: ' + m.text().slice(0, 200)); });
    await p.goto(URL); await p.waitForTimeout(1500);
    d.pagina = p;
    return p;
  }
  const passo = async (nome, p, fn) => { console.log('▶ ' + nome); try { await fn(); } catch (e) { ko++; console.log('  ✗ ERRORE: ' + e.message.split('\n')[0].slice(0, 220)); await p.screenshot({ path: D + 'diretta-' + nome.replace(/\W+/g, '_') + '.png' }).catch(() => {}); } };
  const finestraAperta = p => p.locator('#modalCassaforte:not(.hidden)').waitFor({ timeout: 8000 });
  const testoFinestra = p => p.locator('#cassaTesto').textContent();
  const tocca = async (p, sel, attesa = 400) => { await p.locator(sel).filter({ visible: true }).first().click(); await p.waitForTimeout(attesa); };
  const LS = (p, k) => p.evaluate(k => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } }, k);
  const avviso = p => p.locator('#avvisoGuardiaTesto').textContent().catch(() => '');

  const T = await apri('T', 'Pixel 7', { doctorwood_modalita: 'titolare', doctorwood_blocco_titolare: 'no' });
  const L = await apri('L', 'Galaxy Tab S4', { doctorwood_modalita: 'laboratorio' });
  let codice = '';

  await passo('Titolare: attiva la sincronizzazione diretta', T, async () => {
    await T.evaluate(() => apriImpostazioni && apriImpostazioni());
    await T.waitForTimeout(500);
    await T.evaluate(() => { const c = document.getElementById('catCorpo_laboratorio'); if (c && c.classList.contains('hidden')) document.querySelector('[data-click*="laboratorio"][data-click*="Cat"], [data-click*="toggleCat"][data-click*="laboratorio"]')?.click(); });
    await T.locator('#impSinc').scrollIntoViewIfNeeded();
    await tocca(T, '#impSinc');
    await finestraAperta(T);
    esito('si chiede come sincronizzare', /Diretta \(consigliata\)/.test(await testoFinestra(T)));
    esito('due scelte: diretta e cartella', (await T.locator('#cassaSi').textContent()) === 'Diretta (Wi‑Fi)' && (await T.locator('#cassaAlt').textContent()) === 'Con una cartella');
    await tocca(T, '#cassaSi', 300);
    await T.locator('#cassaEvidenza:not(.hidden)').waitFor({ timeout: 15000 });   // PBKDF2 600.000 giri: qualche secondo
    codice = (await T.locator('#cassaEvidenza').textContent()).replace(/-/g, '');
    esito('codice di 20 caratteri', /^[0-9A-HJKMNP-TV-Z]{20}$/.test(codice), codice.slice(0, 4) + '…');
    esito('il codice si vede anche come QR', await T.locator('#cassaQr:not(.hidden) svg path').count() === 1);
    esito('PairWood avviato e abbinamento aperto', disp.T.avviato && disp.T.accetta === codice);
    esito('il codice non è salvato in chiaro', !JSON.stringify(await T.evaluate(() => ({ ...localStorage }))).includes(codice));
    const conf = await LS(T, 'doctorwood_sincronia');
    esito('configurazione «pairwood», senza cartella', conf && conf.tipo === 'pairwood' && !conf.uri);
    await tocca(T, '#cassaSi', 800);
    esito('il file dei lavori è già nella cartella di PairWood', !!disp.T.file['doctorwood-laboratorio.dwsync']);
    const f = disp.T.file['doctorwood-laboratorio.dwsync'];
    esito('file cifrato (nessun dato leggibile)', f && JSON.parse(f.testo).formato === 'sincronia' && !/lavori|segreto/.test(JSON.parse(f.testo).dati));
  });

  await passo('Laboratorio: codice sbagliato', L, async () => {
    await L.locator('#labSinc button').waitFor({ timeout: 5000 });
    await tocca(L, '#labSinc button');
    await finestraAperta(L);
    await tocca(L, '#cassaSi', 300);   // Diretta
    await L.waitForTimeout(200);
    esito('il tablet propone prima di inquadrare il QR', (await L.locator('#cassaSi').textContent()) === 'Inquadra il QR' && (await L.locator('#cassaAlt').textContent()) === 'Scrivi il codice');
    await scriviCodice(L, 'AAAA-BBBB-CCCC-DDDD-EEEE');
    await tocca(L, '#cassaSi', 300);
    await L.locator('#cassaErrore:not(.hidden)').waitFor({ timeout: 15000 });
    esito('errore chiaro con codice sbagliato', /sbagliato/.test(await L.locator('#cassaErrore').textContent()), await L.locator('#cassaErrore').textContent());
    esito('non abbinato', !disp.L.fidati.has('Titolare') && !disp.T.fidati.has('Laboratorio'));
    esito('abbinamento ancora aperto sul titolare', disp.T.accetta === codice);
    esito('niente configurazione salvata', !(await LS(L, 'doctorwood_sincronia')));
  });

  await passo('Laboratorio: codice giusto (con trattini e minuscole)', L, async () => {
    await L.locator('#cassaPw1').fill(''); await L.locator('#cassaPw1').pressSequentially(codice.toLowerCase(), { delay: 5 });
    esito('i trattini si mettono da soli, in maiuscolo', (await L.locator('#cassaPw1').inputValue()) === codice.match(/.{4}/g).join('-'), await L.locator('#cassaPw1').inputValue());
    await tocca(L, '#cassaSi', 300);
    await L.locator('#cassaTitolo', { hasText: 'Batteria' }).waitFor({ timeout: 20000 });
    esito('il tablet chiede di escluderlo dal risparmio energetico', /Non ottimizzare/.test(await testoFinestra(L)));
    await tocca(L, '#cassaSi', 300);
    esito('apre le impostazioni della batteria', disp.L.chiamate.includes('apriRisparmioEnergetico'));
    await L.locator('#modalCassaforte').waitFor({ state: 'hidden', timeout: 5000 });
    await L.waitForTimeout(1500);
    esito('tablet sempre in ascolto, lun-sab 07:00-19:00', disp.L.ascolto && disp.L.ascolto.giorni.join() === '1,2,3,4,5,6' && disp.L.ascolto.inizio === '07:00' && disp.L.ascolto.fine === '19:00', JSON.stringify(disp.L.ascolto));
    esito('notifica fissa intestata a DoctorWood', disp.L.ascolto && /DoctorWood/.test(disp.L.ascolto.titolo));
    esito('il titolare non è messo in ascolto continuo', !disp.T.ascolto);
    esito('abbinati nei due sensi', disp.L.fidati.has('Titolare') && disp.T.fidati.has('Laboratorio'));
    esito('codice valido una volta sola (abbinamento chiuso)', disp.T.accetta === null);
    esito('avviso «Collegato»', /Collegato a «Titolare»/.test(await avviso(L)), await avviso(L));
    const dati = await LS(L, 'laboratorio_dati');
    esito('lavori del titolare arrivati e decifrati', dati && Array.isArray(dati.lavori));
    const conf = await LS(L, 'doctorwood_sincronia');
    esito('configurazione «pairwood» sul tablet', conf && conf.tipo === 'pairwood' && !conf.codice);
    await T.waitForTimeout(800);
    esito('il titolare vede «Abbinato con Laboratorio»', /Abbinato con «Laboratorio»/.test(await avviso(T)), await avviso(T));
  });

  await passo('Laboratorio → titolare: le spunte arrivano da sole', L, async () => {
    const primaT = (await LS(T, 'doctorwood_sincronia_stato') || {}).ricevuto || 0;
    await L.evaluate(() => spuntaLab('lavoro-prova', 'pronto'));
    await L.waitForTimeout(6000);   // la pagina scrive dopo ~4 s, PairWood spedisce subito dopo
    const mio = Object.keys(disp.L.file).find(p => p.startsWith('doctorwood-avanzamento-'));
    esito('il tablet ha scritto il suo file', !!mio);
    esito('il file è arrivato al titolare', !!(mio && disp.T.file[mio]));
    await T.waitForTimeout(1500);
    const st = await LS(T, 'doctorwood_sincronia_stato') || {};
    esito('il titolare l\'ha letto senza toccare niente', st.ricevuto > primaT && st.visti && mio in st.visti, JSON.stringify(st.errore || ''));
  });

  await passo('Titolare → laboratorio: lavori aggiornati da soli', T, async () => {
    const primaL = (await LS(L, 'doctorwood_sincronia_stato') || {}).ricevuto || 0;
    await T.evaluate(() => document.getElementById('impSincOra').click());
    await T.waitForTimeout(2500);
    esito('«Sincronizza ora» passa da PairWood', disp.T.chiamate.includes('sincronizza'));
    const st = await LS(L, 'doctorwood_sincronia_stato') || {};
    esito('il tablet ha ricevuto i lavori senza toccare niente', st.ricevuto > primaL, JSON.stringify(st.errore || ''));
    const sotto = await T.locator('#impSincSotto').textContent();
    esito('stato leggibile nelle Impostazioni', /Diretta Wi‑Fi · 1 di 1 raggiungibili/.test(sotto), sotto);
  });

  await passo('Tablet manomesso: file dei lavori falso (cifrato bene, ma non firmato dal titolare)', L, async () => {
    const nodeCrypto = require('crypto');
    const K = nodeCrypto.pbkdf2Sync('doctorwood-sincronia:' + codice, 'doctorwood-sincronia-1', 600000, 32, 'sha256');
    const falso = { app: 'DoctorWood', formato: 'laboratorio', creato: Date.now() + 10 * 86400000, segreto: 'f'.repeat(32),
      lavori: [{ id: 'falso', titolo: 'LAVORO FALSO', cliente: 'x', stato: 'produzione', tagli: [], materiali: [] }] };
    const busta = () => {
      const iv = nodeCrypto.randomBytes(12), c = nodeCrypto.createCipheriv('aes-256-gcm', K, iv);
      c.setAAD(Buffer.from('doctorwood-sincronia-1|laboratorio'));
      const dati = Buffer.concat([c.update(JSON.stringify(falso)), c.final(), c.getAuthTag()]);
      return { app: 'DoctorWood', formato: 'sincronia', versione: 1, tipo: 'laboratorio', iv: iv.toString('base64'), dati: dati.toString('base64') };
    };
    const confT = await LS(T, 'doctorwood_sincronia');
    esito('il titolare ha una chiave di firma', !!(confT && confT.firmaPub && confT.firmaPriv && !/PRIVATE/.test(JSON.stringify(confT))));
    const vero = JSON.parse(disp.T.file['doctorwood-laboratorio.dwsync'].testo);
    esito('il file vero è firmato', typeof vero.firma === 'string' && vero.chiave === confT.firmaPub);
    esito('il tablet ha fissato la chiave del titolare', ((await LS(L, 'doctorwood_sincronia_stato')) || {}).chiaveTitolare === confT.firmaPub);
    const primaL = JSON.stringify(await LS(L, 'laboratorio_dati'));
    const arriva = async testo => {
      disp.L.file['doctorwood-laboratorio.dwsync'] = { testo, modificato: ++orologio, dimensione: testo.length };
      await evento(disp.L, { tipo: 'ricevuti', dispositivo: 'Titolare', quanti: 1 });
      await L.waitForTimeout(1500);
    };
    // 1) senza firma
    await arriva(JSON.stringify(busta()));
    let st = await LS(L, 'doctorwood_sincronia_stato') || {};
    esito('file senza firma scartato', JSON.stringify(await LS(L, 'laboratorio_dati')) === primaL && /NON firmato.*senza firma/.test(st.errore || ''), st.errore || '');
    // 2) firmato con un'altra chiave (quella del tablet manomesso)
    const kp = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }), b = busta();
    b.firma = nodeCrypto.sign('sha256', Buffer.from('doctorwood-firma-1|' + b.tipo + '|' + b.iv + '|' + b.dati), { key: kp.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
    b.chiave = kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    await arriva(JSON.stringify(b));
    st = await LS(L, 'doctorwood_sincronia_stato') || {};
    esito('file firmato da un altro scartato', JSON.stringify(await LS(L, 'laboratorio_dati')) === primaL && /firma sbagliata/.test(st.errore || ''), st.errore || '');
    esito('segreto di sblocco non cambiato', (await LS(L, 'laboratorio_dati') || {}).segreto !== 'f'.repeat(32));
    // 3) il titolare riscrive il suo file (vede che è stato toccato da altri) e il tablet lo accetta di nuovo
    const primaR = st.ricevuto || 0;
    await T.evaluate(() => document.getElementById('impSincOra').click()); await T.waitForTimeout(2500);
    await L.waitForTimeout(1000);
    st = await LS(L, 'doctorwood_sincronia_stato') || {};
    esito('gli aggiornamenti veri del titolare passano ancora', st.ricevuto > primaR && !st.errore, st.errore || '');
  });

  await passo('Un estraneo con il codice vecchio non entra', T, async () => {
    const X = await apri('X', 'Pixel 7', { doctorwood_modalita: 'laboratorio' });
    await X.locator('#labSinc button').waitFor({ timeout: 5000 });
    await tocca(X, '#labSinc button'); await finestraAperta(X); await tocca(X, '#cassaSi', 300);
    await scriviCodice(X, codice);
    await tocca(X, '#cassaSi', 300);
    await X.locator('#cassaErrore:not(.hidden)').waitFor({ timeout: 15000 });
    esito('rifiutato: l\'abbinamento non è aperto', /Nessun dispositivo nuovo/.test(await X.locator('#cassaErrore').textContent()));
    esito('nessun file all\'estraneo', Object.keys(disp.X.file).length === 0);
    await X.context().close(); disp.X.pagina = null;
  });

  await passo('Titolare: «Codice di abbinamento» riapre l\'abbinamento per un altro tablet', T, async () => {
    await T.evaluate(() => document.getElementById('impSincCodice').click());
    await finestraAperta(T);
    esito('stesso codice', (await T.locator('#cassaEvidenza').textContent()).replace(/-/g, '') === codice);
    esito('abbinamento riaperto', disp.T.accetta === codice);
    esito('spiega i 10 minuti', /10 minuti/.test(await testoFinestra(T)));
    await tocca(T, '#cassaSi');
  });

  await passo('Laboratorio: orario di lavoro', L, async () => {
    await tocca(L, '#labSinc button'); await finestraAperta(L);
    esito('lo stato dice «sempre in ascolto»', /sempre in ascolto/.test(await testoFinestra(L)), (await testoFinestra(L)).slice(0, 120));
    await tocca(L, '#cassaAlt', 300); await finestraAperta(L);
    await tocca(L, '#cassaSi', 300); await finestraAperta(L);
    esito('finestra dell\'orario', (await L.locator('#cassaTitolo').textContent()) === 'Orario di lavoro');
    await L.locator('#cassaPw1').fill('boh');
    await tocca(L, '#cassaSi', 300);
    esito('orario sbagliato: spiega come scriverlo', /Non ho capito/.test(await L.locator('#cassaErrore').textContent()));
    await L.locator('#cassaPw1').fill('Lun, mer, ven 8 - 12.30');
    await tocca(L, '#cassaSi', 600);
    esito('orario nuovo salvato', disp.L.ascolto && disp.L.ascolto.giorni.join() === '1,3,5' && disp.L.ascolto.inizio === '08:00' && disp.L.ascolto.fine === '12:30', JSON.stringify(disp.L.ascolto));
    esito('niente seconda richiesta della batteria (già esclusa)', !(await L.locator('#modalCassaforte:not(.hidden)').count()));
    // spegnere
    await tocca(L, '#labSinc button'); await finestraAperta(L); await tocca(L, '#cassaAlt', 300); await finestraAperta(L); await tocca(L, '#cassaSi', 300); await finestraAperta(L);
    await tocca(L, '#cassaAlt', 600);
    esito('ascolto continuo spento', !disp.L.ascolto);
  });

  await passo('Laboratorio: scollega', L, async () => {
    await tocca(L, '#labSinc button'); await finestraAperta(L);
    await tocca(L, '#cassaAlt', 300); await finestraAperta(L);
    await tocca(L, '#cassaAlt', 300); await finestraAperta(L);
    esito('spiega cosa succede', /dimentica gli abbinamenti/.test(await testoFinestra(L)));
    await tocca(L, '#cassaSi', 800);
    esito('PairWood cancellato sul tablet (anche l\'ascolto continuo)', disp.L.chiamate.includes('cancellaTutto') && !disp.L.avviato && disp.L.fidati.size === 0 && !disp.L.ascolto);
    esito('configurazione tolta', !(await LS(L, 'doctorwood_sincronia')));
    const prima = Object.keys(disp.L.file).length;
    await T.evaluate(() => document.getElementById('impSincOra').click()); await T.waitForTimeout(2000);
    esito('il titolare non gli manda più niente', Object.keys(disp.L.file).length === prima);
    const sotto = await T.locator('#impSincSotto').textContent();
    esito('il titolare vede «nessuno raggiungibile»', /nessuno raggiungibile ora/.test(sotto), sotto);
  });

  await passo('Titolare: dispositivi abbinati e «Dimentica»', T, async () => {
    await T.evaluate(() => document.getElementById('impSincDisp').click());
    await finestraAperta(T);
    esito('elenca il tablet con l\'ultimo contatto', /Laboratorio .*ultimo contatto/.test(await testoFinestra(T)), (await testoFinestra(T)).split('\n')[0]);
    await tocca(T, '#cassaSi', 300); await finestraAperta(T);
    esito('spiega cosa fare se è rubato', /perso o rubato/.test(await testoFinestra(T)));
    await tocca(T, '#cassaSi', 600);
    esito('tablet dimenticato', !disp.T.fidati.has('Laboratorio'));
  });

  let nuovo = '';
  await passo('Titolare: «Cambia codice» (tablet perso)', T, async () => {
    disp.T.fidati.add('Laboratorio'); disp.L.fidati.add('Titolare');   // come se il tablet fosse ancora abbinato
    const fileLab = disp.T.file['doctorwood-laboratorio.dwsync'].testo;
    await T.evaluate(() => document.getElementById('impSincNuovo').click());
    await finestraAperta(T);
    esito('spiega a cosa serve', /perso o rubato/.test(await testoFinestra(T)));
    await tocca(T, '#cassaSi', 300);
    await T.locator('#cassaEvidenza:not(.hidden)').waitFor({ timeout: 20000 });
    nuovo = (await T.locator('#cassaEvidenza').textContent()).replace(/-/g, '');
    esito('codice nuovo, diverso dal vecchio', /^[0-9A-Z]{20}$/.test(nuovo) && nuovo !== codice);
    esito('tutti i dispositivi dimenticati', disp.T.fidati.size === 0);
    esito('abbinamento aperto con il codice nuovo', disp.T.accetta === nuovo);
    esito('file dei lavori riscritto con la chiave nuova', disp.T.file['doctorwood-laboratorio.dwsync'].testo !== fileLab);
    esito('il codice nuovo non è in chiaro', !JSON.stringify(await T.evaluate(() => ({ ...localStorage }))).includes(nuovo));
    await tocca(T, '#cassaSi', 500);
    const st = await LS(T, 'doctorwood_sincronia_stato') || {};
    esito('nessun errore per i file vecchi dei tablet', !st.errore, st.errore || '');
  });

  await passo('Tablet: si ricollega solo con il codice nuovo', L, async () => {
    disp.L.fidati.clear();
    await L.reload(); await L.waitForTimeout(1500);   // dopo «Scollega»: di nuovo «Collega la sincronizzazione»
    await L.locator('#labSinc button').waitFor({ timeout: 5000 });
    await tocca(L, '#labSinc button'); await finestraAperta(L); await tocca(L, '#cassaSi', 300);
    await scriviCodice(L, codice);
    await tocca(L, '#cassaSi', 300);
    await L.locator('#cassaErrore:not(.hidden)').waitFor({ timeout: 15000 });
    esito('il codice vecchio non vale più', /sbagliato/.test(await L.locator('#cassaErrore').textContent()));
    await scriviCodice(L, nuovo);
    await tocca(L, '#cassaSi', 300);
    await L.locator('#modalCassaforte').waitFor({ state: 'hidden', timeout: 20000 });
    await L.waitForTimeout(1500);
    esito('riabbinati', disp.L.fidati.has('Titolare') && disp.T.fidati.has('Laboratorio'));
    const st = await LS(L, 'doctorwood_sincronia_stato') || {};
    esito('i lavori si aprono con la chiave nuova', !st.errore && st.ricevuto > 0, st.errore || '');
  });

  await passo('Titolare: avviso se un tablet non si sente da giorni', T, async () => {
    disp.L.avviato = false;                                   // tablet spento
    disp.T.contatti.Laboratorio = Date.now() - 3 * 86400000;  // ultimo contatto: 3 giorni fa
    await T.evaluate(() => document.getElementById('impSincOra').click()); await T.waitForTimeout(2000);
    const sotto = await T.locator('#impSincSotto').textContent();
    esito('«non si sente da 3 giorni»', /«Laboratorio» non si sente da 3 giorni/.test(sotto), sotto);
  });

  await passo('Nessun accesso alla rete dalla pagina', T, async () => {
    const csp = await T.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content);
    esito('CSP: connect-src \'none\'', /connect-src 'none'/.test(csp));
    const r = await T.evaluate(() => fetch('https://example.com').then(() => 'aperta', () => 'bloccata'));
    esito('fetch bloccato', r === 'bloccata');
    errori.splice(0, errori.length, ...errori.filter(e => !/example\.com|connect-src/.test(e)));   // il rifiuto voluto qui sopra
  });

  esito('nessun errore in pagina', errori.length === 0, errori.slice(0, 3).join(' | '));
  console.log(`\nDiretta: ${ok} riuscite, ${ko} fallite`);
  await b.close();
  process.exit(ko ? 1 : 0);
})();
