import type { Modalita, Preferenza, TimeSlot } from "./types";

// ============================================================
// Motore di generazione automatica dell'orario.
//
// Euristica: tentativi ripetuti (random-restart) con piazzamento
// goloso (greedy) delle ore da assegnare. La generazione procede
// una classe alla volta: quando una classe viene completata, le
// sue ore restano "bloccate" e si passa alla successiva provando
// piu' combinazioni; se una classe non si completa nonostante piu'
// tentativi, si riparte da capo con un nuovo ordine delle classi.
//
// Vincoli rigidi (mai violati): un docente non può avere due ore
// nello stesso slot in classi diverse; una classe non può avere
// due lezioni nello stesso slot; le ore manuali sono fisse e non
// vengono mai spostate o sovrascritte.
//
// La modalita' "a coppie" e' un vincolo strutturale: le ore di una
// assegnazione vengono raggruppate in blocchi da 2 ore adiacenti e
// piazzate atomicamente insieme (stesso giorno, ore consecutive
// libere sia per il docente che per la classe), non un semplice
// bonus di punteggio. La modalita' "separate" evita l'adiacenza
// quando possibile, con un secondo tentativo permissivo se non ci
// sono alternative.
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
  subject_id: number;
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
  // Vincolo rigido: numero massimo di ore di lezione al giorno per ciascun
  // docente (somma su tutte le classi). Se un docente non compare nella
  // mappa si usa il limite di default (5).
  limiteOreGiornoPerTeacher?: Map<number, number>;
  scadenza: number; // Date.now() + millisecondi disponibili
}

const LIMITE_ORE_GIORNO_DEFAULT = 5;

function limiteOreGiorno(teacherId: number, limiti: Map<number, number> | undefined): number {
  return limiti?.get(teacherId) ?? LIMITE_ORE_GIORNO_DEFAULT;
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

type Compito =
  | { tipo: "singola"; unita: Unita }
  | { tipo: "coppia"; unitaA: Unita; unitaB: Unita };

function mescola<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Raggruppa le ore di ciascuna assegnazione: per modalita' "coppie" le
// accoppia in blocchi da 2 ore da piazzare atomicamente adiacenti, con
// un'eventuale ora singola avanzata se il totale e' dispari. Le altre
// modalita' restano ore singole indipendenti.
function costruisciCompiti(unitaClasse: Unita[]): Compito[] {
  const perAssegnazione = new Map<number, Unita[]>();
  for (const u of unitaClasse) {
    if (!perAssegnazione.has(u.assegnazioneId)) perAssegnazione.set(u.assegnazioneId, []);
    perAssegnazione.get(u.assegnazioneId)!.push(u);
  }

  const compiti: Compito[] = [];
  for (const unita of perAssegnazione.values()) {
    if (unita.length > 0 && unita[0].modalita === "coppie") {
      let i = 0;
      for (; i + 1 < unita.length; i += 2) {
        compiti.push({ tipo: "coppia", unitaA: unita[i], unitaB: unita[i + 1] });
      }
      if (i < unita.length) {
        compiti.push({ tipo: "singola", unita: unita[i] });
      }
    } else {
      for (const u of unita) compiti.push({ tipo: "singola", unita: u });
    }
  }
  return compiti;
}

export function generaOrario(input: GeneraOrarioInput): GeneraOrarioOutput {
  const { timeSlots, assegnazioni, entrateManuali, preferenze, limiteOreGiornoPerTeacher, scadenza } = input;

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

  // Le ore manuali sono fisse: contribuiscono all'occupazione del docente,
  // all'occupazione della classe in cui si trovano, e vanno sottratte dalle
  // ore da generare per la loro stessa assegnazione.
  const assegnazioneIndex = new Map<string, number>();
  for (const a of assegnazioni) {
    assegnazioneIndex.set(`${a.teacher_id}-${a.class_id}-${a.subject_id}`, a.id);
  }

  const teacherBusyFisso = new Set<string>();
  const classBusyFissoPerClasse = new Map<number, Set<number>>();
  const oreManualiPerAssegnazione = new Map<string, number>();
  // Ore già occupate dal docente nella stessa classe, per giorno (vincolo: max 2 ore/giorno)
  const teacherClasseGiornoManuale = new Map<string, number>();
  // Ore già occupate dalla stessa materia/classe/docente, per giorno (vincolo: se ripetuta, adiacente)
  const assegnazioneGiornoManuale = new Map<string, number[]>();
  // Ore già occupate dal docente in totale (su tutte le classi), per giorno
  // (vincolo: max ore/giorno per docente, ed evita_buchi)
  const orePerTeacherGiornoManuale = new Map<string, number[]>();
  for (const e of entrateManuali) {
    teacherBusyFisso.add(`${e.teacher_id}-${e.time_slot_id}`);
    if (!classBusyFissoPerClasse.has(e.class_id)) classBusyFissoPerClasse.set(e.class_id, new Set());
    classBusyFissoPerClasse.get(e.class_id)!.add(e.time_slot_id);
    const chiaveAss = `${e.teacher_id}-${e.class_id}-${e.subject_id}`;
    oreManualiPerAssegnazione.set(chiaveAss, (oreManualiPerAssegnazione.get(chiaveAss) ?? 0) + 1);

    const slotManuale = slotById.get(e.time_slot_id);
    if (slotManuale) {
      const chiaveTCG = `${e.teacher_id}-${e.class_id}-${slotManuale.giorno}`;
      teacherClasseGiornoManuale.set(chiaveTCG, (teacherClasseGiornoManuale.get(chiaveTCG) ?? 0) + 1);

      const assegnazioneId = assegnazioneIndex.get(chiaveAss);
      if (assegnazioneId !== undefined) {
        const chiaveAG = `${assegnazioneId}-${slotManuale.giorno}`;
        if (!assegnazioneGiornoManuale.has(chiaveAG)) assegnazioneGiornoManuale.set(chiaveAG, []);
        assegnazioneGiornoManuale.get(chiaveAG)!.push(slotManuale.ora);
      }

      const chiaveGiornoDocente = `${e.teacher_id}-${slotManuale.giorno}`;
      if (!orePerTeacherGiornoManuale.has(chiaveGiornoDocente)) orePerTeacherGiornoManuale.set(chiaveGiornoDocente, []);
      orePerTeacherGiornoManuale.get(chiaveGiornoDocente)!.push(slotManuale.ora);
    }
  }

  // Le unita' da piazzare, raggruppate per classe e poi in "compiti"
  // (singole ore o coppie atomiche). La generazione procede una classe
  // alla volta, bloccando le ore di una classe completata prima di
  // passare alla successiva.
  const classIds = Array.from(new Set(assegnazioni.map((a) => a.class_id)));
  const compitiPerClasse = new Map<number, Compito[]>();
  let contatoreGlobale = 0;
  for (const classId of classIds) {
    const unita: Unita[] = [];
    for (const a of assegnazioni.filter((x) => x.class_id === classId)) {
      const chiaveAss = `${a.teacher_id}-${a.class_id}-${a.subject_id}`;
      const oreGiaManuali = oreManualiPerAssegnazione.get(chiaveAss) ?? 0;
      const oreDaGenerare = Math.max(0, a.ore_settimanali - oreGiaManuali);
      for (let i = 0; i < oreDaGenerare; i++) {
        unita.push({
          unitaId: contatoreGlobale++,
          assegnazioneId: a.id,
          teacherId: a.teacher_id,
          classId: a.class_id,
          subjectId: a.subject_id,
          modalita: a.modalita,
        });
      }
    }
    compitiPerClasse.set(classId, costruisciCompiti(unita));
  }

  if (classIds.length === 0) {
    return { riuscito: true, entries: [], preferenzeViolate: 0, preferenzeValutabili: 0, tentativi: 0 };
  }

  let tentativi = 0;
  // Quanti riordini diversi provare per UNA classe (a parita' di classi gia'
  // bloccate) prima di arrendersi e ripartire da capo con una combinazione
  // completamente nuova (incluso un nuovo ordine delle classi).
  const MAX_TENTATIVI_PER_CLASSE = 300;

  while (Date.now() < scadenza) {
    tentativi++;
    const ordineClassi = mescola(classIds);

    // Stato "confermato" del tentativo esterno corrente: si aggiorna solo
    // quando una classe viene completata con successo e quindi bloccata.
    let teacherBusy = new Set(teacherBusyFisso);
    let pianoGlobale = new Map<number, number>();
    let orePerTeacherGiorno = clonaMappaOre(orePerTeacherGiornoManuale);
    let orePerAssegnazioneGiorno = clonaMappaOre(assegnazioneGiornoManuale);
    let orePerTeacherClasseGiorno = new Map<string, number>(teacherClasseGiornoManuale);

    let tuttoCompletato = true;

    for (const classId of ordineClassi) {
      const compitiClasse = compitiPerClasse.get(classId) ?? [];
      const classBusyFissa = classBusyFissoPerClasse.get(classId) ?? new Set<number>();

      let classeCompletata = false;

      for (
        let tentativoClasse = 0;
        tentativoClasse < MAX_TENTATIVI_PER_CLASSE && Date.now() < scadenza;
        tentativoClasse++
      ) {
        tentativi++;
        const provaTeacherBusy = new Set(teacherBusy);
        const provaClassBusy = new Set(classBusyFissa);
        const provaPiano = new Map<number, number>();
        const provaOrePerTeacherGiorno = clonaMappaOre(orePerTeacherGiorno);
        const provaOrePerAssegnazioneGiorno = clonaMappaOre(orePerAssegnazioneGiorno);
        const provaOrePerTeacherClasseGiorno = new Map<string, number>(orePerTeacherClasseGiorno);

        const compitiShuffle = mescola(compitiClasse);
        let classeOk = true;

        for (const compito of compitiShuffle) {
          if (compito.tipo === "singola") {
            const esito = piazzaSingola(
              compito.unita,
              timeSlots,
              slotsByDay,
              provaTeacherBusy,
              provaClassBusy,
              prefsByTeacher.get(compito.unita.teacherId) ?? [],
              provaOrePerTeacherGiorno,
              provaOrePerAssegnazioneGiorno,
              provaOrePerTeacherClasseGiorno,
              limiteOreGiornoPerTeacher
            );
            if (!esito) {
              classeOk = false;
              break;
            }
            registraPiazzamento(
              compito.unita,
              esito,
              provaTeacherBusy,
              provaClassBusy,
              provaPiano,
              provaOrePerTeacherGiorno,
              provaOrePerAssegnazioneGiorno,
              provaOrePerTeacherClasseGiorno
            );
          } else {
            const esito = piazzaCoppia(
              compito.unitaA,
              slotsByDay,
              provaTeacherBusy,
              provaClassBusy,
              prefsByTeacher.get(compito.unitaA.teacherId) ?? [],
              provaOrePerTeacherGiorno,
              provaOrePerTeacherClasseGiorno,
              provaOrePerAssegnazioneGiorno,
              limiteOreGiornoPerTeacher
            );
            if (!esito) {
              classeOk = false;
              break;
            }
            registraPiazzamento(
              compito.unitaA,
              esito[0],
              provaTeacherBusy,
              provaClassBusy,
              provaPiano,
              provaOrePerTeacherGiorno,
              provaOrePerAssegnazioneGiorno,
              provaOrePerTeacherClasseGiorno
            );
            registraPiazzamento(
              compito.unitaB,
              esito[1],
              provaTeacherBusy,
              provaClassBusy,
              provaPiano,
              provaOrePerTeacherGiorno,
              provaOrePerAssegnazioneGiorno,
              provaOrePerTeacherClasseGiorno
            );
          }
        }

        if (classeOk) {
          // Questa combinazione completa la classe: la blocchiamo, cioe'
          // confermiamo lo stato provvisorio come nuovo stato "ufficiale"
          // del tentativo esterno, senza toccare le classi gia' bloccate.
          teacherBusy = provaTeacherBusy;
          for (const [unitaId, slotId] of provaPiano) pianoGlobale.set(unitaId, slotId);
          orePerTeacherGiorno = provaOrePerTeacherGiorno;
          orePerAssegnazioneGiorno = provaOrePerAssegnazioneGiorno;
          orePerTeacherClasseGiorno = provaOrePerTeacherClasseGiorno;
          classeCompletata = true;
          break;
        }
      }

      if (!classeCompletata) {
        // Questa classe non si e' completata nonostante piu' combinazioni:
        // abbandoniamo l'intero tentativo e ripartiamo da capo (nuovo
        // ordine delle classi, nuove combinazioni per tutte).
        tuttoCompletato = false;
        break;
      }
    }

    if (tuttoCompletato) {
      const tutteLeUnita: Unita[] = [];
      for (const compiti of compitiPerClasse.values()) {
        for (const c of compiti) {
          if (c.tipo === "singola") tutteLeUnita.push(c.unita);
          else tutteLeUnita.push(c.unitaA, c.unitaB);
        }
      }
      const violazioni = contaViolazioni(tutteLeUnita, pianoGlobale, slotById, prefsByTeacher, slotsByDay);
      const entries: EntrataGenerata[] = tutteLeUnita.map((u) => ({
        teacher_id: u.teacherId,
        class_id: u.classId,
        subject_id: u.subjectId,
        time_slot_id: pianoGlobale.get(u.unitaId)!,
      }));
      return {
        riuscito: true,
        entries,
        preferenzeViolate: violazioni,
        preferenzeValutabili: preferenze.length,
        tentativi,
      };
    }
  }

  return { riuscito: false, entries: [], preferenzeViolate: 0, preferenzeValutabili: preferenze.length, tentativi };
}

function clonaMappaOre(mappa: Map<string, number[]>): Map<string, number[]> {
  const clone = new Map<string, number[]>();
  for (const [chiave, valori] of mappa) clone.set(chiave, [...valori]);
  return clone;
}

function registraPiazzamento(
  u: Unita,
  slot: TimeSlot,
  teacherBusy: Set<string>,
  classBusy: Set<number>,
  piano: Map<number, number>,
  orePerTeacherGiorno: Map<string, number[]>,
  orePerAssegnazioneGiorno: Map<string, number[]>,
  orePerTeacherClasseGiorno: Map<string, number>
) {
  teacherBusy.add(`${u.teacherId}-${slot.id}`);
  classBusy.add(slot.id);
  piano.set(u.unitaId, slot.id);

  const chiaveGiorno = `${u.teacherId}-${slot.giorno}`;
  if (!orePerTeacherGiorno.has(chiaveGiorno)) orePerTeacherGiorno.set(chiaveGiorno, []);
  orePerTeacherGiorno.get(chiaveGiorno)!.push(slot.ora);

  const chiaveAssegnazioneGiorno = `${u.assegnazioneId}-${slot.giorno}`;
  if (!orePerAssegnazioneGiorno.has(chiaveAssegnazioneGiorno)) orePerAssegnazioneGiorno.set(chiaveAssegnazioneGiorno, []);
  orePerAssegnazioneGiorno.get(chiaveAssegnazioneGiorno)!.push(slot.ora);

  const chiaveTCG = `${u.teacherId}-${u.classId}-${slot.giorno}`;
  orePerTeacherClasseGiorno.set(chiaveTCG, (orePerTeacherClasseGiorno.get(chiaveTCG) ?? 0) + 1);
}

// Vincoli generici rigidi, sempre validi indipendentemente dalla modalita':
// (1) un docente non può avere più di 2 ore al giorno nella stessa classe;
// (2) se la stessa materia (stesso docente/classe) compare più volte nello
//     stesso giorno, le ore devono essere consecutive (mai "sparse").
function passaVincoliGenerici(
  u: Unita,
  slot: TimeSlot,
  orePerTeacherClasseGiorno: Map<string, number>,
  orePerAssegnazioneGiorno: Map<string, number[]>
): boolean {
  const chiaveTCG = `${u.teacherId}-${u.classId}-${slot.giorno}`;
  const oreEsistentiTCG = orePerTeacherClasseGiorno.get(chiaveTCG) ?? 0;
  if (oreEsistentiTCG >= 2) return false;

  const chiaveAG = `${u.assegnazioneId}-${slot.giorno}`;
  const oreEsistentiAG = orePerAssegnazioneGiorno.get(chiaveAG) ?? [];
  if (oreEsistentiAG.length > 0) {
    const adiacente = oreEsistentiAG.some((o) => Math.abs(o - slot.ora) === 1);
    if (!adiacente) return false;
  }

  return true;
}

// Estrae l'elenco di giorni da un dettaglio preferenza, qualunque sia il
// formato in cui è salvato: quello nuovo a checkbox multiple
// (dettaglio.giorni: number[]) o quello legacy a giorno singolo
// (dettaglio.giorno). Ritorna un array vuoto se il dettaglio è assente
// o non contiene informazioni sul giorno.
function giorniDaDettaglio(dettaglio: Record<string, unknown> | null): number[] {
  if (!dettaglio) return [];
  const d = dettaglio as { giorno?: number; giorni?: number[] };
  if (Array.isArray(d.giorni)) return d.giorni;
  if (d.giorno !== undefined && d.giorno !== null) return [d.giorno];
  return [];
}

// Le preferenze "no_prima_ora" e "no_ultima_ora" possono valere per uno o
// più giorni specifici (checkbox) o per tutti i giorni ("Sempre",
// rappresentato da dettaglio assente/null oppure senza giorni indicati).
function giornoCompatibile(p: Preferenza, giorno: number): boolean {
  const giorni = giorniDaDettaglio(p.dettaglio);
  if (giorni.length === 0) return true; // "sempre"
  return giorni.includes(giorno);
}

// Penalita' di uno slot basata solo sulle preferenze del docente (giorno
// libero, no prima/ultima ora, evita buchi). Usata sia per le ore singole
// sia per ciascuna meta' di una coppia.
function penalitaPreferenzeSlot(
  teacherId: number,
  slot: TimeSlot,
  prefs: Preferenza[],
  orePerTeacherGiorno: Map<string, number[]>,
  slotsByDay: Map<number, TimeSlot[]>
): number {
  let penalita = 0;
  const oreGiorno = slotsByDay.get(slot.giorno) ?? [];
  const primaOra = oreGiorno[0]?.ora;
  const ultimaOra = oreGiorno[oreGiorno.length - 1]?.ora;

  for (const p of prefs) {
    if (p.tipo === "giorno_libero" && giorniDaDettaglio(p.dettaglio).includes(slot.giorno)) {
      penalita += 50;
    }
    if (p.tipo === "no_prima_ora" && slot.ora === primaOra && giornoCompatibile(p, slot.giorno)) {
      penalita += 20;
    }
    if (p.tipo === "no_ultima_ora" && slot.ora === ultimaOra && giornoCompatibile(p, slot.giorno)) {
      penalita += 20;
    }
  }

  const chiaveGiorno = `${teacherId}-${slot.giorno}`;
  const oreEsistentiTeacher = orePerTeacherGiorno.get(chiaveGiorno) ?? [];
  const haPreferenzaBuchi = prefs.some((p) => p.tipo === "evita_buchi");
  if (haPreferenzaBuchi && oreEsistentiTeacher.length > 0) {
    const adiacente = oreEsistentiTeacher.some((o) => Math.abs(o - slot.ora) === 1);
    if (!adiacente) penalita += 15;
  }

  return penalita;
}

// Piazza una singola ora. Per modalita' "separate" evita, quando possibile,
// gli slot adiacenti a un'altra ora della stessa assegnazione nello stesso
// giorno: prima prova solo slot non adiacenti, e se nessuno e' disponibile
// ripiega su tutti gli slot liberi (meglio un'ora vicina che nessuna ora).
function piazzaSingola(
  u: Unita,
  timeSlots: TimeSlot[],
  slotsByDay: Map<number, TimeSlot[]>,
  teacherBusy: Set<string>,
  classBusy: Set<number>,
  prefs: Preferenza[],
  orePerTeacherGiorno: Map<string, number[]>,
  orePerAssegnazioneGiorno: Map<string, number[]>,
  orePerTeacherClasseGiorno: Map<string, number>,
  limiteOreGiornoPerTeacher: Map<number, number> | undefined
): TimeSlot | null {
  const limiteGiorno = limiteOreGiorno(u.teacherId, limiteOreGiornoPerTeacher);
  const liberi = timeSlots.filter(
    (slot) =>
      !teacherBusy.has(`${u.teacherId}-${slot.id}`) &&
      !classBusy.has(slot.id) &&
      passaVincoliGenerici(u, slot, orePerTeacherClasseGiorno, orePerAssegnazioneGiorno) &&
      (orePerTeacherGiorno.get(`${u.teacherId}-${slot.giorno}`) ?? []).length < limiteGiorno
  );
  if (liberi.length === 0) return null;

  function migliorFra(candidati: TimeSlot[]): TimeSlot | null {
    let migliore: TimeSlot | null = null;
    let migliorePenalita = Infinity;
    for (const slot of candidati) {
      const penalita =
        penalitaPreferenzeSlot(u.teacherId, slot, prefs, orePerTeacherGiorno, slotsByDay) +
        Math.random() * 0.1;
      if (penalita < migliorePenalita) {
        migliorePenalita = penalita;
        migliore = slot;
      }
    }
    return migliore;
  }

  if (u.modalita === "separate") {
    // preferisci un giorno in cui questa materia non ha ancora ore: se per
    // forza di cose deve finire nello stesso giorno di un'altra ora della
    // stessa materia, il filtro sui vincoli generici garantisce già che sia
    // adiacente (mai "sparsa" nello stesso giorno).
    const chiaveAssegnazioneGiorno = (giorno: number) => `${u.assegnazioneId}-${giorno}`;
    const giorniLiberi = liberi.filter((slot) => {
      const oreEsistenti = orePerAssegnazioneGiorno.get(chiaveAssegnazioneGiorno(slot.giorno)) ?? [];
      return oreEsistenti.length === 0;
    });
    if (giorniLiberi.length > 0) return migliorFra(giorniLiberi);
    // nessun giorno libero per questa materia: ripiega sugli slot validi
    // rimasti (già garantiti adiacenti se nello stesso giorno)
  }

  return migliorFra(liberi);
}

// Piazza una coppia di ore adiacenti (stesso giorno, ore consecutive)
// entrambe libere per il docente e per la classe.
function piazzaCoppia(
  u: Unita,
  slotsByDay: Map<number, TimeSlot[]>,
  teacherBusy: Set<string>,
  classBusy: Set<number>,
  prefs: Preferenza[],
  orePerTeacherGiorno: Map<string, number[]>,
  orePerTeacherClasseGiorno: Map<string, number>,
  orePerAssegnazioneGiorno: Map<string, number[]>,
  limiteOreGiornoPerTeacher: Map<number, number> | undefined
): [TimeSlot, TimeSlot] | null {
  let migliorCoppia: [TimeSlot, TimeSlot] | null = null;
  let migliorePenalita = Infinity;
  const limiteGiorno = limiteOreGiorno(u.teacherId, limiteOreGiornoPerTeacher);

  for (const oreGiorno of slotsByDay.values()) {
    for (let i = 0; i < oreGiorno.length - 1; i++) {
      const slot1 = oreGiorno[i];
      const slot2 = oreGiorno[i + 1];
      if (slot2.ora - slot1.ora !== 1) continue; // devono essere consecutive

      const libero1 = !teacherBusy.has(`${u.teacherId}-${slot1.id}`) && !classBusy.has(slot1.id);
      const libero2 = !teacherBusy.has(`${u.teacherId}-${slot2.id}`) && !classBusy.has(slot2.id);
      if (!libero1 || !libero2) continue;

      // la coppia aggiunge 2 ore: il docente deve partire da 0 ore quel
      // giorno in questa classe (mai più di 2 ore/giorno in totale)
      const chiaveTCG = `${u.teacherId}-${u.classId}-${slot1.giorno}`;
      const oreEsistentiTCG = orePerTeacherClasseGiorno.get(chiaveTCG) ?? 0;
      if (oreEsistentiTCG > 0) continue;

      // se questa materia ha già un'ora quel giorno non c'è più spazio per
      // una coppia intera (supererebbe le 2 ore/giorno consentite)
      const chiaveAG = `${u.assegnazioneId}-${slot1.giorno}`;
      const oreEsistentiAG = orePerAssegnazioneGiorno.get(chiaveAG) ?? [];
      if (oreEsistentiAG.length > 0) continue;

      // il docente non può superare il proprio limite di ore/giorno (su
      // tutte le classi) aggiungendo queste 2 ore
      const chiaveGiornoDocente = `${u.teacherId}-${slot1.giorno}`;
      const oreEsistentiGiornoDocente = orePerTeacherGiorno.get(chiaveGiornoDocente) ?? [];
      if (oreEsistentiGiornoDocente.length + 2 > limiteGiorno) continue;

      const penalita =
        penalitaPreferenzeSlot(u.teacherId, slot1, prefs, orePerTeacherGiorno, slotsByDay) +
        penalitaPreferenzeSlot(u.teacherId, slot2, prefs, orePerTeacherGiorno, slotsByDay) +
        Math.random() * 0.1;

      if (penalita < migliorePenalita) {
        migliorePenalita = penalita;
        migliorCoppia = [slot1, slot2];
      }
    }
  }

  return migliorCoppia;
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
      if (p.tipo === "giorno_libero") {
        for (const giorno of giorniDaDettaglio(p.dettaglio)) {
          if (oreDocente.some((s) => s.giorno === giorno)) violazioni++;
        }
      }

      if (p.tipo === "no_prima_ora") {
        for (const s of oreDocente) {
          if (!giornoCompatibile(p, s.giorno)) continue;
          const oreGiornoGriglia = slotsByDay.get(s.giorno) ?? [];
          const primaOra = oreGiornoGriglia[0]?.ora;
          if (s.ora === primaOra) violazioni++;
        }
      }

      if (p.tipo === "no_ultima_ora") {
        for (const s of oreDocente) {
          if (!giornoCompatibile(p, s.giorno)) continue;
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
      // Teniamo la combinazione completa con meno preferenze violate finora
      // trovata: continuiamo a cercare (entro il tempo totale disponibile)
      // finché non ne troviamo una perfetta (0 violazioni) o finisce il tempo.
      if (!migliore || risultato.preferenzeViolate < migliore.preferenzeViolate) {
        migliore = risultato;
      }
    }

    onProgress?.({
      tentativiTotali,
      tempoTrascorsoMs: Date.now() - inizio,
      migliorViolazioni: migliore ? migliore.preferenzeViolate : null,
    });

    if (migliore && migliore.preferenzeViolate === 0) break;

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
