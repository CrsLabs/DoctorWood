#!/usr/bin/env python3
"""Prepara www/index.html per l'app Android.

- parte da sorgente-DoctorWood.html (la pagina di sempre, che resta usabile nel browser)
- aggiunge in fondo il blocco piattaforma-android.js (si attiva solo dentro l'app)
- ricalcola le impronte sha256 di TUTTI gli script nella regola di sicurezza (CSP),
  anche nella pagina per il browser se uno script è cambiato

Uso:  python3 prepara.py   (poi: npx cap sync android)
"""
import base64
import hashlib
import pathlib
import re
import sys

QUI = pathlib.Path(__file__).resolve().parent
SORGENTE = QUI / 'sorgente-DoctorWood.html'
BLOCCO = QUI / 'piattaforma-android.js'
DESTINAZIONE = QUI / 'www' / 'index.html'


def con_csp_aggiornata(html):
    """Ricalcola le impronte sha256 di tutti gli script nella regola di sicurezza (CSP)."""
    impronte = []
    for m in re.finditer(r'<script>(.*?)</script>', html, re.S):
        h = base64.b64encode(hashlib.sha256(m.group(1).encode('utf-8')).digest()).decode()
        impronte.append(f"'sha256-{h}'")
    if re.search(r'<script\s+[^>]*>', html):
        sys.exit('Trovato uno <script> con attributi: non previsto, controlla la pagina')
    csp = re.compile(r"(script-src )([^;]*)(;)")
    m = re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)"', html)
    if not m or not csp.search(m.group(1)):
        sys.exit('Regola di sicurezza (CSP) non trovata')
    nuova = csp.sub(lambda x: x.group(1) + ' '.join(impronte) + x.group(3), m.group(1), count=1)
    return html.replace(m.group(1), nuova, 1), len(impronte)


def main():
    html = SORGENTE.read_text(encoding='utf-8')
    # il numero di versione mostrato nell'app è sempre quello dell'APK (versionName in android/app/build.gradle)
    vn = re.search(r'versionName "([^"]+)"', (QUI / 'android' / 'app' / 'build.gradle').read_text(encoding='utf-8'))
    if vn:
        nuovo = re.sub(r"const VERSIONE_APP = '[^']*';", f"const VERSIONE_APP = '{vn.group(1)}';", html, count=1)
        if nuovo != html:
            SORGENTE.write_text(nuovo, encoding='utf-8'); html = nuovo
            print(f'{SORGENTE.name}: versione {vn.group(1)}')
    # 1. la pagina per il browser: se uno script è cambiato, si aggiornano le sue impronte
    sorgente, _ = con_csp_aggiornata(html)
    if sorgente != html:
        SORGENTE.write_text(sorgente, encoding='utf-8')
        print(f'{SORGENTE.name}: CSP aggiornata (uno script era cambiato)')
    # 2. la pagina dell'app: con il blocco Android in fondo
    blocco = BLOCCO.read_text(encoding='utf-8')
    if '</script>' in blocco.lower():
        sys.exit('piattaforma-android.js non può contenere </script>')
    if sorgente.count('</body>') != 1:
        sys.exit('La pagina deve avere un solo </body>')
    app, n = con_csp_aggiornata(sorgente.replace('</body>', '  <script>\n' + blocco + '  </script>\n</body>'))
    DESTINAZIONE.parent.mkdir(parents=True, exist_ok=True)
    DESTINAZIONE.write_text(app, encoding='utf-8')
    print(f'{DESTINAZIONE.relative_to(QUI)}: {n} script, CSP aggiornata')


if __name__ == '__main__':
    main()
