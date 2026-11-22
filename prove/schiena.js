const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 800 } });
  const err = []; p.on('pageerror', e => err.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('http://127.0.0.1:8766/sorgente-DoctorWood.html'); await p.waitForTimeout(800);
  await p.evaluate(() => { vaiA('cutOptimizer'); }); await p.waitForTimeout(800);
  const r = await p.evaluate(() => {
    const pz = pezziModello('base', { L: 600, H: 720, P: 560, ripiani: 1, ante: 1, quanti: 1 }, { ...REGOLE_MOD });
    const schiena = pz.pezzi.find(x => x.parte === 'schiena');
    document.getElementById('piecesContainer').innerHTML = '';
    pz.pezzi.forEach(x => { const riga = aggiungiRigaPezzo(x.parte, '', '', x.q, true, false, { mat: x.mat, bL: x.bL, bW: x.bW }); mmInCampo(riga.querySelector('.piece-l'), x.l); mmInCampo(riga.querySelector('.piece-w'), x.w); });
    calcolaOttimizzazione();
    const mats = [...new Set(pannelliCalcolati.map(q => q.materiale))];
    return { mat: schiena && schiena.mat, mats, avvisi: controllaScorteTaglio(pannelliCalcolati) };
  });
  console.log(r, err);
  process.exit(r.mats.length >= 2 && r.mat && r.avvisi.length && !err.length ? 0 : 1);
})();
