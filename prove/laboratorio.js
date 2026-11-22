// «Manda al laboratorio», lavorazione in calendario, preventivo in gruppi
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
  await ctx.addInitScript(() => { if (localStorage.getItem('x_seed')) return; localStorage.setItem('x_seed', '1');
    localStorage.setItem('doctorwood_modalita', 'titolare'); localStorage.setItem('doctorwood_animazioni', 'no');
    localStorage.setItem('doctorwood_clients', JSON.stringify([{ id: 'c1', name: 'Mario Rossi', address: 'Via Roma 1' }]));
    localStorage.setItem('lavori', JSON.stringify([{ id: 'lv1', clienteId: 'c1', titolo: 'Cucina', creato: 1, ts: 1 }])); });
  const p = await ctx.newPage(); const err = []; p.on('pageerror', e => err.push(e.message));
  let ok = 0, ko = 0; const t = (n, c) => { (c ? ok++ : ko++); console.log((c ? '  ✓ ' : '  ✗ ') + n); };
  await p.goto('http://127.0.0.1:8766/sorgente-DoctorWood.html'); await p.waitForTimeout(800);
  await p.evaluate(() => { window.chiedi = async () => true; });
  t('lavoro nuovo: non è nel laboratorio', await p.evaluate(() => !analizzaLavoro(leggiLavori()[0]).inLab && datiLabDaLavori().lavori.length === 0));
  await p.evaluate(() => apriLavoro('lv1')); await p.waitForTimeout(300);
  t('c\'è il tasto «Manda al laboratorio»', await p.evaluate(() => /Manda al laboratorio/.test(document.getElementById('lavInviaLab').textContent)));
  await p.evaluate(() => document.querySelector('#lavInviaLab [data-click="mandaAlLab"]').click()); await p.waitForTimeout(400);
  t('dopo il tasto è nel laboratorio e nei dati per il tablet', await p.evaluate(() => analizzaLavoro(leggiLavori()[0]).inLab && datiLabDaLavori().lavori.length === 1 && datiLabDaLavori().lavori[0].stato === 'produrre'));
  t('compare «Togli dal laboratorio»', await p.evaluate(() => /Togli dal laboratorio/.test(document.getElementById('lavInviaLab').textContent)));
  await p.evaluate(() => document.querySelector('#lavInviaLab [data-click="togliDalLab"]').click()); await p.waitForTimeout(400);
  t('«Togli» lo toglie', await p.evaluate(() => !analizzaLavoro(leggiLavori()[0]).inLab && datiLabDaLavori().lavori.length === 0));
  // se la domanda riceve «no», non cambia niente
  await p.evaluate(() => { window.chiedi = async () => false; });
  await p.evaluate(() => document.querySelector('#lavInviaLab [data-click="mandaAlLab"]').click()); await p.waitForTimeout(300);
  t('rispondendo «no» resta fuori', await p.evaluate(() => !analizzaLavoro(leggiLavori()[0]).inLab));
  await p.evaluate(() => { window.chiedi = async () => true; });
  // calendario
  await p.evaluate(() => document.querySelector('#lavInviaLab [data-click="apriProgrammaLav"]').click());
  t('si apre «Programma la lavorazione»', await p.evaluate(() => !document.getElementById('modalProgrammaLav').classList.contains('hidden')));
  await p.evaluate(() => { document.getElementById('plGiorno').value = '2026-11-20'; document.getElementById('plGiorni').value = '3'; aggiornaProgrammaLav(); });
  t('anteprima: 20, 23, 24 (salta il fine settimana)', await p.evaluate(() => JSON.stringify(giorniProgramma()) === JSON.stringify(['2026-11-20', '2026-11-23', '2026-11-24'])));
  await p.evaluate(() => { document.getElementById('plSalta').checked = false; aggiornaProgrammaLav(); });
  t('senza salto: 20, 21, 22', await p.evaluate(() => giorniProgramma().join() === '2026-11-20,2026-11-21,2026-11-22'));
  await p.evaluate(() => { document.getElementById('plSalta').checked = true; salvaProgrammaLav(); }); await p.waitForTimeout(300);
  const ap = await p.evaluate(() => leggiAppuntamenti().filter(a => a.tipo === 'lavorazione'));
  t('3 giorni in agenda, tutto il giorno, collegati al lavoro', ap.length === 3 && ap.every(a => a.lavoroId === 'lv1' && a.ora === '' && a.clienteId === 'c1'));
  t('la finestra si chiude', await p.evaluate(() => document.getElementById('modalProgrammaLav').classList.contains('hidden')));
  t('il lavoro non cambia stato per le lavorazioni', await p.evaluate(() => analizzaLavoro(leggiLavori()[0]).stato === 'nuovo'));
  await p.evaluate(() => { apriProgrammaLav(); document.getElementById('plGiorno').value = '2026-11-20'; document.getElementById('plGiorni').value = '3'; salvaProgrammaLav(); }); await p.waitForTimeout(300);
  t('ripetere gli stessi giorni non li raddoppia', await p.evaluate(() => leggiAppuntamenti().filter(a => a.tipo === 'lavorazione').length === 3));
  await p.evaluate(() => { apriProgrammaLav(); document.getElementById('plGiorni').value = ''; salvaProgrammaLav(); });
  t('senza giorni: errore e resta aperta', await p.evaluate(() => !document.getElementById('plErrore').classList.contains('hidden') && !document.getElementById('modalProgrammaLav').classList.contains('hidden')));
  await p.evaluate(() => chiudiProgrammaLav());
  t('il tipo «Lavorazione» è nel modulo appuntamento e ha nome e colore', await p.evaluate(() => !!document.querySelector('#appTipi [data-tipo=lavorazione]') && TIPI_APP.lavorazione.breve === 'Lavorazione'));
  t('il tipo resta dopo l\'importazione (non diventa «altro»)', await p.evaluate(() => { const x = leggiAppuntamenti().filter(a => a.tipo === 'lavorazione'); return x.length === 3; }));
  // preventivo in gruppi
  await p.evaluate(() => { chiudiModale('modalLavoro'); mostraStrumento && mostraStrumento('quote'); }).catch(() => {});
  await p.evaluate(() => { const v = document.getElementById('viewQuote'); document.querySelectorAll('[id^=view]').forEach(x => { if (x.id !== 'viewQuote' && x.parentElement === v.parentElement) x.classList.add('hidden'); }); v.classList.remove('hidden'); });
  const g = await p.evaluate(() => { const bt = [...document.querySelectorAll('#viewQuote .no-print > .w-full.grid button[data-click]')]; return { n: bt.length, senzaSpiegazione: bt.filter(x => !x.parentElement.querySelector('p')).length, piccoli: bt.filter(x => { const r = x.getBoundingClientRect(); return r.height < 40; }).length, testi: [...document.querySelectorAll('#viewQuote .grid > div > div > p.font-bold')].map(x => x.textContent) }; });
  t('8 pulsanti (senza Stampa), ognuno con la sua spiegazione', g.n === 8 && g.senzaSpiegazione === 0);
  t('4 gruppi con titolo', g.testi.length === 4);
  t('tasti non piccoli', g.piccoli === 0);
  await p.screenshot({ path: process.env.TMPDIR ? process.env.TMPDIR + '/prev.png' : '/tmp/prev.png', fullPage: false });
  t('nessun errore in pagina', err.length === 0); if (err.length) console.log(err);
  console.log(`${ok}/${ok + ko}`); await b.close(); process.exit(ko ? 1 : 0);
})();
