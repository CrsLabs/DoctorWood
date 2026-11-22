// Le domande e gli avvisi dell'app (finestra «modalDomanda», al posto di confirm/alert/prompt di Android):
// nelle prove si rispondono da sole, come faceva prima page.on('dialog').
//   await rispondiDomande(contestoOPagina, { accetta: true, testo: 'Prova' })
//   await impostaDomande(pagina, { accetta: false })       // cambia la risposta strada facendo
//   await leggiDomande(pagina)                             // { conta, messaggi } delle domande viste
function installa(o) {
  window.__domande = Object.assign({ accetta: true, testo: 'Prova', conta: 0, messaggi: [] }, o);
  const guarda = () => {
    const f = document.getElementById('modalDomanda');
    if (!f) return setTimeout(guarda, 50);
    new MutationObserver(() => {
      if (f.classList.contains('hidden') || f.__inRisposta) return;
      f.__inRisposta = true;
      setTimeout(() => {
        f.__inRisposta = false;
        if (f.classList.contains('hidden')) return;
        const d = window.__domande, c = document.getElementById('domCampo'), no = document.getElementById('domNo');
        d.conta++; d.messaggi.push(((document.getElementById('domTitolo').textContent || '') + ' ' + document.getElementById('domTesto').textContent).trim().slice(0, 120));
        if (!c.classList.contains('hidden')) c.value = d.testo;
        (d.accetta || no.classList.contains('hidden') ? document.getElementById('domSi') : no).click();
      }, 30);
    }).observe(f, { attributes: true, attributeFilter: ['class'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', guarda); else guarda();
}
async function rispondiDomande(dove, o = {}) { await dove.addInitScript(installa, o); }
async function impostaDomande(p, o) { await p.evaluate(o => Object.assign(window.__domande || {}, o), o); }
async function leggiDomande(p) { return p.evaluate(() => window.__domande ? { conta: window.__domande.conta, messaggi: window.__domande.messaggi.slice() } : { conta: 0, messaggi: [] }); }
module.exports = { rispondiDomande, impostaDomande, leggiDomande };
