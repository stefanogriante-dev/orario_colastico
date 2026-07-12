import type { Modalita, Preferenza, TimeSlot } from "./types";

// ============================================================
// Motore di generazione automatica dell'orario.
//
// Euristica: tentativi ripetuti (random-restart) con piazzamento
// goloso (greedy) delle ore da assegnare, ordinate casualmente ad
// ogni tentativo, scegliendo per ciascuna il time slot libero con
// la penalità più bassa rispetto alle preferenze dei docenti.
// Non è un solver ottimo garantito, ma per un problema di questa
// scala (poche classi, poche decine di slot) converge rapidamente
// a soluzioni complete e ragionevoli entro il tempo limite.
//
// Vincoli rigidi (mai violati): un docente non può avere due ore
// nello stesso slot in classi diverse; una classe non può avere
// due lezioni nello stesso slot; le ore manuali sono fisse e non
// vengono mai spostate o sovrascritte.
// ============================================================

export interface AssegnazioneInput {
  id: number;
  teacher_id: number;
  class_id: number;
  subject_id: number;
  ore_settimanali: number;
  modalita: Modalita;
}

export interface EntrataFissa {
  teacher_id: number;
  class_id: number;
  time_slot_id: number;
}

export interface EntrataGenerata {
  teacher_id: number;
  class_id: number;
  subject_id: number;
  time_slot_id: number;
}

export interface GeneraOrarioInput {
  timeSlots: TimeSlot[];
  assegnazioni: AssegnazioneInput[];
  entrateManuali: EntrataFissa[];
  preferenze: Preferenza[];
  scadenza: number; // Date.now() + millisecondi disponibili
}

export interface GeneraOrarioOutput {
  riuscito: boolean;
  entries: EntrataGenerata[];
  preferenzeViolate: number;
  preferenzeValutabili: number;
  tentativi: number;
}

interface Unita {
  unitaId: number;
  assegnazioneId: number;
  teacherId: number;
  classId: number;
  subjectId: number;
  modalita: Modalita;
}

function mescola<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generaOrario(input: GeneraOrarioInput): GeneraOrarioOutput {
  const { timeSlots, assegnazioni, entrateManuali, preferenze, scadenza } = input;

  const unitaBase: Unita[] = [];
  let contatore = 0;
  for (const a of assegnazioni) {
    for (let i = 0; i < a.ore_settimanali; i++) {
      unitaBase.push({
        unitaId: contatore++,
        assegnazioneId: a.id,
        teacherId: a.teacher_id,
        classId: a.class_id,
        subjectId: a.subject_id,
        modalita: a.modalita,
      });
    }
  }

  const slotById = new Map(timeSlots.map((s) => [s.id, s]));
  const slotsByDay = new Map<number, TimeSlot[]>();
  for (const s of timeSlots) {
    if (!slotsByDay.has(s.giorno)) slotsByDay.set(s.giorno, []);
    slotsByDay.get(s.giorno)!.push(s);
  }
  for (const arr of slotsByDay.values()) arr.sort((x, y) => x.ora - y.ora);

  const prefsByTeacher = new Map<number, Preferenza[]>();
  for (const p of preferenze) {
    if (!prefsByTeacher.has(p.teacher_id)) prefsByTeacher.set(p.teacher_id, []);
    prefsByTeacher.get(p.teacher_id)!.push(p);
  }

  const teacherBusyFisso = new Set<string>();
  const classBusyFisso = new Set<string>();
  for (const e of entrateManuali) {
    teacherBusyFisso.add(`${e.teacher_id}-${e.time_slot_id}`);
    classBusyFisso.add(`${e.class_id}-${e.time_slot_id}`);
  }

  let migliore: { piano: Map<number, number>; violazioni: number } | null = null;
  let tentativi = 0;

  // Se non ci sono unità da piazzare (nessuna assegnazione), consideriamo riuscito con 0 ore
  if (unitaBase.length === 0) {
    return { riuscito: true, entries: [], preferenzeViolate: 0, preferenzeValutabili: 0, tentativi: 0 };
  }

  while (Date.now() < scadenza) {
    tentativi++;
    const ordine = mescola(unitaBase);
    const teacherBusy = new Set(teacherBusyFisso);
    const classBusy = new Set(classBusyFisso);
    const piano = new Map<number, number>();
    const orePerTeacherGiorno = new Map<string, number[]>();
    const orePerAssegnazioneGiorno = new Map<string, number[]>();

    let completato = true;

    for (const u of ordine) {
      let miglioreSlot: TimeSlot | null = null;
      let migliorePenalita = Infinity;

      for (const slot of timeSlots) {
        const keyT = `${u.teacherId}-${slot.id}`;
        const keyC = `${u.classId}-${slot.id}`;
        if (teacherBusy.has(keyT) || classBusy.has(keyC)) continue;

        const penalita = calcolaPenalita(u, slot, prefsByTeacher.get(u.teacherId) ?? [], orePerTeacherGiorno, orePerAssegnazioneGiorno, slotsByDay);
        // piccola componente casuale per non scegliere sempre lo stesso slot a parità di punteggio
        const penalitaConRumore = penalita + Math.random() * 0.1;
        if (penalitaConRumore < migliorePenalita) {
          migliorePenalita = penalitaConRumore;
          miglioreSlot = slot;
        }
      }

      if (!miglioreSlot) {
        completato = false;
        break;
      }

      teacherBusy.add(`${u.teacherId}-${miglioreSlot.id}`);
      classBusy.add(`${u.classId}-${miglioreSlot.id}`);
      piano.set(u.unitaId, miglioreSlot.id);

      const chiaveGiorno = `${u.teacherId}-${miglioreSlot.giorno}`;
      if (!orePerTeacherGiorno.has(chiaveGiorno)) orePerTeacherGiorno.set(chiaveGiorno, []);
      orePerTeacherGiorno.get(chiaveGiorno)!.push(miglioreSlot.ora);

      const chiaveAssegnazioneGiorno = `${u.assegnazioneId}-${miglioreSlot.giorno}`;
      if (!orePerAssegnazioneGiorno.has(chiaveAssegnazioneGiorno)) orePerAssegnazioneGiorno.set(chiaveAssegnazioneGiorno, []);
      orePerAssegnazioneGiorno.get(chiaveAssegnazioneGiorno)!.push(miglioreSlot.ora);
    }

    if (completato) {
      // ci fermiamo alla prima combinazione che riempie tutte le celle,
      // senza continuare a cercare una soluzione con meno violazioni
      const violazioni = contaViolazioni(unitaBase, piano, slotById, prefsByTeacher, slotsByDay);
      migliore = { piano, violazioni };
      break;
    }
  }

  if (!migliore) {
    return { riuscito: false, entries: [], preferenzeViolate: 0, preferenzeValutabili: preferenze.length, tentativi };
  }

  const entries: EntrataGenerata[] = unitaBase.map((u) => ({
    teacher_id: u.teacherId,
    class_id: u.classId,
    subject_id: u.subjectId,
    time_slot_id: migliore!.piano.get(u.unitaId)!,
  }));

  return {
    riuscito: true,
    entries,
    preferenzeViolate: migliore.violazioni,
    preferenzeValutabili: preferenze.length,
    tentativi,
  };
}

function calcolaPenalita(
  u: Unita,
  slot: TimeSlot,
  prefs: Preferenza[],
  orePerTeacherGiorno: Map<string, number[]>,
  orePerAssegnazioneGiorno: Map<string, number[]>,
  slotsByDay: Map<number, TimeSlot[]>
): number {
  let penalita = 0;
  const oreGiorno = slotsByDay.get(slot.giorno) ?? [];
  const primaOra = oreGiorno[0]?.ora;
  const ultimaOra = oreGiorno[oreGiorno.length - 1]?.ora;

  for (const p of prefs) {
    if (p.tipo === "giorno_libero" && p.dettaglio) {
      const giorno = (p.dettaglio as { giorno?: number }).giorno;
      if (giorno === slot.giorno) penalita += 50;
    }
    if (p.tipo === "no_prima_ora" && slot.ora === primaOra) penalita += 20;
    if (p.tipo === "no_ultima_ora" && slot.ora === ultimaOra) penalita += 20;
  }

  const chiaveGiorno = `${u.teacherId}-${slot.giorno}`;
  const oreEsistentiTeacher = orePerTeacherGiorno.get(chiaveGiorno) ?? [];
  const haPreferenzaBuchi = prefs.some((p) => p.tipo === "evita_buchi");
  if (haPreferenzaBuchi && oreEsistentiTeacher.length > 0) {
    const adiacente = oreEsistentiTeacher.some((o) => Math.abs(o - slot.ora) === 1);
    if (!adiacente) penalita += 15;
  }

  const chiaveAssegnazioneGiorno = `${u.assegnazioneId}-${slot.giorno}`;
  const oreEsistentiAssegnazione = orePerAssegnazioneGiorno.get(chiaveAssegnazioneGiorno) ?? [];
  if (u.modalita === "coppie" && oreEsistentiAssegnazione.length > 0) {
    const adiacente = oreEsistentiAssegnazione.some((o) => Math.abs(o - slot.ora) === 1);
    if (!adiacente) penalita += 10;
  }
  if (u.modalita === "separate" && oreEsistentiAssegnazione.length > 0) {
    const adiacente = oreEsistentiAssegnazione.some((o) => Math.abs(o - slot.ora) === 1);
    if (adiacente) penalita += 10;
  }

  return penalita;
}

function contaViolazioni(
  unita: Unita[],
  piano: Map<number, number>,
  slotById: Map<number, TimeSlot>,
  prefsByTeacher: Map<number, Preferenza[]>,
  slotsByDay: Map<number, TimeSlot[]>
): number {
  let violazioni = 0;
  for (const [teacherId, prefs] of prefsByTeacher.entries()) {
    const oreDocente = unita
      .filter((u) => u.teacherId === teacherId)
      .map((u) => slotById.get(piano.get(u.unitaId)!))
      .filter((s): s is TimeSlot => Boolean(s));

    for (const p of prefs) {
      if (p.tipo === "giorno_libero" && p.dettaglio) {
        const giorno = (p.dettaglio as { giorno?: number }).giorno;
        if (oreDocente.some((s) => s.giorno === giorno)) violazioni++;
      }

      if (p.tipo === "no_prima_ora") {
        for (const s of oreDocente) {
          const oreGiornoGriglia = slotsByDay.get(s.giorno) ?? [];
          const primaOra = oreGiornoGriglia[0]?.ora;
          if (s.ora === primaOra) violazioni++;
        }
      }

      if (p.tipo === "no_ultima_ora") {
        for (const s of oreDocente) {
          const oreGiornoGriglia = slotsByDay.get(s.giorno) ?? [];
          const ultimaOra = oreGiornoGriglia[oreGiornoGriglia.length - 1]?.ora;
          if (s.ora === ultimaOra) violazioni++;
        }
      }

      if (p.tipo === "evita_buchi") {
        const giorniConOre = new Map<number, number[]>();
        for (const s of oreDocente) {
          if (!giorniConOre.has(s.giorno)) giorniConOre.set(s.giorno, []);
          giorniConOre.get(s.giorno)!.push(s.ora);
        }
        for (const ore of giorniConOre.values()) {
          const ordinate = [...ore].sort((a, b) => a - b);
          for (let i = 1; i < ordinate.length; i++) {
            if (ordinate[i] - ordinate[i - 1] > 1) violazioni++;
          }
        }
      }
    }
  }
  return violazioni;
}

// ============================================================
// Wrapper "a step": esegue generaOrario a piccoli blocchi di tempo,
// lasciando respirare il browser tra un blocco e l'altro (utile per
// non bloccare l'interfaccia durante una ricerca fino a 30 secondi)
// e permettendo di riportare un progresso.
// ============================================================

export interface ProgressoGenerazione {
  tentativiTotali: number;
  tempoTrascorsoMs: number;
  migliorViolazioni: number | null;
}

export async function generaOrarioProgressivo(
  input: Omit<GeneraOrarioInput, "scadenza"> & { scadenzaTotale: number },
  onProgress?: (p: ProgressoGenerazione) => void
): Promise<GeneraOrarioOutput> {
  const inizio = Date.now();
  const CHUNK_MS = 200;
  let migliore: GeneraOrarioOutput | null = null;
  let tentativiTotali = 0;

  while (Date.now() < input.scadenzaTotale) {
    const scadenzaChunk = Math.min(Date.now() + CHUNK_MS, input.scadenzaTotale);
    const risultato = generaOrario({ ...input, scadenza: scadenzaChunk });
    tentativiTotali += risultato.tentativi;

    if (risultato.riuscito) {
      // ci fermiamo alla prima combinazione completa trovata (anche a blocchi):
      // non continuiamo a cercarne una con meno violazioni di preferenze
      migliore = risultato;
    }

    onProgress?.({
      tentativiTotali,
      tempoTrascorsoMs: Date.now() - inizio,
      migliorViolazioni: migliore ? migliore.preferenzeViolate : null,
    });

    if (migliore) break;

    // lascia respirare l'interfaccia prima del prossimo blocco
    await new Promise((r) => setTimeout(r, 0));
  }

  if (migliore) {
    return { ...migliore, tentativi: tentativiTotali };
  }
  return {
    riuscito: false,
    entries: [],
    preferenzeViolate: 0,
    preferenzeValutabili: input.preferenze.length,
    tentativi: tentativiTotali,
  };
}
