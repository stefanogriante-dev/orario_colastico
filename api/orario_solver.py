# -*- coding: utf-8 -*-
"""
Motore di generazione automatica dell'orario basato su Google OR-Tools
CP-SAT, in alternativa all'euristica random-restart in TypeScript
(src/lib/scheduler.ts).

A differenza dell'euristica, CP-SAT modella il problema come un vero
problema di soddisfacimento vincoli con funzione obiettivo: trova sempre
la combinazione OTTIMA (o dimostra che una combinazione migliore non
esiste) entro il tempo a disposizione, invece di affidarsi a tentativi
casuali ripetuti.

Impostazione del modello:
- Una variabile booleana x[assegnazione_id, slot_id] = 1 se quell'ora
  dell'assegnazione viene piazzata in quello slot.
- Per ogni assegnazione, una variabile intera "mancanti" = quante ore
  NON sono state piazzate: e' sempre permesso non piazzare un'ora (cosi'
  il modello e' sempre risolvibile), ma ha un costo altissimo
  nell'obiettivo, cosi' il risolutore piazza SEMPRE il massimo possibile
  di ore prima di preoccuparsi delle preferenze (stessa priorita'
  dell'euristica: prima completezza, poi preferenze).
- Le preferenze dei docenti diventano termini pesati nella funzione
  obiettivo (stessi pesi dell'euristica: giorno_libero=50,
  no_prima_ora/no_ultima_ora/no_ora_specifica=20, evita_buchi=15).
- Il numero ESATTO di preferenze violate mostrato all'utente non viene
  letto dall'obiettivo del solver (che per evita_buchi usa
  un'approssimazione piu' semplice da modellare) ma ricalcolato a parte,
  sulla combinazione finale, con la stessa logica esatta di
  contaViolazioni() in scheduler.ts: cosi' il numero mostrato e' sempre
  corretto anche se l'obiettivo interno e' solo un'euristica di guida.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from ortools.sat.python import cp_model

PESO_GIORNO_LIBERO = 50
PESO_NO_PRIMA_ULTIMA_ORA = 20
PESO_NO_ORA_SPECIFICA = 20
PESO_EVITA_BUCHI = 15
# Penalita' per ogni ora NON piazzata: molto piu' alta di qualsiasi somma
# ragionevole di preferenze violate, cosi' il solver piazza sempre il
# massimo possibile di ore prima di ottimizzare le preferenze.
PESO_ORA_NON_PIAZZATA = 100_000

DEFAULT_LIMITE_ORE_NORMALE = 5
DEFAULT_LIMITE_ORE_ECCEZIONE = 6


def _giorni_da_dettaglio(dettaglio: dict | None) -> list[int]:
    if not dettaglio:
        return []
    if isinstance(dettaglio.get("giorni"), list):
        return list(dettaglio["giorni"])
    if dettaglio.get("giorno") is not None:
        return [dettaglio["giorno"]]
    return []


def _giorno_compatibile(dettaglio: dict | None, giorno: int) -> bool:
    giorni = _giorni_da_dettaglio(dettaglio)
    return len(giorni) == 0 or giorno in giorni


def _ora_da_dettaglio(dettaglio: dict | None) -> int | None:
    if not dettaglio:
        return None
    ora = dettaglio.get("ora")
    return ora if isinstance(ora, int) else None


def conta_violazioni(
    entries: list[dict],
    slot_by_id: dict[int, dict],
    slots_by_day: dict[int, list[dict]],
    preferenze: list[dict],
) -> tuple[int, list[dict]]:
    """Riproduce esattamente contaViolazioni() di scheduler.ts: usata per
    calcolare il numero DEFINITIVO di preferenze violate sul risultato
    finale (manuali + generate), indipendentemente da come l'obiettivo
    del solver le ha approssimate durante la ricerca."""
    ore_per_docente: dict[int, list[dict]] = defaultdict(list)
    for e in entries:
        slot = slot_by_id.get(e["time_slot_id"])
        if slot:
            ore_per_docente[e["teacher_id"]].append(slot)

    prefs_per_docente: dict[int, list[dict]] = defaultdict(list)
    for p in preferenze:
        prefs_per_docente[p["teacher_id"]].append(p)

    totale = 0
    dettagli: list[dict] = []

    for teacher_id, prefs in prefs_per_docente.items():
        ore_docente = ore_per_docente.get(teacher_id, [])
        for p in prefs:
            tipo = p["tipo"]
            dettaglio = p.get("dettaglio")

            if tipo == "giorno_libero":
                for giorno in _giorni_da_dettaglio(dettaglio):
                    if any(s["giorno"] == giorno for s in ore_docente):
                        totale += 1
                        dettagli.append({"teacherId": teacher_id, "tipo": tipo, "giorno": giorno})

            elif tipo == "no_prima_ora":
                for s in ore_docente:
                    if not _giorno_compatibile(dettaglio, s["giorno"]):
                        continue
                    griglia = slots_by_day.get(s["giorno"], [])
                    prima_ora = griglia[0]["ora"] if griglia else None
                    if s["ora"] == prima_ora:
                        totale += 1
                        dettagli.append({"teacherId": teacher_id, "tipo": tipo, "giorno": s["giorno"]})

            elif tipo == "no_ultima_ora":
                for s in ore_docente:
                    if not _giorno_compatibile(dettaglio, s["giorno"]):
                        continue
                    griglia = slots_by_day.get(s["giorno"], [])
                    ultima_ora = griglia[-1]["ora"] if griglia else None
                    if s["ora"] == ultima_ora:
                        totale += 1
                        dettagli.append({"teacherId": teacher_id, "tipo": tipo, "giorno": s["giorno"]})

            elif tipo == "no_ora_specifica":
                ora_richiesta = _ora_da_dettaglio(dettaglio)
                if ora_richiesta is not None:
                    for s in ore_docente:
                        if not _giorno_compatibile(dettaglio, s["giorno"]):
                            continue
                        if s["ora"] == ora_richiesta:
                            totale += 1
                            dettagli.append(
                                {"teacherId": teacher_id, "tipo": tipo, "giorno": s["giorno"], "ora": s["ora"]}
                            )

            elif tipo == "evita_buchi":
                giorni_con_ore: dict[int, list[int]] = defaultdict(list)
                for s in ore_docente:
                    giorni_con_ore[s["giorno"]].append(s["ora"])
                for giorno, ore in giorni_con_ore.items():
                    ordinate = sorted(ore)
                    for i in range(1, len(ordinate)):
                        if ordinate[i] - ordinate[i - 1] > 1:
                            totale += 1
                            dettagli.append({"teacherId": teacher_id, "tipo": tipo, "giorno": giorno})

    return totale, dettagli


def genera_orario(input_data: dict[str, Any], max_seconds: float = 8.0) -> dict[str, Any]:
    time_slots: list[dict] = input_data["timeSlots"]
    assegnazioni: list[dict] = input_data["assegnazioni"]
    entrate_manuali: list[dict] = input_data.get("entrateManuali", [])
    preferenze: list[dict] = input_data.get("preferenze", [])
    materie_motoria: set[int] = set(input_data.get("materieMotoria") or [])
    materie_escluse_con_motoria: set[int] = set(input_data.get("materieEscluseConMotoria") or [])
    vincoli = input_data.get("vincoliOpzionali") or {}
    vincolo_max_ore_classe_giorno: bool = vincoli.get("maxOreClasseGiorno", True)
    vincolo_max_ore_giorno_docente: bool = vincoli.get("maxOreGiornoDocente", True)
    limite_normale: int = vincoli.get("limiteOreGiornoNormale", DEFAULT_LIMITE_ORE_NORMALE)
    limite_eccezione: int = vincoli.get("limiteOreGiornoEccezione", DEFAULT_LIMITE_ORE_ECCEZIONE)

    slot_by_id = {s["id"]: s for s in time_slots}
    slots_by_day: dict[int, list[dict]] = defaultdict(list)
    for s in time_slots:
        slots_by_day[s["giorno"]].append(s)
    for giorno in slots_by_day:
        slots_by_day[giorno].sort(key=lambda s: s["ora"])
    prima_ora_del_giorno = {g: slots[0]["ora"] for g, slots in slots_by_day.items()}
    ultima_ora_del_giorno = {g: slots[-1]["ora"] for g, slots in slots_by_day.items()}

    # ---- Ore manuali: fisse, non toccate dal solver -----------------
    teacher_busy_fisso: set[tuple[int, int]] = set()  # (teacher_id, slot_id)
    class_busy_fisso: set[tuple[int, int]] = set()  # (class_id, slot_id)
    ore_manuali_per_assegnazione: dict[tuple[int, int, int], int] = defaultdict(int)
    manuali_entries: list[dict] = []
    for e in entrate_manuali:
        teacher_busy_fisso.add((e["teacher_id"], e["time_slot_id"]))
        class_busy_fisso.add((e["class_id"], e["time_slot_id"]))
        chiave_ass = (e["teacher_id"], e["class_id"], e["subject_id"])
        ore_manuali_per_assegnazione[chiave_ass] += 1
        manuali_entries.append(
            {
                "teacher_id": e["teacher_id"],
                "class_id": e["class_id"],
                "subject_id": e["subject_id"],
                "time_slot_id": e["time_slot_id"],
            }
        )

    model = cp_model.CpModel()

    # ---- Variabili: x[assegnazione_id, slot_id] ----------------------
    x: dict[tuple[int, int], cp_model.IntVar] = {}
    slot_ids_validi_per_assegnazione: dict[int, list[int]] = {}
    ore_da_generare_per_assegnazione: dict[int, int] = {}

    for a in assegnazioni:
        a_id = a["id"]
        chiave_ass = (a["teacher_id"], a["class_id"], a["subject_id"])
        ore_gia_manuali = ore_manuali_per_assegnazione.get(chiave_ass, 0)
        ore_da_generare = max(0, a["ore_settimanali"] - ore_gia_manuali)
        ore_da_generare_per_assegnazione[a_id] = ore_da_generare

        slot_validi = []
        for s in time_slots:
            if (a["teacher_id"], s["id"]) in teacher_busy_fisso:
                continue
            if (a["class_id"], s["id"]) in class_busy_fisso:
                continue
            slot_validi.append(s["id"])
            x[(a_id, s["id"])] = model.NewBoolVar(f"x_a{a_id}_s{s['id']}")
        slot_ids_validi_per_assegnazione[a_id] = slot_validi

    # ---- Ore piazzate per assegnazione + variabile "mancanti" --------
    mancanti: dict[int, cp_model.IntVar] = {}
    for a in assegnazioni:
        a_id = a["id"]
        n = ore_da_generare_per_assegnazione[a_id]
        somma_piazzate = sum(x[(a_id, s_id)] for s_id in slot_ids_validi_per_assegnazione[a_id])
        m = model.NewIntVar(0, n, f"mancanti_a{a_id}")
        model.Add(somma_piazzate + m == n)
        mancanti[a_id] = m

    # ---- Vincolo strutturale: un docente non puo' avere due ore nello
    #      stesso slot in classi diverse -----------------------------
    x_per_docente_slot: dict[tuple[int, int], list[cp_model.IntVar]] = defaultdict(list)
    x_per_classe_slot: dict[tuple[int, int], list[cp_model.IntVar]] = defaultdict(list)
    for a in assegnazioni:
        a_id = a["id"]
        for s_id in slot_ids_validi_per_assegnazione[a_id]:
            x_per_docente_slot[(a["teacher_id"], s_id)].append(x[(a_id, s_id)])
            x_per_classe_slot[(a["class_id"], s_id)].append(x[(a_id, s_id)])

    for varset in x_per_docente_slot.values():
        if len(varset) > 1:
            model.Add(sum(varset) <= 1)
    for varset in x_per_classe_slot.values():
        if len(varset) > 1:
            model.Add(sum(varset) <= 1)

    # ---- Vincolo strutturale: adiacenza per modalita' "a coppie" -----
    # Se in un giorno vengono piazzate 2+ ore della stessa assegnazione
    # "a coppie", devono essere in slot adiacenti (mai piu' di 2, mai
    # sparse): si ottiene vietando ogni coppia di slot NON adiacenti
    # dello stesso giorno per la stessa assegnazione.
    for a in assegnazioni:
        if a["modalita"] != "coppie":
            continue
        a_id = a["id"]
        for giorno, slots_giorno in slots_by_day.items():
            slot_in_giorno = [s for s in slots_giorno if (a_id, s["id"]) in x]
            for i in range(len(slot_in_giorno)):
                for j in range(i + 1, len(slot_in_giorno)):
                    s1, s2 = slot_in_giorno[i], slot_in_giorno[j]
                    if abs(s1["ora"] - s2["ora"]) != 1:
                        model.Add(x[(a_id, s1["id"])] + x[(a_id, s2["id"])] <= 1)

    # ---- Vincolo opzionale: max 2 ore/giorno per la stessa coppia
    #      docente-classe --------------------------------------------
    if vincolo_max_ore_classe_giorno:
        coppie_docente_classe: set[tuple[int, int]] = {(a["teacher_id"], a["class_id"]) for a in assegnazioni}
        for teacher_id, class_id in coppie_docente_classe:
            assegnazioni_coppia = [
                a for a in assegnazioni if a["teacher_id"] == teacher_id and a["class_id"] == class_id
            ]
            for giorno, slots_giorno in slots_by_day.items():
                ore_manuali_giorno = sum(
                    1
                    for e in manuali_entries
                    if e["teacher_id"] == teacher_id
                    and e["class_id"] == class_id
                    and slot_by_id[e["time_slot_id"]]["giorno"] == giorno
                )
                termini = [
                    x[(a["id"], s["id"])]
                    for a in assegnazioni_coppia
                    for s in slots_giorno
                    if (a["id"], s["id"]) in x
                ]
                if termini:
                    model.Add(sum(termini) + ore_manuali_giorno <= 2)

    # ---- Vincolo opzionale: max ore/giorno per docente, con UNA sola
    #      giornata "eccezione" a settimana ----------------------------
    if vincolo_max_ore_giorno_docente:
        docenti = {a["teacher_id"] for a in assegnazioni}
        for teacher_id in docenti:
            assegnazioni_docente = [a for a in assegnazioni if a["teacher_id"] == teacher_id]
            eccezione_giorno_vars = []
            for giorno in slots_by_day:
                ore_manuali_giorno = sum(
                    1
                    for e in manuali_entries
                    if e["teacher_id"] == teacher_id and slot_by_id[e["time_slot_id"]]["giorno"] == giorno
                )
                termini = [
                    x[(a["id"], s["id"])]
                    for a in assegnazioni_docente
                    for s in slots_by_day[giorno]
                    if (a["id"], s["id"]) in x
                ]
                somma_ore_giorno = sum(termini) + ore_manuali_giorno if termini else ore_manuali_giorno

                eccezione = model.NewBoolVar(f"eccezione_t{teacher_id}_g{giorno}")
                model.Add(somma_ore_giorno <= limite_normale + (limite_eccezione - limite_normale) * eccezione)
                if ore_manuali_giorno > limite_normale:
                    model.Add(eccezione == 1)
                eccezione_giorno_vars.append(eccezione)
            if eccezione_giorno_vars:
                model.Add(sum(eccezione_giorno_vars) <= 1)

    # ---- Vincolo opzionale: Motoria esclude Arte/Tecnologia nello
    #      stesso giorno per la stessa classe -------------------------
    if materie_motoria and materie_escluse_con_motoria:
        classi = {a["class_id"] for a in assegnazioni}
        for class_id in classi:
            for giorno, slots_giorno in slots_by_day.items():
                manuale_motoria = any(
                    e["class_id"] == class_id
                    and e["subject_id"] in materie_motoria
                    and slot_by_id[e["time_slot_id"]]["giorno"] == giorno
                    for e in manuali_entries
                )
                manuale_esclusa = any(
                    e["class_id"] == class_id
                    and e["subject_id"] in materie_escluse_con_motoria
                    and slot_by_id[e["time_slot_id"]]["giorno"] == giorno
                    for e in manuali_entries
                )
                termini_motoria = [
                    x[(a["id"], s["id"])]
                    for a in assegnazioni
                    if a["class_id"] == class_id and a["subject_id"] in materie_motoria
                    for s in slots_giorno
                    if (a["id"], s["id"]) in x
                ]
                termini_esclusa = [
                    x[(a["id"], s["id"])]
                    for a in assegnazioni
                    if a["class_id"] == class_id and a["subject_id"] in materie_escluse_con_motoria
                    for s in slots_giorno
                    if (a["id"], s["id"]) in x
                ]
                if manuale_motoria and termini_esclusa:
                    model.Add(sum(termini_esclusa) == 0)
                if manuale_esclusa and termini_motoria:
                    model.Add(sum(termini_motoria) == 0)
                if not manuale_motoria and not manuale_esclusa and termini_motoria and termini_esclusa:
                    ha_motoria = model.NewBoolVar(f"hamot_{class_id}_{giorno}")
                    ha_esclusa = model.NewBoolVar(f"haesc_{class_id}_{giorno}")
                    model.Add(sum(termini_motoria) >= 1).OnlyEnforceIf(ha_motoria)
                    model.Add(sum(termini_motoria) == 0).OnlyEnforceIf(ha_motoria.Not())
                    model.Add(sum(termini_esclusa) >= 1).OnlyEnforceIf(ha_esclusa)
                    model.Add(sum(termini_esclusa) == 0).OnlyEnforceIf(ha_esclusa.Not())
                    model.Add(ha_motoria + ha_esclusa <= 1)

    # ---- Obiettivo: preferenze come termini pesati -------------------
    termini_obiettivo = []

    for a in assegnazioni:
        termini_obiettivo.append(PESO_ORA_NON_PIAZZATA * mancanti[a["id"]])

    assegnazioni_per_docente: dict[int, list[dict]] = defaultdict(list)
    for a in assegnazioni:
        assegnazioni_per_docente[a["teacher_id"]].append(a)

    for p in preferenze:
        teacher_id = p["teacher_id"]
        tipo = p["tipo"]
        dettaglio = p.get("dettaglio")
        assegnazioni_docente = assegnazioni_per_docente.get(teacher_id, [])

        if tipo == "giorno_libero":
            for giorno in _giorni_da_dettaglio(dettaglio):
                termini = [
                    x[(a["id"], s["id"])]
                    for a in assegnazioni_docente
                    for s in slots_by_day.get(giorno, [])
                    if (a["id"], s["id"]) in x
                ]
                if termini:
                    termini_obiettivo.append(PESO_GIORNO_LIBERO * sum(termini))

        elif tipo in ("no_prima_ora", "no_ultima_ora"):
            peso = PESO_NO_PRIMA_ULTIMA_ORA
            for giorno, slots_giorno in slots_by_day.items():
                if not _giorno_compatibile(dettaglio, giorno):
                    continue
                ora_bersaglio = prima_ora_del_giorno[giorno] if tipo == "no_prima_ora" else ultima_ora_del_giorno[giorno]
                termini = [
                    x[(a["id"], s["id"])]
                    for a in assegnazioni_docente
                    for s in slots_giorno
                    if s["ora"] == ora_bersaglio and (a["id"], s["id"]) in x
                ]
                if termini:
                    termini_obiettivo.append(peso * sum(termini))

        elif tipo == "no_ora_specifica":
            ora_richiesta = _ora_da_dettaglio(dettaglio)
            if ora_richiesta is not None:
                for giorno, slots_giorno in slots_by_day.items():
                    if not _giorno_compatibile(dettaglio, giorno):
                        continue
                    termini = [
                        x[(a["id"], s["id"])]
                        for a in assegnazioni_docente
                        for s in slots_giorno
                        if s["ora"] == ora_richiesta and (a["id"], s["id"]) in x
                    ]
                    if termini:
                        termini_obiettivo.append(PESO_NO_ORA_SPECIFICA * sum(termini))

        elif tipo == "evita_buchi":
            # Approssimazione: penalizza gli slot INTERNI (ne' il primo ne'
            # l'ultimo della griglia del giorno) lasciati liberi in un
            # giorno in cui il docente lavora comunque. Non e' identica
            # alla formula esatta usata per il conteggio finale (vedi
            # conta_violazioni), ma guida il solver a preferire orari
            # compatti. Il numero mostrato all'utente resta comunque
            # quello calcolato esattamente a posteriori.
            for giorno, slots_giorno in slots_by_day.items():
                if len(slots_giorno) < 3:
                    continue
                usati = []
                for s in slots_giorno:
                    termini_slot = [x[(a["id"], s["id"])] for a in assegnazioni_docente if (a["id"], s["id"]) in x]
                    if termini_slot:
                        usati.append((s, sum(termini_slot)))
                if len(usati) < 3:
                    continue
                interni = usati[1:-1]
                lavora_quel_giorno = model.NewBoolVar(f"lavora_{teacher_id}_{giorno}")
                tutti_termini = [espr for _, espr in usati]
                model.Add(sum(tutti_termini) >= 1).OnlyEnforceIf(lavora_quel_giorno)
                model.Add(sum(tutti_termini) == 0).OnlyEnforceIf(lavora_quel_giorno.Not())
                for s, espr in interni:
                    libero = model.NewBoolVar(f"buco_{teacher_id}_{s['id']}")
                    model.Add(espr == 0).OnlyEnforceIf(libero)
                    model.Add(espr >= 1).OnlyEnforceIf(libero.Not())
                    penalita_attiva = model.NewBoolVar(f"bucopenalita_{teacher_id}_{s['id']}")
                    model.AddBoolAnd([libero, lavora_quel_giorno]).OnlyEnforceIf(penalita_attiva)
                    model.AddBoolOr([libero.Not(), lavora_quel_giorno.Not()]).OnlyEnforceIf(penalita_attiva.Not())
                    termini_obiettivo.append(PESO_EVITA_BUCHI * penalita_attiva)

    model.Minimize(sum(termini_obiettivo))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max_seconds
    solver.parameters.num_search_workers = 8
    stato = solver.Solve(model)

    stato_nome = solver.StatusName(stato)
    entries_generate: list[dict] = []
    ore_totali = sum(ore_da_generare_per_assegnazione.values())
    ore_assegnate = 0

    if stato in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for a in assegnazioni:
            a_id = a["id"]
            for s_id in slot_ids_validi_per_assegnazione[a_id]:
                if solver.Value(x[(a_id, s_id)]) == 1:
                    entries_generate.append(
                        {
                            "teacher_id": a["teacher_id"],
                            "class_id": a["class_id"],
                            "subject_id": a["subject_id"],
                            "time_slot_id": s_id,
                        }
                    )
                    ore_assegnate += 1

    tutte_le_entries = manuali_entries + entries_generate
    preferenze_violate, dettagli_violazioni = conta_violazioni(tutte_le_entries, slot_by_id, slots_by_day, preferenze)

    return {
        "riuscito": ore_assegnate == ore_totali and stato in (cp_model.OPTIMAL, cp_model.FEASIBLE),
        "entries": entries_generate,
        "preferenzeViolate": preferenze_violate,
        "preferenzeValutabili": len(preferenze),
        "dettagliViolazioni": dettagli_violazioni,
        "oreAssegnate": ore_assegnate,
        "oreTotali": ore_totali,
        "stato": stato_nome,
    }
