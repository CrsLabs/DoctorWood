// Date e ore nello stile dell'app: al posto dei campi di Android c'è un pulsante che apre il calendario (o l'orario) dal basso.
// Uso: node prove/calendario.js   (server 8766 sulla cartella DoctorWood)
const { chromium, devices } = require('playwright');
const URL = process.env.URL_WEB || 'http://127.0.0.1:8766/sorgente-DoctorWood.html';
let ok = 0, ko = 0; const t = (n, c, x = '') => { (c ? ok++ : ko++); console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? ' — ' + x : '')); };
(async () => {
  const b = await chromium.launch();
  for (const lingua of ['it', 'en']) {
    console.log('▶ ' + (lingua === 'it' ? 'Italiano' : 'English'));
    const ctx = await b.newContext({ ...devices['Pixel 7'], locale: 'it-IT' });
    await ctx.addInitScript(l => { if (sessionStorage.getItem('__f')) return; sessionStorage.setItem('__f', 1); localStorage.clear(); localStorage.setItem('doctorwood_modalita', 'titolare'); localStorage.setItem('doctorwood_animazioni', 'no'); localStorage.setItem('doctorwood_lingua', l); }, lingua);
    const p = await ctx.newPage(); const err = []; p.on('pageerror', e => err.push(e.message));
    await p.goto(URL); await p.waitForTimeout(1500);
    await p.evaluate(() => nuovoDaHome('appuntamento')); await p.waitForTimeout(500);
    const btnData = p.locator('#appData + button.tendina-btn'), btnOra = p.locator('#appOra + button.tendina-btn');
    t('al posto del campo data c\'è il pulsante del calendario', await btnData.isVisible() && !(await p.locator('#appData').isVisible()));
    t('anche per l\'ora', await btnOra.isVisible() && !(await p.locator('#appOra').isVisible()));
    await btnData.click(); await p.waitForTimeout(300);
    t('si apre il calendario dell\'app', await p.locator('#modalCalendario').isVisible());
    t('sei righe di giorni + intestazione', await p.locator('#calCorpo .cal-griglia > *').count() === 49);
    const sett = await p.locator('#calCorpo .cal-sett').allTextContents();
    t('iniziali dei giorni nella lingua giusta', sett.join('') === (lingua === 'it' ? 'LMMGVSD' : 'MTWTFSS'), sett.join(''));
    t('«Conferma» spento finché non si sceglie', await p.locator('#calConferma').isDisabled());
    await p.locator('#calCorpo [data-cal="1"]').click(); await p.waitForTimeout(150);
    await p.locator('#calCorpo [data-giorno$="-15"]').click(); await p.waitForTimeout(150);
    const giorno15 = await p.locator('#calCorpo [aria-pressed="true"]').getAttribute('data-giorno');
    await p.locator('#calConferma').click(); await p.waitForTimeout(300);
    t('scelto il 15 del mese dopo: il valore del campo è quello', await p.evaluate(() => document.getElementById('appData').value) === giorno15, giorno15);
    const testo = await btnData.textContent();
    t('il pulsante mostra la data scritta per esteso', /15/.test(testo) && (lingua === 'it' ? /[a-z]{3} 15 [a-z]{3} \d{4}/.test(testo) : /(Mon|Tue|Wed|Thu|Fri|Sat|Sun) 15 [A-Z][a-z]{2} \d{4}/.test(testo)), testo);
    // l'anno: toccando il mese
    await btnData.click(); await p.waitForTimeout(200);
    await p.locator('#calCorpo [data-cal="anni"]').click(); await p.waitForTimeout(150);
    t('toccando il mese si sceglie l\'anno', await p.locator('#calCorpo .cal-anni').isVisible());
    await p.evaluate(() => chiudiFinestraAperta()); await p.waitForTimeout(200);
    t('Indietro chiude il calendario e lascia aperto l\'appuntamento', !(await p.locator('#modalCalendario').isVisible()) && await p.locator('#modalFormApp').isVisible());
    // l'ora
    await btnOra.click(); await p.waitForTimeout(200);
    t('per l\'ora: 24 ore e minuti a passi di 5', await p.locator('#calCorpo [data-ora]').count() === 24 && await p.locator('#calCorpo [data-min]').count() === 12);
    t('l\'ora è in grande al centro e il tasto «Conferma» è già pronto', /^\d\d:\d\d$/.test(await p.locator('#calLettura').textContent()) && !(await p.locator('#calConferma').isDisabled()));
    await p.evaluate(() => { document.getElementById('calRuotaOre').scrollTo({ top: 14 * 48 }); document.getElementById('calRuotaMin').scrollTo({ top: 9 * 48 }); }); await p.waitForTimeout(600);
    t('scorrendo le due ruote l\'ora cambia (14:45)', (await p.locator('#calLettura').textContent()) === '14:45', await p.locator('#calLettura').textContent());
    await p.locator('#calCorpo [data-ora="10"]').click(); await p.locator('#calCorpo [data-min="30"]').click(); await p.locator('#calConferma').click(); await p.waitForTimeout(300);
    t('ora 10:30 nel campo e sul pulsante', await p.evaluate(() => document.getElementById('appOra').value) === '10:30' && /10:30/.test(await btnOra.textContent()));
    // il valore messo dal codice si vede sul pulsante
    await p.evaluate(() => { document.getElementById('appData').value = '2027-03-01'; }); await p.waitForTimeout(100);
    t('un valore messo dall\'app si vede subito sul pulsante', /2027/.test(await btnData.textContent()), await btnData.textContent());
    // «Senza data»
    await btnData.click(); await p.waitForTimeout(200); await p.locator('#calCancella').click(); await p.waitForTimeout(200);
    t('«Senza data» svuota il campo', await p.evaluate(() => document.getElementById('appData').value) === '');
    // il programma della lavorazione (altra finestra) usa lo stesso calendario
    await p.evaluate(() => { annullaFormApp(); }); await p.waitForTimeout(300); await p.evaluate(() => { const s = document.getElementById('domSi'); if (s && s.offsetParent) s.click(); }); await p.waitForTimeout(300);
    t('nessun campo data o ora di Android visibile in pagina', await p.evaluate(() => [...document.querySelectorAll('input[type=date], input[type=time]')].every(i => !i.offsetParent)));
    t('nessun errore in pagina', !err.length, err.join(' | '));
    await ctx.close();
  }
  console.log(`\nCalendario: ${ok} riusciti, ${ko} falliti`); await b.close(); process.exit(ko ? 1 : 0);
})();
