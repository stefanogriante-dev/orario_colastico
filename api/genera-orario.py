# -*- coding: utf-8 -*-
"""
Funzione serverless Vercel (Python runtime): riceve i dati dell'orario da
generare e restituisce la combinazione trovata da OR-Tools CP-SAT.

Chiamata da src/app/orario/page.tsx al posto (o in aggiunta, come primo
tentativo) della ricerca euristica client-side in src/lib/scheduler.ts.
Se questa funzione non risponde o va in errore, il chiamante ripiega
automaticamente sull'euristica client-side: vedi generaOrarioParallelo in
src/lib/schedulerParallelo.ts.
"""

import json
from http.server import BaseHTTPRequestHandler

from orario_solver import genera_orario

# Tempo massimo che il solver puo' usare, in secondi: tenuto
# volutamente sotto il timeout di default delle funzioni Vercel (10s sul
# piano gratuito) per lasciare margine di sicurezza. Se il piano Vercel
# permette timeout piu' lunghi (Pro/Enterprise, o "maxDuration" alzato in
# vercel.json), questo valore puo' essere aumentato per orari grandi o
# molto vincolati.
MAX_SECONDI_SOLVER_DEFAULT = 8.0
MAX_SECONDI_SOLVER_LIMITE = 50.0


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            lunghezza = int(self.headers.get("Content-Length", 0))
            corpo = self.rfile.read(lunghezza) if lunghezza > 0 else b"{}"
            input_data = json.loads(corpo.decode("utf-8"))

            max_secondi = input_data.pop("maxSecondiSolver", MAX_SECONDI_SOLVER_DEFAULT)
            try:
                max_secondi = float(max_secondi)
            except (TypeError, ValueError):
                max_secondi = MAX_SECONDI_SOLVER_DEFAULT
            max_secondi = max(1.0, min(max_secondi, MAX_SECONDI_SOLVER_LIMITE))

            risultato = genera_orario(input_data, max_seconds=max_secondi)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(risultato).encode("utf-8"))
        except Exception as e:  # noqa: BLE001 - vogliamo sempre rispondere con un errore leggibile
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"errore": str(e)}).encode("utf-8"))

    def do_GET(self):
        # Solo per verificare rapidamente che la funzione sia online.
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"stato": "ok", "info": "usa POST per generare un orario"}).encode("utf-8"))
