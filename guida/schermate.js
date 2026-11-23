// Scatta le schermate di DoctorWood per la guida (guida/img/*.png), con dati d'esempio (prove/risultati/dati-realistici.json,
// creato da prove/scenari.js). Uso (dalla cartella DoctorWood):
//   python3 -m http.server 8766 --bind 127.0.0.1 -d . &   poi   node guida/schermate.js   e   node guida/genera-guida.js
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const EN = process.argv.includes('en');   // «node guida/schermate.js en»: app in inglese, dati d'esempio in inglese, schermate in guida/img-en
const OUT = path.join(__dirname, EN ? 'img-en' : 'img'); fs.mkdirSync(OUT, { recursive: true });
const URL = process.argv.slice(2).find(a => /^https?:/.test(a)) || 'http://localhost:8766/sorgente-DoctorWood.html';
// i nomi d'esempio in inglese (solo i testi mostrati, non i codici interni come «montaggio» o «ferramenta»)
const INGLESE = [['Cerniera Blum Clip Top', 'Blum Clip Top hinge'], ['Cucina Rossi - fianchi', 'Smith kitchen - sides'], ['Via Verdi 3, Firenze', '12 Green Street, Bristol'],
  ['Cerniera clip 110°', 'Clip hinge 110°'], ['Cucina su misura', 'Custom kitchen'], ['Montaggio cucina', 'Kitchen installation'], ['Foto precedenti', 'Earlier photos'],
  ['Ante laccate', 'Lacquered doors'], ['Lucia Bianchi', 'Lucy White'], ['Mario Rossi', 'Mark Smith'], ['Rilievo 2', 'Survey 2'], ['lucia@example.it', 'lucy@example.com'],
  ['Via Roma 12, Bergamo', '4 Church Lane, Leeds'], ['Via Verdi 5, Brescia', '9 Mill Road, York'], ['Fianchi e ripiani', 'Sides and shelves'], ['Nobilitato bianco 18 mm', 'White melamine 18 mm'],
  ['Bordo ABS bianco 22 mm', 'White ABS edging 22 mm'], ['Armadio a muro', 'Built-in wardrobe'], ['Maniglia a gola', 'Recessed handle'], ['Rovere 18 mm', 'Oak 18 mm'],
  ['"Fianco', '"Side'], ['"Ripiano', '"Shelf'], ['"Fondo', '"Bottom'], ['"Anta', '"Door'], ['\\"Fianco', '\\"Side'], ['"Ante"', '"Doors"']];
const inglese = x => { if (!EN || x == null) return x; let t = JSON.stringify(x); for (const [a, b] of INGLESE) t = t.split(a).join(b); return JSON.parse(t); };
const dati = inglese(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'prove', 'risultati', 'dati-realistici.json'), 'utf8')));
if (EN) dati.doctorwood_lingua = 'en';
delete dati.doctorwood_pin; delete dati.doctorwood_pin_blocco;
(async () => {
  const b = await chromium.launch();
  const nuova = async (modalita, extra = {}) => {
    const ctx = await b.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 2, locale: EN ? 'en-GB' : 'it-IT', colorScheme: 'light' });
    extra = Object.assign({ doctorwood_docs_chiesto: 'si', doctorwood_blocco_titolare: 'no', ultimoBackup: String(Date.now()) }, extra);
    await ctx.addInitScript(([d, m, e]) => { if (!sessionStorage.getItem('__f')) { sessionStorage.setItem('__f', '1'); localStorage.clear();
      for (const k in d) localStorage.setItem(k, d[k]); localStorage.setItem('doctorwood_modalita', m); for (const k in e) localStorage.setItem(k, e[k]); } }, [dati, modalita, extra]);
    await ctx.addInitScript(() => { window.__nonTradotti = new Set(); });
    const p = await ctx.newPage(); await p.goto(URL); await p.waitForTimeout(2600); return p;
  };
  const foto = async (p, n) => { await p.evaluate(() => { try { nascondiEsito(); } catch (_) {} try { const a = document.getElementById('avvisoBackup'); if (a) a.classList.add('hidden'); } catch (_) {} }); await p.waitForTimeout(500); await p.screenshot({ path: path.join(OUT, n + '.png') }); console.log('  ' + n);
    if (EN) (await p.evaluate(() => [...(window.__nonTradotti || [])])).forEach(t => { if (!mancanti.has(t)) { mancanti.add(t); console.log('    [IT] ' + t.replace(/\n/g, '\\n')); } }); };
  const mancanti = new Set();   // in inglese: i testi rimasti in italiano
  const prova = async (n, f) => { try { await f(); } catch (e) { console.log('  ✗ ' + n + ': ' + e.message.split('\n')[0].slice(0, 120)); } };
  const vai = async (p, v, n) => prova(n, async () => { await p.evaluate(v => vaiA(v), v); await foto(p, n); });
  let p = await nuova('titolare');
  await prova('home', () => foto(p, '01-home'));
  await vai(p, 'photoSurvey', '02-rilievo');
  await vai(p, 'cutOptimizer', '03-taglio');
  await vai(p, 'magazzinoTool', '04-magazzino');
  await vai(p, 'quoteTool', '05-preventivi');
  await vai(p, 'schedeTool', '06-schede');
  await vai(p, 'clientsTool', '07-clienti');
  await vai(p, 'jobsTool', '16-lavori');
  await vai(p, 'agendaTool', '08-agenda');
  await prova('schemi', async () => {
    await p.evaluate(() => { vaiA('cutOptimizer'); apriProgetto(0); calcolaOttimizzazione(); }); await p.waitForTimeout(500);
    await p.evaluate(() => confrontaSchemi()); await foto(p, '14-confronto-schemi'); await p.evaluate(() => chiudiModale('modalSchemi'));
  });
  await prova('firma', async () => {
    await p.evaluate(() => { vaiA('quoteTool'); const q = JSON.parse(localStorage.getItem('preventivi'))[0]; apriPreventivo(q.id); }); await p.waitForTimeout(500);
    await p.evaluate(() => { apriFirmaCliente(); const c = document.getElementById('firmaCanvas'), x = c.getContext('2d'); x.strokeStyle = '#0f172a'; x.lineWidth = 3.2; x.lineCap = 'round'; x.beginPath(); x.moveTo(90, 150); for (let i = 0; i < 60; i++) x.lineTo(90 + i * 8, 130 + 40 * Math.sin(i / 4) * Math.cos(i / 11)); x.stroke(); firmaTracciati = [[[90, 150], [300, 120]]]; });
    await foto(p, '15-firma-cliente'); await p.evaluate(() => chiudiModale('modalFirma'));
  });
  await prova('nuovo-lavoro', async () => { await p.evaluate(() => nuovoDaHome('lavoro')); await foto(p, '09-nuovo-lavoro'); await p.evaluate(() => { chiudiModale('modalGuida'); chiudiFinestraAperta(); }); await p.waitForTimeout(600); });
  await prova('scheda-lavoro', async () => { await p.evaluate(() => { const l = JSON.parse(localStorage.getItem('lavori'))[0]; apriLavoro(l.id); }); await foto(p, '10-scheda-lavoro'); await p.evaluate(() => chiudiFinestraAperta()); });
  await prova('impostazioni', async () => { await p.evaluate(() => apriImpostazioni()); await foto(p, '11-impostazioni'); await p.evaluate(() => chiudiFinestraAperta()); });
  await prova('segnala', async () => { await p.evaluate(() => { document.documentElement.classList.add('con-sostieni'); apriImpostazioni(); }); await p.waitForTimeout(500); await p.evaluate(() => { const e = [...document.querySelectorAll('[data-click="apriSegnalazione()"]')].filter(x => x.offsetParent).pop(); if (e) e.scrollIntoView({ block: 'center' }); }); await foto(p, '17-segnala-sostieni'); await p.evaluate(() => { document.documentElement.classList.remove('con-sostieni'); chiudiFinestraAperta(); }); });
  await prova('aggiornamenti', async () => { await p.evaluate(() => { const c = document.getElementById('catAggiornamenti'); c.classList.remove('hidden'); apriImpostazioni(); document.getElementById('aggStato').textContent = 'È uscita DoctorWood 1.2.0 (9,0 MB).\nNovità: correzioni e piccoli miglioramenti.'; document.getElementById('aggInstalla').classList.remove('hidden'); apriCatImp('aggiornamenti'); }); await p.waitForTimeout(700); await p.evaluate(() => document.getElementById('catAggiornamenti').scrollIntoView({ block: 'start' })); await foto(p, '20-aggiornamenti'); await p.evaluate(() => chiudiFinestraAperta()); });
  await prova('ditta', async () => { await p.evaluate(() => apriModaleDitta()); await foto(p, '12-ditta'); await p.evaluate(() => chiudiFinestraAperta()); });
  // tablet del laboratorio: due lavori d'esempio come arrivano dal file del titolare (niente prezzi né recapiti)
  const g = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const datiLab = JSON.stringify(inglese({ app: 'DoctorWood', formato: 'laboratorio', creato: Date.now(), lavori: [
    { id: 'lv_es1', titolo: 'Cucina su misura', cliente: 'Mario Rossi', indirizzo: 'Via Roma 12, Bergamo', stato: 'produzione', montaggio: { data: g(3), ora: '08:30' },
      tagli: [{ id: 'pr1', nome: 'Fianchi e ripiani', tipo: 'Nobilitato bianco 18 mm', l: 2800, w: 2070, pezzi: [
        { nome: 'Fianco', l: 720, w: 560, qta: 6, mat: 'Nobilitato bianco 18 mm', bL: 1, bW: 0 }, { nome: 'Ripiano', l: 564, w: 540, qta: 6, mat: 'Nobilitato bianco 18 mm', bL: 1, bW: 0 },
        { nome: 'Fondo', l: 564, w: 560, qta: 3, mat: 'Nobilitato bianco 18 mm', bL: 1, bW: 0 }] }],
      materiali: [{ k: 'm1', nome: 'Cerniera clip 110°', qta: 12, unita: 'pz' }, { k: 'm2', nome: 'Bordo ABS bianco 22 mm', qta: 18, unita: 'm' }] },
    { id: 'lv_es2', titolo: 'Armadio a muro', cliente: 'Lucia Bianchi', indirizzo: 'Via Verdi 5, Brescia', stato: 'produzione', montaggio: { data: g(9), ora: '' },
      tagli: [{ id: 'pr2', nome: 'Ante', tipo: 'Rovere 18 mm', l: 2800, w: 2070, pezzi: [{ nome: 'Anta', l: 2200, w: 495, qta: 4, mat: 'Rovere 18 mm', bL: 2, bW: 2 }] }],
      materiali: [{ k: 'm3', nome: 'Maniglia a gola', qta: 4, unita: 'pz' }] }] }));
  await p.context().close();
  p = await nuova('laboratorio', { laboratorio_dati: datiLab });
  await prova('laboratorio', () => foto(p, '13-laboratorio'));
  await p.context().close();
  // primo avvio: la scelta e la domanda «solo laboratorio»
  { const ctx = await b.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 2, locale: EN ? 'en-GB' : 'it-IT', colorScheme: 'light' });
    await ctx.addInitScript(en => { if (!sessionStorage.getItem('__f')) { sessionStorage.setItem('__f', '1'); localStorage.clear(); localStorage.setItem('doctorwood_animazioni', 'no'); if (en) localStorage.setItem('doctorwood_lingua', 'en'); } }, EN);
    p = await ctx.newPage(); await p.goto(URL); await p.waitForTimeout(2000);
    await prova('benvenuto', () => foto(p, '18-benvenuto'));
    await prova('solo-lab', async () => { await p.evaluate(() => document.querySelector('[data-click="scegliIniziale(\'laboratorio\')"]').click()); await p.waitForTimeout(1500); await foto(p, '19-solo-laboratorio'); }); }
  await b.close();
})();
