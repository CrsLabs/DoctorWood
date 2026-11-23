// Crea i PDF di guida e tutorial di DoctorWood, in italiano e in inglese.
// Uso (dalla cartella del progetto):
//   node guida/genera-guida.js            tutti e quattro
//   node guida/genera-guida.js guida it   (oppure: tutorial it, guida en, tutorial en)
// Prima le schermate: node guida/schermate.js (in guida/img; l'app è solo in italiano, i PDF inglesi usano le stesse schermate).
// L'indice ha i numeri di pagina: un primo PDF serve a vedere in che pagina cade ogni capitolo (i segni «§§id§§»,
// invisibili, si leggono con pdftotext), poi si rifà il PDF con i numeri giusti.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');

const QUI = __dirname;
const gradle = fs.readFileSync(path.join(QUI, '..', 'android', 'app', 'build.gradle'), 'utf8');
const versione = (gradle.match(/versionName "([^"]+)"/) || [])[1] || '?';
const DOC = {
  'guida-it': { file: 'guida.html', pdf: 'DoctorWood-Guida.pdf', piede: "Guida all'uso", pagina: 'pagina', di: 'di' },
  'tutorial-it': { file: 'tutorial.html', pdf: 'DoctorWood-Tutorial.pdf', piede: 'Tutorial', pagina: 'pagina', di: 'di' },
  'guida-en': { file: 'guide-en.html', pdf: 'DoctorWood-Guide-EN.pdf', piede: 'User guide', pagina: 'page', di: 'of' },
  'tutorial-en': { file: 'tutorial-en.html', pdf: 'DoctorWood-Tutorials-EN.pdf', piede: 'Tutorials', pagina: 'page', di: 'of' },
};
const MESI = { it: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] };

async function crea(b, chiave) {
  const d = DOC[chiave], lingua = chiave.slice(-2), oggi = new Date();
  const data = lingua === 'en' ? `${oggi.getDate()} ${MESI.en[oggi.getMonth()]} ${oggi.getFullYear()}` : `${oggi.getDate()} ${MESI.it[oggi.getMonth()]} ${oggi.getFullYear()}`;
  const base = fs.readFileSync(path.join(QUI, d.file), 'utf8').split('{{VERSIONE}}').join(versione).split('{{DATA}}').join(data);
  const tmp = path.join(QUI, '.documento-' + chiave + '.html'), pdfTmp = path.join(QUI, '.documento-' + chiave + '.pdf');
  const stampa = async (html, out) => {
    fs.writeFileSync(tmp, html);
    const p = await b.newPage();
    await p.goto('file://' + tmp); await p.waitForLoadState('load'); await p.emulateMedia({ media: 'print' });
    await p.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<div></div>',
      footerTemplate: `<div style="font-size:8px;color:#94a3b8;width:100%;text-align:center;font-family:sans-serif">DoctorWood ${versione} · ${d.piede} · ${d.pagina} <span class="pageNumber"></span> ${d.di} <span class="totalPages"></span></div>` });
    await p.close();
  };
  // 1° passaggio: dove cade ogni capitolo
  await stampa(base, pdfTmp);
  const testo = execFileSync('pdftotext', ['-layout', pdfTmp, '-'], { encoding: 'utf8' });
  const pagine = {};
  testo.split('\f').forEach((t, i) => { for (const m of t.matchAll(/§§([a-z0-9-]+)§§/g)) if (!(m[1] in pagine)) pagine[m[1]] = i + 1; });
  // 2° passaggio: numeri nell'indice, segni tolti
  let mancano = [];
  const finale = base.replace(/<span class="pag" data-pag="([a-z0-9-]+)">[^<]*<\/span>/g, (m, id) => { if (!(id in pagine)) mancano.push(id); return `<span class="pag">${pagine[id] || ''}</span>`; })
    .replace(/<span class="segno">§§[a-z0-9-]+§§<\/span>/g, '');
  const out = path.join(QUI, d.pdf);
  await stampa(finale, out);
  fs.unlinkSync(tmp); fs.unlinkSync(pdfTmp);
  const n = execFileSync('pdfinfo', [out], { encoding: 'utf8' }).match(/Pages:\s+(\d+)/)[1];
  console.log(`Creato ${d.pdf} (versione ${versione}, ${n} pagine)` + (mancano.length ? ' — pagine non trovate: ' + mancano.join(', ') : ''));
  if (mancano.length) process.exitCode = 1;
}

(async () => {
  const [modo, lingua] = process.argv.slice(2);
  const quali = modo ? [`${modo === 'tutorial' ? 'tutorial' : 'guida'}-${lingua === 'en' ? 'en' : 'it'}`] : Object.keys(DOC);
  const b = await chromium.launch();
  for (const k of quali) await crea(b, k);
  await b.close();
})();
