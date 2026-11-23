const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ locale: 'it-IT', viewport: { width: 390, height: 800 } }); await ctx.addInitScript(() => { localStorage.setItem('doctorwood_modalita', 'titolare'); localStorage.setItem('doctorwood_animazioni', 'no'); }); const p = await ctx.newPage();
  const err = []; p.on('pageerror', e => err.push(e.message));
  await p.goto('http://127.0.0.1:8766/sorgente-DoctorWood.html'); await p.waitForTimeout(800);
  const clic = id => p.evaluate(i => document.getElementById(i).click(), id);
  // --- nuovo lavoro
  await p.evaluate(() => nuovoDaHome('lavoro')); await p.waitForTimeout(300);
  await p.fill('#gNuovoCliente', 'Mario Rossi');
  await clic('guidaAvantiBtn'); await p.waitForTimeout(300);
  await p.fill('#gTitolo', 'Cucina');
  await clic('guidaAvantiBtn'); await p.waitForTimeout(300);
  await clic('guidaAvantiBtn'); await p.waitForTimeout(800);
  const lav = await p.evaluate(() => leggiLavori().map(l => l.titolo));
  console.log('lavori', lav);
  // --- nuovo preventivo
  await p.evaluate(() => nuovoDaHome('preventivo')); await p.waitForTimeout(400);
  await p.evaluate(() => { const s = document.getElementById('gCliente'); s.selectedIndex = 1; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await clic('guidaAvantiBtn'); await p.waitForTimeout(300);
  await p.fill('#gDescr', 'Cucina su misura'); await clic('guidaAvantiBtn'); await p.waitForTimeout(300);
  await p.fill('.gv-d', 'Mobile base'); await p.fill('.gv-p', '1000'); await clic('guidaAvantiBtn'); await p.waitForTimeout(300);
  await clic('guidaAvantiBtn'); await p.waitForTimeout(300);
  console.log(await p.evaluate(() => document.getElementById('guidaCorpo').textContent));
  await clic('guidaAvantiBtn'); await p.waitForTimeout(800);
  const r = await p.evaluate(() => ({ v: vistaCorrente, voci: datiPreventivo().voci, proj: datiPreventivo().lavoro, cliente: datiPreventivo().cliente }));
  console.log(r, err);
  process.exit(lav.includes('Cucina') && r.voci.length === 1 && !err.length ? 0 : 1);
})();
