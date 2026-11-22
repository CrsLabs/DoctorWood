// Tastiera sulle sezioni (non solo sulle finestre): la pagina non deve tornare in cima, il campo resta in vista, la barra in basso si toglie.
// Si simula come Android: la finestra si accorcia di ~315 px e arriva window.__tastiera(315). Uso: node prove/tastiera.js
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const URL = process.argv[2] || 'http://localhost:8766/sorgente-DoctorWood.html';
const dati = JSON.parse(fs.readFileSync(path.join(__dirname, 'risultati', 'dati-realistici.json'), 'utf8'));
delete dati.doctorwood_pin; delete dati.doctorwood_pin_blocco;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Pixel 7'], locale: 'it-IT' });
  await ctx.addInitScript(([d]) => { if (!sessionStorage.getItem('__f')) { sessionStorage.setItem('__f', '1'); localStorage.clear(); for (const k in d) localStorage.setItem(k, d[k]); localStorage.setItem('doctorwood_modalita', 'titolare'); localStorage.setItem('doctorwood_animazioni', 'no'); } }, [dati]);
  const p = await ctx.newPage(); const errori = []; p.on('pageerror', e => errori.push(e.message));
  await p.goto(URL); await p.waitForTimeout(2200);
  let ok = 0, ko = 0; const esito = (n, c, i = '') => { if (c) ok++; else ko++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (i ? ' — ' + i : '')); };
  const schermate = ['cutOptimizer', 'photoSurvey', 'quoteTool', 'magazzinoTool', 'schedeTool', 'clientsTool', 'agendaTool'];
  for (const s of schermate) {
    await p.setViewportSize({ width: 412, height: 915 });
    await p.evaluate(n => apriStrumento(n), s); await p.waitForTimeout(500);
    // l'ultimo campo di testo visibile della pagina (quello più in basso che si può raggiungere), portato a metà schermo
    const info = await p.evaluate(() => {
      const c = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=hidden]), textarea')].filter(e => e.offsetParent && !e.closest('.hidden') && !e.disabled && !e.closest('[id^=modal]'));
      if (!c.length) return null; const e = c[Math.min(c.length - 1, 3)]; e.id = e.id || '__prova'; e.scrollIntoView({ block: 'center' }); return e.id;
    });
    if (!info) { console.log('  · ' + s + ': nessun campo'); continue; }
    const y0 = await p.evaluate(() => window.scrollY);
    await p.focus('#' + info);
    await p.setViewportSize({ width: 412, height: 600 }); await p.evaluate(() => window.__tastiera(315)); await p.waitForTimeout(700);
    const r = await p.evaluate(id => { const e = document.getElementById(id), q = e.getBoundingClientRect(); return { top: q.top, bottom: q.bottom, h: innerHeight, y: scrollY, nav: getComputedStyle(document.getElementById('bottomNav')).display, hdr: getComputedStyle(document.querySelector('header.sticky')).position }; }, info);
    esito(`${s}: il campo resta in vista con la tastiera`, r.top >= 0 && r.bottom <= r.h, `campo ${Math.round(r.top)}–${Math.round(r.bottom)} su ${r.h}`);
    esito(`${s}: la pagina non torna in cima`, y0 < 50 || r.y > 0, `prima ${Math.round(y0)} dopo ${Math.round(r.y)}`);
    esito(`${s}: barra in basso tolta e intestazione non fissa`, r.nav === 'none' && r.hdr === 'static');
    await p.evaluate(() => window.__tastiera(0)); await p.setViewportSize({ width: 412, height: 915 }); await p.waitForTimeout(300);
    esito(`${s}: chiusa la tastiera la barra torna`, await p.evaluate(() => getComputedStyle(document.getElementById('bottomNav')).display !== 'none' && getComputedStyle(document.querySelector('header.sticky')).position === 'sticky'));
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
  }
  esito('nessun errore in pagina', errori.length === 0, errori.slice(0, 2).join(' | '));
  await b.close(); console.log(`\nTastiera: ${ok} riusciti, ${ko} falliti`); process.exit(ko ? 1 : 0);
})();
