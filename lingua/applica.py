#!/usr/bin/env python3
"""Mette le traduzioni di lingua/inglese.txt dentro sorgente-DoctorWood.html (tra i segnaposto EN-INIZIO e EN-FINE).
Uso (dalla cartella DoctorWood):  python3 lingua/applica.py   poi   python3 prepara.py
Formato di inglese.txt: una riga per frase, «italiano => english». Nelle frasi:
  #   = un numero (si rimette com'è)          «@» = un nome tra «» (si rimette, tradotto se è il nome di un tasto)
  @   = un nome scritto da chi usa l'app (cliente, lavoro, materiale…)       § = una data o un mese
Una frase che finisce con * vale per tutto ciò che comincia così (il resto si traduce da solo).
Una riga «@@ nome => name» traduce il nome di un tasto citato tra «» dentro una frase.
Le righe senza « => » (e quelle vuote) sono commenti; \\n dentro una riga = a capo."""
import json, re, pathlib, sys
radice = pathlib.Path(__file__).resolve().parent.parent
voci = {}; ui = {}
for n, riga in enumerate((radice / 'lingua' / 'inglese.txt').read_text(encoding='utf-8').splitlines(), 1):
    if not riga.strip() or ' => ' not in riga: continue
    it, en = riga.split(' => ', 1)
    it, en = it.strip().replace('\\n', '\n'), en.strip().replace('\\n', '\n')
    if not en: continue
    if it.startswith('@@ '): ui[it[3:].strip()] = en
    else:
        for seg in ('#', '«@»', '§'):
            if it.count(seg) != en.count(seg): sys.exit(f'riga {n}: {seg} non torna tra italiano e inglese: {riga}')
        if it.replace('«@»', '').count('@') != en.replace('«@»', '').count('@'): sys.exit(f'riga {n}: @ non torna: {riga}')
        voci[it] = en
def obj(d): return '{\n' + ',\n'.join(f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}' for k, v in sorted(d.items())) + '\n}'
p = radice / 'sorgente-DoctorWood.html'
s = p.read_text(encoding='utf-8')
nuovo, n = re.subn(r'/\*EN-INIZIO\*/.*?/\*EN-FINE\*/', lambda m: '/*EN-INIZIO*/' + obj(voci) + '/*EN-FINE*/', s, flags=re.S)
if n != 1: sys.exit('segnaposto EN-INIZIO/EN-FINE non trovati')
nuovo, n = re.subn(r'/\*EN-UI-INIZIO\*/.*?/\*EN-UI-FINE\*/', lambda m: '/*EN-UI-INIZIO*/' + obj(ui) + '/*EN-UI-FINE*/', nuovo, flags=re.S)
if n != 1: sys.exit('segnaposto EN-UI-INIZIO/EN-UI-FINE non trovati')
if '</script' in nuovo.split('/*EN-INIZIO*/')[1].split('/*EN-FINE*/')[0].lower(): sys.exit('una traduzione contiene </script>')
p.write_text(nuovo, encoding='utf-8')
print(f'{len(voci)} frasi e {len(ui)} nomi di tasti inseriti')
