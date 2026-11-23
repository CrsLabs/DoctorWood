const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ locale: 'it-IT', viewport: { width: 390, height: 800 } });
  await ctx.addInitScript(() => { localStorage.setItem('doctorwood_modalita', 'titolare'); localStorage.setItem('doctorwood_animazioni', 'no'); });
  const p = await ctx.newPage(); const err = []; p.on('pageerror', e => err.push(e.message));
  let ok = 0, ko = 0; const t = (n, c) => { (c ? ok++ : ko++); console.log((c ? '  ✓ ' : '  ✗ ') + n); };
  await p.goto('http://127.0.0.1:8766/sorgente-DoctorWood.html'); await p.waitForTimeout(800);
  const v = await p.evaluate(() => ({
    iban: [ibanValido('IT60X0542811101000000123456'), ibanValido('IT60 X054 2811 1010 0000 0123 457'), ibanValido('abc')],
    piva: [pivaValida('12345678903'), pivaValida('12345678904'), pivaValida('00000000000'), pivaValida('IT12345678903')],
    cf: [cfValido('RSSMRA85T10A562S'), cfValido('RSSMRA85T10A562X'), cfValido('12345678903'), cfValido('xxxxxxxxxxxxxxxx')],
    em: [emailValida('a@b.it'), emailValida('a@b'), emailValida('prova')], tel: [telefonoValido('+39 333 1234567'), telefonoValido('abc'), telefonoValido('12')] }));
  t('IBAN', v.iban[0] && !v.iban[1] && !v.iban[2]); t('P.IVA', v.piva[0] && !v.piva[1] && !v.piva[2] && v.piva[3]);
  t('CF', v.cf[0] && !v.cf[1] && v.cf[2] && !v.cf[3]); t('email', v.em[0] && !v.em[1] && !v.em[2]); t('telefono', v.tel[0] && !v.tel[1] && !v.tel[2]);
  // ditta con dati finti non si salva
  await p.evaluate(() => { apriModaleDitta(); const s = (i, x) => document.getElementById(i).value = x; s('dittaNome', 'X'); s('dittaIndirizzo', 'via'); s('dittaPiva', '11111111111'); s('dittaCf', 'abc'); s('dittaTel', '333123456'); s('dittaEmail', 'a@b.it'); s('dittaIban', 'IT00'); s('dittaValidita', '30'); s('dittaCondizioni', 'c'); salvaModaleDitta(); });
  t('ditta con dati finti NON salvata', await p.evaluate(() => !leggiDitta().nome));
  await p.evaluate(() => { const s = (i, x) => document.getElementById(i).value = x; s('dittaPiva', '12345678903'); s('dittaCf', 'RSSMRA85T10A562S'); s('dittaIban', 'IT60X0542811101000000123456'); salvaModaleDitta(); });
  t('ditta con dati veri salvata', await p.evaluate(() => leggiDitta().nome === 'X'));
  // guida: conferma all'uscita
  let domande = 0; await p.exposeFunction('__q', () => { domande++; });
  await p.evaluate(() => { window.chiedi = async () => { window.__q(); return false; }; });
  await p.evaluate(() => nuovoDaHome('lavoro')); await p.waitForTimeout(300);
  await p.fill('#gNuovoCliente', 'Mario Rossi');
  await p.evaluate(() => document.getElementById('guidaIndietroBtn').click()); await p.waitForTimeout(200);
  t('uscire con qualcosa scritto chiede conferma e resta', domande === 1 && await p.evaluate(() => !document.getElementById('modalGuida').classList.contains('hidden')));
  await p.evaluate(() => { window.chiedi = async () => true; });
  // sequenza rilievo → preventivo → taglio
  await p.evaluate(() => document.getElementById('guidaAvantiBtn').click()); await p.waitForTimeout(300);
  await p.fill('#gTitolo', 'Cucina'); await p.evaluate(() => document.getElementById('guidaAvantiBtn').click()); await p.waitForTimeout(300);
  await p.evaluate(() => { guidaScegli('preventivo'); guidaScegli('taglio'); });
  t('due scelte insieme', await p.evaluate(() => GUIDA.dati.scelte.join() === 'preventivo,taglio'));
  await p.evaluate(() => document.getElementById('guidaAvantiBtn').click()); await p.waitForTimeout(900);
  t('si apre il preventivo per primo', await p.evaluate(() => vistaCorrente === 'quoteTool' && SEQ && SEQ.resto.join() === 'taglio'));
  await p.evaluate(() => { document.getElementById('quoteItemsContainer').innerHTML = ''; aggiungiRigaVocePersonalizzata('Voce', 1, 100, ''); ricalcolaPreventivo(); });
  await p.evaluate(() => salvaPreventivo()); await p.waitForTimeout(1500);
  t('dopo il salvataggio passa al taglio', await p.evaluate(() => vistaCorrente === 'cutOptimizer'));
  // uscire da Preventivi già salvato: campi vuoti
  await p.evaluate(() => { vaiA('quoteTool'); }); await p.waitForTimeout(400);
  await p.evaluate(() => { document.getElementById('quoteProject').value = 'Prova'; document.getElementById('quoteClient').value = 'Anna'; aggiungiVocePreventivo(); salvaPreventivo(); }); await p.waitForTimeout(800);
  await p.evaluate(() => { vaiA('clientsTool'); }); await p.waitForTimeout(500);
  await p.evaluate(() => { vaiA('quoteTool'); }); await p.waitForTimeout(500);
  t('preventivo finito: tornando i campi sono vuoti', await p.evaluate(() => !document.getElementById('quoteProject').value && !document.getElementById('quoteClient').value));
  console.log(`\nCorrezioni: ${ok} riusciti, ${ko} falliti`, err);
  process.exit(ko || err.length ? 1 : 0);
})();
