// Le notifiche si chiudono scorrendole con il dito (anche partendo da sopra un tasto)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ locale: 'it-IT', viewport: { width: 390, height: 800 } });
  await ctx.addInitScript(() => { localStorage.setItem('doctorwood_modalita', 'titolare'); localStorage.setItem('doctorwood_animazioni', 'no'); });
  const p = await ctx.newPage(); const err = []; p.on('pageerror', e => err.push(e.message));
  let ok = 0, ko = 0; const t = (n, c) => { (c ? ok++ : ko++); console.log((c ? '  ✓ ' : '  ✗ ') + n); };
  await p.goto('http://127.0.0.1:8766/sorgente-DoctorWood.html'); await p.waitForTimeout(800);
  const scorri = async (id, dx, dy) => {
    const r = await p.evaluate(id => { const e = document.getElementById(id).getBoundingClientRect(); return { x: e.x + e.width / 2, y: e.y + e.height / 2 }; }, id);
    await p.evaluate(() => getSelection().removeAllRanges()); await p.mouse.move(r.x, r.y); await p.mouse.down(); await p.mouse.move(r.x + dx / 2, r.y + dy / 2, { steps: 3 }); await p.mouse.move(r.x + dx, r.y + dy, { steps: 3 }); await p.mouse.up(); await p.waitForTimeout(500);
  };
  for (const [tipo, dx, dy] of [['ok', 90, 0], ['errore', -90, 0], ['info', 0, -50], ['ok', 40, 0]]) {
    await p.evaluate(tp => avvisoGuardia('Prova ' + tp, tp, true), tipo);
    await scorri('avvisoGuardia', dx, dy);
    t(`notifica «${tipo}» scorsa (${dx},${dy}) si chiude`, await p.evaluate(() => document.getElementById('avvisoGuardia').classList.contains('hidden')));
  }
  await p.evaluate(() => { mostraAvvisoBackup(true); });
  await scorri('avvisoBackup', 100, 0);
  t('avviso del backup scorso si chiude', await p.evaluate(() => document.getElementById('avvisoBackup').classList.contains('hidden')));
  // i comandi sotto un messaggio restano premibili
  await p.evaluate(() => { window.__t = 0; const b = document.createElement('button'); b.id = 'sotto'; b.textContent = 'sotto'; b.style.cssText = 'position:fixed;left:0;right:0;top:0;height:40px;z-index:70'; b.onclick = () => { window.__t++; }; document.body.appendChild(b); avvisoGuardia('Messaggio sopra', 'info', true); });
  const r2 = await p.evaluate(() => { const e = document.querySelector('#avvisoGuardia > div').getBoundingClientRect(); return { x: e.x + 40, y: Math.max(e.y + 6, 12) }; });
  await p.mouse.click(r2.x, r2.y); await p.waitForTimeout(200);
  t('un tocco sul messaggio arriva al comando che sta sotto', await p.evaluate(() => window.__t === 1));
  // un tocco fermo sul tasto «Backup» funziona ancora
  await p.evaluate(() => { window.__b = 0; window.backupDaAvviso = () => { window.__b++; }; mostraAvvisoBackup(true); });
  await p.evaluate(() => document.querySelector('#avvisoBackup button').click());
  console.log(`\nNotifiche: ${ok} riusciti, ${ko} falliti`, err); process.exit(ko || err.length ? 1 : 0);
})();
