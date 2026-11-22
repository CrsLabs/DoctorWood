// Genera icona dell'app, schermata di avvio e logo da icona/simbolo.svg.
// Uso:  node genera-icone.js        (poi ricompila)
// Il simbolo (pialla piatta, ambra e bianco) ha i colori dentro simbolo.svg.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const BLU = '#1e293b';   // blu notte piatto, come l'intestazione dell'app
const FONDO = BLU;
const RES = path.join(__dirname, 'android/app/src/main/res');
const simbolo = fs.readFileSync(path.join(__dirname, 'icona/simbolo.svg'), 'utf8').replace('<svg ', '<svg width="100%" height="100%" ');
const FONT = `font-family:'Inter','Inter Display',sans-serif`;

const icona = (lato, { forma, quota, fondo = true }) => `<html><body style="margin:0;background:transparent">
  <div style="width:${lato}px;height:${lato}px;background:${fondo ? FONDO : 'transparent'};border-radius:${forma === 'tondo' ? '50%' : forma === 'quadrato' ? (lato * 0.22) + 'px' : '0'};display:flex;align-items:center;justify-content:center;overflow:hidden">
    <div style="width:${lato * quota}px;height:${lato * quota}px">${simbolo}</div></div></body></html>`;
const marchio = (h, tag = true) => `
  <div style="${FONT};font-weight:800;font-size:${h}px;letter-spacing:-0.02em;line-height:1"><span style="color:#f1f5f9">Doctor</span><span style="color:#f59e0b">Wood</span></div>
  ${tag ? `<div style="${FONT};font-weight:500;font-size:${h * 0.2}px;letter-spacing:0.38em;color:#94a3b8;margin-top:${h * 0.32}px;display:flex;align-items:center;gap:${h * 0.25}px">
    <span style="width:${h * 0.7}px;height:1px;background:#475569"></span>IL LABORATORIO IN TASCA<span style="width:${h * 0.7}px;height:1px;background:#475569"></span></div>` : ''}`;
const avvio = (w, h) => { const l = Math.min(w, h); return `<html><body style="margin:0;width:${w}px;height:${h}px;background:${FONDO};display:flex;flex-direction:column;align-items:center;justify-content:center">
  <div style="width:${l * 0.42}px;height:${l * 0.42}px">${simbolo}</div>
  <div style="display:flex;flex-direction:column;align-items:center;margin-top:${l * 0.02}px">${marchio(l * 0.105)}</div></body></html>`; };
const logo = lato => `<html><body style="margin:0;width:${lato}px;height:${lato}px;background:${FONDO};display:flex;flex-direction:column;align-items:center;justify-content:center">
  <div style="width:${lato * 0.62}px;height:${lato * 0.62}px">${simbolo}</div>
  <div style="display:flex;flex-direction:column;align-items:center;margin-top:${-lato * 0.03}px">${marchio(lato * 0.12)}</div></body></html>`;

(async () => {
  const b = await chromium.launch(), p = await b.newPage();
  const foto = async (html, w, h, file) => {
    await p.setViewportSize({ width: Math.round(w), height: Math.round(h) });
    await p.setContent(html);
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: Math.round(w), height: Math.round(h) } });
  };
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    const dir = path.join(RES, 'mipmap-' + d);
    await foto(icona(48 * k, { forma: 'quadrato', quota: 0.92 }), 48 * k, 48 * k, path.join(dir, 'ic_launcher.png'));
    await foto(icona(48 * k, { forma: 'tondo', quota: 0.84 }), 48 * k, 48 * k, path.join(dir, 'ic_launcher_round.png'));
    // icona adattiva: 108dp; il simbolo resta dentro la zona sicura centrale (66dp)
    await foto(icona(108 * k, { quota: 0.64, fondo: false }), 108 * k, 108 * k, path.join(dir, 'ic_launcher_foreground.png'));
  }
  for (const dir of fs.readdirSync(RES).filter(x => /^drawable/.test(x))) {
    const f = path.join(RES, dir, 'splash.png');
    if (!fs.existsSync(f)) continue;
    const buf = fs.readFileSync(f), w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    await foto(avvio(w, h), w, h, f);
  }
  await foto(icona(512, { forma: 'quadrato', quota: 0.92 }), 512, 512, path.join(__dirname, 'icona/anteprima-512.png'));
  await foto(icona(512, { forma: 'nessuna', quota: 0.92 }), 512, 512, path.join(__dirname, 'icona/icona-play-store-512.png'));
  await foto(logo(1024), 1024, 1024, path.join(__dirname, 'icona/logo-doctorwood-1024.png'));
  await b.close();
  // sfondo dell'icona adattiva: lo stesso blu
  fs.writeFileSync(path.join(RES, 'drawable/ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="${BLU}" />
</shape>
`);
  fs.writeFileSync(path.join(RES, 'values/ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BLU}</color>\n</resources>\n`);
  for (const f of ['ic_launcher.xml', 'ic_launcher_round.xml'])
    fs.writeFileSync(path.join(RES, 'mipmap-anydpi', f), `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`);
  console.log('Icone, schermate di avvio e logo generati');
})();
