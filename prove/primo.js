const { chromium, devices } = require('playwright');
const MOCK = `
(() => {
  const ss = sessionStorage;
  const b64 = u => { let s=''; for (const x of u) s+=String.fromCharCode(x); return btoa(s); };
  const byte = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
  async function key() {
    let r = ss.getItem('mockKey'); if (!r) { r = b64(crypto.getRandomValues(new Uint8Array(32))); ss.setItem('mockKey', r); }
    return crypto.subtle.importKey('raw', byte(r), 'AES-GCM', false, ['encrypt','decrypt']);
  }
  window.__chiamate = [];
  const err = (code, msg) => Object.assign(new Error(msg||code), { code });
  const P = {
    async puoSbloccare() { return { ok: false }; },
    async stato() { return { biometria: ss.getItem('mockBio') || 'pronta', chiave: !!ss.getItem('mockKey') }; },
    async eliminaChiave() { ss.removeItem('mockKey'); ss.removeItem('mockInvalid'); },
    async cifra(o) { if (ss.getItem('mockAnnulla')) { ss.removeItem('mockAnnulla'); throw err('ANNULLATO'); } const iv = crypto.getRandomValues(new Uint8Array(12)); const c = await crypto.subtle.encrypt({name:'AES-GCM',iv}, await key(), byte(o.dati)); return { iv: b64(iv), dati: b64(new Uint8Array(c)) }; },
    async decifra(o) { if (ss.getItem('mockInvalid')) throw err('CHIAVE_INVALIDATA'); if (ss.getItem('mockAnnulla')) { ss.removeItem('mockAnnulla'); throw err('ANNULLATO'); } const c = await crypto.subtle.decrypt({name:'AES-GCM',iv:byte(o.iv)}, await key(), byte(o.dati)); return { dati: b64(new Uint8Array(c)) }; },
    async salvaFile(o) { __chiamate.push(['salvaFile', o.nome, o.mime, o.dati.length]); return { salvato: ss.getItem('mockNoSalva') ? false : true }; },
    async apriFile(o) { __chiamate.push(['apriFile', o.nome, o.mime]); },
    async condividiFile(o) { __chiamate.push(['condividiFile', o.nome || o.testo]); },
    async stampa(o) { __chiamate.push(['stampa', o.nome]); },
    async verificaIdentita() { __chiamate.push(['verificaIdentita']); return {}; },
  };
  window.Capacitor = { isNativePlatform: () => true, nativePromise: (pl, m, o) => {
    if (pl === 'Laboratorio') { __chiamate.push(['lab.' + m, o && o.nome]);
      if (m === 'elencoCartella') return Promise.resolve({ file: [{ nome: 'doctorwood-laboratorio.dwsync' }, { nome: 'doctorwood-avanzamento-ab12.dwsync' }, { nome: 'doctorwood-foto.jpg' }] });
      if (m === 'riprendi') return Promise.resolve({ dati: btoa('x'.repeat(32)) });
      return Promise.resolve({}); }
    if (pl !== 'Cassaforte') return Promise.reject(err('X')); return P[m] ? P[m](o) : Promise.resolve({}); } };
})();`;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ locale: 'it-IT', ...devices['Pixel 7'] });
  await ctx.addInitScript(MOCK);
  const p = await ctx.newPage();
  const errori = []; p.on('pageerror', e => errori.push(e.message)); p.on('console', m => { if (m.type() === 'error' || /Content Security|Refused/.test(m.text())) errori.push(m.text()); });
  await p.goto('http://localhost:8765/index.html');
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(1200);
  console.log('benvenuto visibile:', await p.evaluate(() => !document.getElementById('modalModalita').classList.contains('hidden')));
  await p.evaluate(() => scegliIniziale('titolare', null)); 
  await p.waitForSelector('#modalCassaforte:not(.hidden)', { timeout: 8000 });
  console.log('1.', await p.textContent('#cassaTitolo'), '|', (await p.textContent('#cassaTesto')).slice(0, 60));
  await p.click('#cassaSi');
  await p.waitForFunction(() => document.getElementById('cassaTitolo').textContent === 'Solo le tue impronte'); await p.click('#cassaSi');
  await p.waitForSelector('#cassaPw2:not(.hidden)');
  await p.fill('#cassaPw1', 'pialla rossa sul banco'); await p.fill('#cassaPw2', 'pialla rossa sul banco'); await p.click('#cassaSi');
  await p.waitForFunction(() => !!localStorage.getItem('doctorwood_cassaforte_chiavi'), null, { timeout: 15000 });
  await p.waitForTimeout(300);
  console.log('2. chiavi salvate:', await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('doctorwood_cassaforte_chiavi')))), '| modalità:', await p.evaluate(() => localStorage.getItem('doctorwood_modalita')), '| avviso:', await p.textContent('#avvisoGuardiaTesto').catch(() => ''));
  // passaggio in Laboratorio: niente più password, solo il dito
  await p.evaluate(() => scegliModalita('laboratorio'));
  await p.waitForSelector('#modalCassaforte:not(.hidden)');
  console.log('3.', await p.textContent('#cassaTitolo'));
  await Promise.all([p.waitForNavigation(), p.click('#cassaSi')]);
  await p.waitForTimeout(1000);
  console.log('4. in Laboratorio:', await p.evaluate(() => modoLab()), '| cassaforte chiusa:', await p.evaluate(() => !!localStorage.getItem('doctorwood_cassaforte')));
  // ritorno
  await p.evaluate(() => esciLaboratorio()); await p.waitForTimeout(2000);
  console.log('5. di nuovo Titolare:', await p.evaluate(() => localStorage.getItem('doctorwood_modalita')), '| clienti tornati:', await p.evaluate(() => localStorage.getItem('doctorwood_clients') !== null || 'nessun cliente (era vuoto)'));
  // riga delle impostazioni
  await p.evaluate(() => { apriImpostazioni(); apriCatImp('laboratorio'); }); await p.waitForTimeout(500);
  console.log('6. riga cassaforte:', await p.textContent('#impCassaSotto'));
  // cancella tutto
  await p.evaluate(() => { localStorage.setItem('doctorwood_sincronia', JSON.stringify({ v: 1, uri: 'content://x', nome: 'DoctorWood', chiave: { a: 1 }, id: 'ab12' })); apriCatImp('dati'); });
  await p.waitForTimeout(400);
  console.log('7. riga cancella:', await p.textContent('#impCancellaSotto'));
  await p.click('#impCancella');
  await p.waitForSelector('#modalCassaforte:not(.hidden)');
  console.log('8.', await p.textContent('#cassaTitolo'), '|', (await p.textContent('#cassaTesto')).replace(/\n/g, ' ').slice(0, 260));
  await p.click('#cassaSi');
  await p.waitForFunction(() => document.getElementById('cassaTitolo').textContent === 'Conferma');
  await p.fill('#cassaPw1', 'cancello'); await p.click('#cassaSi'); await p.waitForTimeout(300);
  console.log('9. parola sbagliata →', await p.textContent('#cassaErrore'));
  await p.fill('#cassaPw1', 'cancella'); await p.click('#cassaSi');
  await p.waitForTimeout(2500);
  console.log('10. chiamate:', JSON.stringify(await p.evaluate(() => __chiamate.filter(c => /lab\.(eliminaFile|cancellaTutto)|verificaIdentita/.test(c[0])))));
  console.log('11. localStorage vuoto:', await p.evaluate(() => localStorage.length), '| database:', await p.evaluate(async () => (await indexedDB.databases()).length));
  console.log('errori:', errori.length ? errori : 'nessuno');
  await b.close();
})();
