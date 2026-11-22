#!/usr/bin/env python3
"""Controllo statico: ogni tasto/campo con data-click/change/input/keydown e ogni az("…") ha la sua voce nella tabella AZIONI
(senza la voce il tasto non fa niente, e nelle prove con evaluate() non ci si accorge). Uso: python3 prove/azioni.py"""
import re, html, sys, os
s = open(os.path.join(os.path.dirname(__file__), '..', 'sorgente-DoctorWood.html'), encoding='utf-8').read()
tab = s[s.index('const AZIONI = Object.assign'):s.index('/* AZIONI:FINE */')]
chiavi = set(html.unescape(m.group(1)).replace('\\"', '"') for m in re.finditer(r'^\s+"((?:[^"\\]|\\.)*)": function', tab, re.M))
usati = {}
for m in re.finditer(r'data-(click|change|input|keydown)="([^"]*)"', s):
    v = html.unescape(m.group(2))
    if '${' not in v: usati.setdefault(v, m.group(1))
for m in re.finditer(r"az\((\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*')", s):
    v = m.group(1)[1:-1].replace("\\'", "'").replace('\\"', '"')
    if '${' not in v: usati.setdefault(v, 'az')
manca = [v for v in usati if v not in chiavi]
print(f'{len(chiavi)} voci, {len(usati)} usate, {len(manca)} senza voce')
for v in manca: print('  MANCA:', v[:140])
sys.exit(1 if manca else 0)
