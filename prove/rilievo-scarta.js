const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 800 } });
  const err = []; p.on('pageerror', e => err.push(e.message));
  await p.goto('http://127.0.0.1:8766/sorgente-DoctorWood.html'); await p.waitForTimeout(800);
  await p.evaluate(() => { apriStrumento('photoSurvey'); }); await p.waitForTimeout(1200);
  const prima = await p.evaluate(() => tutteLeFoto.length);
  await p.evaluate(() => { tutteLeFoto.push({ id: 'zz1', rilievoId: rilievoCorrenteId, nome: 'x', dati: 'data:image/jpeg;base64,/9j/4AAQ', annotazioni: [] }); });
  const sporco = await p.evaluate(() => rilievoNonSalvato());
  await p.evaluate(() => vaiA('quoteTool')); await p.waitForTimeout(600);
  console.log(await p.evaluate(() => document.getElementById('modalUscita').className + '|' + document.getElementById('uscitaTitolo').textContent)); await p.evaluate(() => document.getElementById('uscitaSecondario').click()); await p.waitForTimeout(900);
  await p.evaluate(() => apriStrumento('photoSurvey')); await p.waitForTimeout(1200);
  const dopo = await p.evaluate(() => tutteLeFoto.length);
  console.log({ prima, sporco, dopo, err });
  process.exit(prima === dopo && sporco && !err.length ? 0 : 1);
})();
