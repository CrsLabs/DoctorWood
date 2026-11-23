// Prova di iniezione: ogni campo dei dati contiene HTML; si aprono tutte le sezioni e si cercano elementi iniettati.
const { rispondiDomande, impostaDomande, leggiDomande } = require('./domande');
const { chromium } = require('playwright');
const P = `x"'><b data-pwn="1">PWN</b><button data-click="esportaBackup()" data-pwn="2">`;
const campi = ['id', 'name', 'nome', 'titolo', 'title', 'l', 'w', 'qta', 'n', 'numero', 'durata', 'data', 'ora', 'prezzo', 'nPagine', 'cliente', 'lavoro',
  'address', 'phone', 'email', 'note', 'notes', 'descr', 'desc', 'indirizzo', 'tipo', 'stato', 'codice', 'fornitore', 'unita', 'categoria', 'sottocategoria',
  'materiale', 'mat', 'sheetTipo', 'sheetL', 'sheetW', 'date', 'clienteId', 'lavoroId', 'preventivoId', 'statoData', 'quantita', 'colore', 'testo', 'motivo'];
const veleno = (extra = {}) => Object.assign(Object.fromEntries(campi.map(k => [k, P])), extra);
const voce = () => veleno({ qta: P, prezzo: P });
const DATI = {
  doctorwood_clients: [veleno({ id: 'c1', projects: [veleno({ id: 'pc1' })] })],
  lavori: [veleno({ id: 'l1', clienteId: 'c1', fasi: [veleno()], materiali: [veleno()], pagamenti: [veleno()] })],
  preventivi: [veleno({ id: 'q1', voci: [voce(), voce()], clienteId: 'c1', lavoroId: 'l1', n: P, registro: [veleno()] })],
  projects: [veleno({ id: 'p1', pezzi: [veleno(), veleno()] })],
  magazzino: [veleno({ id: 'a1', categoria: 'pannelli' }), veleno({ id: 'a2', categoria: 'ferramenta' })],
  avanzi: [veleno({ id: 'av1' })],
  appuntamenti: [veleno({ id: 'ap1', data: new Date().toISOString().slice(0, 10), clienteId: 'c1' })],
  schede: [veleno({ id: 's1', titolo: P, categoria: P, nPagine: P, clienteId: 'c1' })],
  schede_categorie: [P, 'Altro'],
  rilievi_elenco: [veleno({ id: 'r1' })],
  ditta: veleno(),
  doctorwood_modalita: 'titolare',
};
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ locale: 'it-IT', viewport: { width: 412, height: 860 } });
  await ctx.addInitScript(() => {
    window.__pwn = new Set();
    const guarda = () => document.querySelectorAll('[data-pwn]').forEach(e => window.__pwn.add(e.getAttribute('data-pwn') + ' in #' + (e.closest('[id]') || {}).id));
    new MutationObserver(guarda).observe(document, { childList: true, subtree: true });
  });
  const p = await ctx.newPage();
  const errori = [];
  p.on('pageerror', e => errori.push(e.message.slice(0, 120)));
  p.on('dialog', d => d.dismiss());
  await rispondiDomande(p, { accetta: false });
  await p.goto(process.argv[2]);
  await p.evaluate(D => { localStorage.clear(); for (const [k, v] of Object.entries(D)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }, DATI);
  await p.reload(); await p.waitForTimeout(1000);
  const passi = [
    'mostraDashboard()', "apriStrumento('cutOptimizer')", "cambiaSchedaTaglio('panels')", "cambiaSchedaTaglio('projects')", 'apriProgettoDaArchivio(0)',
    "apriStrumento('quoteTool')", "apriPreventivo('q1')", "apriStrumento('clientsTool')", "apriDettaglioCliente('c1')", "vaiA('jobsTool')", "apriLavoro('l1')",
    "apriStrumento('agendaTool')", "apriAppuntamento('ap1')", "apriStrumento('magazzinoTool')", "apriStrumento('schedeTool')", "apriDettaglioScheda('s1')",
    "apriStrumento('photoSurvey')", 'apriImpostazioni()', 'apriModaleDitta()', 'mostraVerificaDati()', 'apriStatoDati()',
  ];
  for (const s of passi) {
    try { await p.evaluate(s); } catch (e) { errori.push(s + ': ' + e.message.slice(0, 100)); }
    await p.waitForTimeout(250);
    try { await p.evaluate(() => document.querySelectorAll('[id^=modal]:not(.hidden)').forEach(m => m.classList.add('hidden'))); } catch (_) {}
  }
  // stampa del preventivo e laboratorio
  try { await p.evaluate("apriStrumento('quoteTool'); apriPreventivo('q1'); window.dispatchEvent(new Event('beforeprint'))"); } catch (e) { errori.push('stampa: ' + e.message.slice(0, 100)); }
  await p.waitForTimeout(300);
  await p.evaluate(() => { localStorage.setItem('doctorwood_modalita', 'laboratorio'); });
  await p.reload(); await p.waitForTimeout(1000);
  try { await p.evaluate("apriLavoroLab('l1')"); } catch (e) { errori.push('lab: ' + e.message.slice(0, 100)); }
  await p.waitForTimeout(300);
  console.log('Elementi iniettati trovati:', [...await p.evaluate(() => [...window.__pwn])]);
  console.log('Errori:', errori);
  await b.close();
})();
