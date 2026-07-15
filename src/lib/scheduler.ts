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
  // Docenti a cui dare priorita' nell'ordine di processamento delle classi
  // (tipicamente chi ha avuto preferenze violate nel tentativo precedente):
  // uso interno di generaOrarioProgressivo per "guidare" i tentativi
  // successivi verso le zone del problema, di norma non va passato a mano.
  docentiPrioritari?: Set<number>;
  // Vincolo rigido: nel giorno in cui una classe ha Scienze motorie, la
  // stessa classe non può avere né Arte né Tecnologia (materie identificate
  // per id). Se uno dei due insiemi è assente o vuoto il vincolo non si applica.
  materieMotoria?: Set<number>;
  materieEscluseConMotoria?: Set<number>;
  // Vincoli rigidi opzionali: attivabili/disattivabili da chi usa l'app
  // (impostazioni salvate in school_config). Se assente si usano i default
  // (tutti attivi, soglia 5/6). Il vincolo Motoria/Arte/Tecnologia non è
  // incluso qui: si disattiva semplicemente non passando materieMotoria /
  // materieEscluseConMotoria (o passandoli vuoti). Il vincolo di adiacenza
  // per materia ripetuta nello stesso giorno non è incluso qui: è
  // strutturale, non disattivabile, ma si applica solo alle assegnazioni
  // con modalita' "a coppie" (vedi passaVincoliGenerici piu' sotto).
  vincoliOpzionali?: VincoliOpzionali;
  // Docenti a cui sono concesse fino a NUMERO_MASSIMO_GIORNI_ECCEZIONE
  // giornate a settimana con fino a LIMITE_ORE_GIORNO_ECCEZIONE ore
  // (invece del normale limite di LIMITE_ORE_GIORNO_NORMALE ore/giorno
  // che vale sempre per tutti gli altri docenti). Vincolo hard-coded: chi
  // chiama il motore risolve qui gli id dei docenti coinvolti (nella
  // scuola attuale, solo "De Pascalis"), non e' piu' un'impostazione
  // modificabile dall'interfaccia.
  docentiOreEccezione?: Set<number>;
  scadenza: number; // Date.now() + millisecondi disponibili
}

// Vincoli rigidi che, a differenza di quelli strutturali (doppie
// prenotazioni, ore manuali fisse), possono essere attivati o disattivati
// da chi usa l'app: se disattivati il motore semplicemente non li applica
// piu' durante il piazzamento.
export interface VincoliOpzionali {
  // Massimo 2 ore al giorno per la stessa coppia docente-classe.
  maxOreClasseGiorno: boolean;
}

export const DEFAULT_VINCOLI_OPZIONALI: VincoliOpzionali = {
  maxOreClasseGiorno: true,
};

// Vincolo hard-coded (sempre attivo, non disattivabile dall'interfaccia):
// nessun docente puo' superare le LIMITE_ORE_GIORNO_NORMALE ore in un
// giorno, con l'eccezione dei docenti in docentiOreEccezione (vedi
// GeneraOrarioInput), che possono raggiungere LIMITE_ORE_GIORNO_ECCEZIONE
// ore in AL MASSIMO NUMERO_MASSIMO_GIORNI_ECCEZIONE giornate della
// settimana (mai piu' di quel numero di giornate, e mai oltre il limite
// eccezione in nessun giorno). Chi chiama il motore
// (src/app/orario/page.tsx) risolve quali docenti rientrano nell'eccezione
// cercando per cognome "De Pascalis" tra i docenti caricati: e' una regola
// di business specifica della scuola, non piu' configurabile dall'utente.
// Il martedi' e' inoltre SEMPRE escluso dall'eccezione (vedi
// GIORNO_ESCLUSO_ECCEZIONE): De Pascalis non puo' mai fare 6 ore di
// martedi', anche se ha ancora giornate eccezione disponibili.
export const LIMITE_ORE_GIORNO_NORMALE = 5;
export const LIMITE_ORE_GIORNO_ECCEZIONE = 6;
export const NUMERO_MASSIMO_GIORNI_ECCEZIONE = 2;
// Giorno (vedi TimeSlot.giorno: 1=Lunedi', 2=Martedi', ...) su cui
// l'eccezione ore/giorno non puo' MAI essere usata, indipendentemente da
// quante giornate eccezione restano disponibili. Nella scuola attuale:
// martedi'.
export const GIORNO_ESCLUSO_ECCEZIONE = 2;

// Descrive una singola violazione di preferenza nel risultato, per poterla
// mostrare nell'interfaccia (docente, tipo di preferenza e giorno in cui
// e' stata violata, quando applicabile).
export interface ViolazionePreferenza {
  teacherId: number;
  tipo: Preferenza["tipo"];
  giorno?: number;
  ora?: number;
}

export interface GeneraOrarioOutput {
  riuscito: boolean;
  entries: EntrataGenerata[];
  preferenzeViolate: number;
  preferenzeValutabili: number;
  tentativi: number;
  // Docenti che hanno almeno una preferenza violata in questo risultato:
  // usato da generaOrarioProgressivo per dare priorita' alle loro classi
  // nel tentativo successivo.
  docentiViolati: Set<number>;
  // Elenco dettagliato delle violazioni, da mostrare nell'interfaccia.
  dettagliViolazioni: ViolazionePreferenza[];
  // Quante ore sono state effettivamente assegnate nel risultato restituito
  // (nella combinazione completa se riuscito, altrimenti nella migliore
  // combinazione PARZIALE trovata entro il tempo disponibile) e quante ore
  // erano complessivamente da assegnare: permettono all'interfaccia di
  // mostrare quanto e' stato completato anche quando la ricerca fallisce.
  oreAssegnate: number;
  oreTotali: number;
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

// Ordina le classi per il prossimo tentativo: le classi che coinvolgono
// uno dei "docenti prioritari" (chi ha avuto preferenze violate nel
// tentativo precedente) vengono processate per prime, cosi' hanno la
// prima scelta sugli slot migliori invece di rischiare che gli slot
// buoni siano gia' stati presi da altre classi senza preferenze. Tra le
// classi dello stesso gruppo l'ordine resta comunque casuale.
function ordinaClassiConPriorita(
  classIds: number[],
  assegnazioni: AssegnazioneInput[],
  docentiPrioritari: Set<number> | undefined
): number[] {
  if (!docentiPrioritari || docentiPrioritari.size === 0) return mescola(classIds);

  const prioritarie: number[] = [];
  const altre: number[] = [];
  for (const classId of classIds) {
    const coinvolgeDocentePrioritario = assegnazioni.some(
      (a) => a.class_id === classId && docentiPrioritari.has(a.teacher_id)
    );
    (coinvolgeDocentePrioritario ? prioritarie : altre).push(classId);
  }
  return [...mescola(prioritarie), ...mescola(altre)];
}

function teacherIdDiCompito(c: Compito): number {
  return c.tipo === "singola" ? c.unita.teacherId : c.unitaA.teacherId;
}

// Stessa logica di ordinaClassiConPriorita ma dentro una singola classe:
// la maggior parte dei conflitti reali capita proprio qui, tra le materie
// della stessa classe che si contendono le poche ore rimaste. Le "ore" dei
// docenti prioritari vengono piazzate per prime, cosi' hanno la prima
// scelta sugli slot buoni invece di ritrovarsi, per pura sfortuna
// dell'ordine casuale, con in mano solo lo slot del loro giorno libero.
function ordinaCompitiConPriorita(
  compiti: Compito[],
  docentiPrioritari: Set<number> | undefined
): Compito[] {
  if (!docentiPrioritari || docentiPrioritari.size === 0) return mescola(compiti);

  const prioritari: Compito[] = [];
  const altri: Compito[] = [];
  for (const c of compiti) {
    (docentiPrioritari.has(teacherIdDiCompito(c)) ? prioritari : altri).push(c);
  }
  return [...mescola(prioritari), ...mescola(altri)];
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
  const {
    timeSlots,
    assegnazioni,
    entrateManuali,
    preferenze,
    materieMotoria,
    materieEscluseConMotoria,
    docentiOreEccezione,
    scadenza,
  } = input;
  const vincoli = input.vincoliOpzionali ?? DEFAULT_VINCOLI_OPZIONALI;

  // Docenti a cui dare priorita' nel prossimo tentativo esterno: parte da
  // quelli passati dal chiamante (tipicamente chi ha avuto preferenze
  // violate nel miglior risultato trovato finora nei chunk precedenti), ma
  // viene aggiornata ANCHE piu' sotto quando una classe non riesce a
  // completarsi entro MAX_TENTATIVI_PER_CLASSE: in quel caso i docenti
  // della classe che ha fatto fallire l'intero tentativo diventano la
  // nuova priorita', cosi' il prossimo giro processa per primi proprio chi
  // era coinvolto nel punto in cui la ricerca si e' bloccata, invece di
  // continuare a mescolare l'ordine in modo completamente cieco rispetto a
  // DOVE il tentativo precedente e' fallito.
  let docentiPrioritari = input.docentiPrioritari;

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
  // Presenza di Motoria / Arte-Tecnologia per classe+giorno dovuta a ore
  // manuali fisse (vincolo: mai insieme nello stesso giorno per la stessa classe)
  const motoriaPerClasseGiornoManuale = new Map<string, number>();
  const escluseConMotoriaPerClasseGiornoManuale = new Map<string, number>();
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

      const chiaveClasseGiorno = `${e.class_id}-${slotManuale.giorno}`;
      if (materieMotoria?.has(e.subject_id)) {
        motoriaPerClasseGiornoManuale.set(chiaveClasseGiorno, (motoriaPerClasseGiornoManuale.get(chiaveClasseGiorno) ?? 0) + 1);
      }
      if (materieEscluseConMotoria?.has(e.subject_id)) {
        escluseConMotoriaPerClasseGiornoManuale.set(
          chiaveClasseGiorno,
          (escluseConMotoriaPerClasseGiornoManuale.get(chiaveClasseGiorno) ?? 0) + 1
        );
      }
    }
  }

  // Se le ore manuali portano già un docente sopra il limite normale in un
  // giorno, quel giorno conta come una delle sue giornate "eccezione": la
  // generazione automatica non potrà fargliene assegnare più di
  // NUMERO_MASSIMO_GIORNI_ECCEZIONE in totale (comprese quelle già fisse).
  const giorniEccezionePerTeacherManuale = new Map<number, Set<number>>();
  for (const [chiave, ore] of orePerTeacherGiornoManuale.entries()) {
    if (ore.length > LIMITE_ORE_GIORNO_NORMALE) {
      const [teacherIdStr, giornoStr] = chiave.split("-");
      const teacherId = Number(teacherIdStr);
      if (!giorniEccezionePerTeacherManuale.has(teacherId)) giorniEccezionePerTeacherManuale.set(teacherId, new Set());
      giorniEccezionePerTeacherManuale.get(teacherId)!.add(Number(giornoStr));
    }
  }

  // Giorni in cui un docente ha GIA' esattamente 1 ora per via delle sole
  // ore manuali fisse (nessuna ora generata coinvolta): situazione
  // inevitabile, non imputabile alla generazione automatica, quindi va
  // esclusa dal controllo finale "mai una sola ora isolata al giorno" più
  // sotto (altrimenti ogni tentativo fallirebbe sempre per un dato che non
  // può comunque essere cambiato).
  const giorniOraSingolaManualeInevitabile = new Set<string>();
  for (const [chiave, ore] of orePerTeacherGiornoManuale.entries()) {
    if (ore.length === 1) giorniOraSingolaManualeInevitabile.add(chiave);
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

  // Elenco completo di tutte le unita' da piazzare, indipendentemente dalla
  // classe: serve sia per calcolare le violazioni sulla combinazione finale
  // completa, sia (vedi migliorParziale piu' sotto) per costruire un
  // risultato parziale quando la ricerca non riesce a completare l'orario
  // entro il tempo disponibile.
  const tutteLeUnitaTotali: Unita[] = [];
  for (const compiti of compitiPerClasse.values()) {
    for (const c of compiti) {
      if (c.tipo === "singola") tutteLeUnitaTotali.push(c.unita);
      else tutteLeUnitaTotali.push(c.unitaA, c.unitaB);
    }
  }
  const oreTotali = tutteLeUnitaTotali.length;

  if (classIds.length === 0) {
    return {
      riuscito: true,
      entries: [],
      preferenzeViolate: 0,
      preferenzeValutabili: 0,
      tentativi: 0,
      docentiViolati: new Set(),
      dettagliViolazioni: [],
      oreAssegnate: 0,
      oreTotali: 0,
    };
  }

  // Migliore combinazione PARZIALE (incompleta) trovata finora in questo
  // giro di generaOrario: si aggiorna ogni volta che una classe si completa
  // con successo e il numero totale di ore assegnate (su tutte le classi
  // gia' bloccate) supera il record precedente. Se la ricerca esaurisce il
  // tempo senza mai completare TUTTE le classi, questa e' la combinazione
  // che viene restituita al posto di un fallimento totale.
  let migliorParziale: {
    entries: EntrataGenerata[];
    preferenzeViolate: number;
    dettagliViolazioni: ViolazionePreferenza[];
    docentiViolati: Set<number>;
    oreAssegnate: number;
  } | null = null;

  let tentativi = 0;
  // Quanti riordini diversi provare per UNA classe (a parita' di classi gia'
  // bloccate) prima di arrendersi e ripartire da capo con una combinazione
  // completamente nuova (incluso un nuovo ordine delle classi).
  const MAX_TENTATIVI_PER_CLASSE = 300;

  while (Date.now() < scadenza) {
    tentativi++;
    const ordineClassi = ordinaClassiConPriorita(classIds, assegnazioni, docentiPrioritari);

    // Stato "confermato" del tentativo esterno corrente: si aggiorna solo
    // quando una classe viene completata con successo e quindi bloccata.
    let teacherBusy = new Set(teacherBusyFisso);
    let pianoGlobale = new Map<number, number>();
    let orePerTeacherGiorno = clonaMappaOre(orePerTeacherGiornoManuale);
    let orePerAssegnazioneGiorno = clonaMappaOre(assegnazioneGiornoManuale);
    let orePerTeacherClasseGiorno = new Map<string, number>(teacherClasseGiornoManuale);
    let motoriaPerClasseGiorno = new Map<string, number>(motoriaPerClasseGiornoManuale);
    let escluseConMotoriaPerClasseGiorno = new Map<string, number>(escluseConMotoriaPerClasseGiornoManuale);
    let giorniEccezionePerTeacher = clonaMappaGiorniEccezione(giorniEccezionePerTeacherManuale);

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
        const provaMotoriaPerClasseGiorno = new Map<string, number>(motoriaPerClasseGiorno);
        const provaEscluseConMotoriaPerClasseGiorno = new Map<string, number>(escluseConMotoriaPerClasseGiorno);
        const provaGiorniEccezionePerTeacher = clonaMappaGiorniEccezione(giorniEccezionePerTeacher);

        const compitiShuffle = ordinaCompitiConPriorita(compitiClasse, docentiPrioritari);
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
              provaGiorniEccezionePerTeacher,
              materieMotoria,
              materieEscluseConMotoria,
              provaMotoriaPerClasseGiorno,
              provaEscluseConMotoriaPerClasseGiorno,
              vincoli,
              docentiOreEccezione
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
              provaOrePerTeacherClasseGiorno,
              materieMotoria,
              materieEscluseConMotoria,
              provaMotoriaPerClasseGiorno,
              provaEscluseConMotoriaPerClasseGiorno,
              provaGiorniEccezionePerTeacher
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
              provaGiorniEccezionePerTeacher,
              materieMotoria,
              materieEscluseConMotoria,
              provaMotoriaPerClasseGiorno,
              provaEscluseConMotoriaPerClasseGiorno,
              vincoli,
              docentiOreEccezione
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
              provaOrePerTeacherClasseGiorno,
              materieMotoria,
              materieEscluseConMotoria,
              provaMotoriaPerClasseGiorno,
              provaEscluseConMotoriaPerClasseGiorno,
              provaGiorniEccezionePerTeacher
            );
            registraPiazzamento(
              compito.unitaB,
              esito[1],
              provaTeacherBusy,
              provaClassBusy,
              provaPiano,
              provaOrePerTeacherGiorno,
              provaOrePerAssegnazioneGiorno,
              provaOrePerTeacherClasseGiorno,
              materieMotoria,
              materieEscluseConMotoria,
              provaMotoriaPerClasseGiorno,
              provaEscluseConMotoriaPerClasseGiorno,
              provaGiorniEccezionePerTeacher
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
          motoriaPerClasseGiorno = provaMotoriaPerClasseGiorno;
          escluseConMotoriaPerClasseGiorno = provaEscluseConMotoriaPerClasseGiorno;
          giorniEccezionePerTeacher = provaGiorniEccezionePerTeacher;
          classeCompletata = true;

          // Aggiorna la migliore combinazione parziale se questa e' la
          // classe che porta il maggior numero di ore assegnate finora
          // (su tutte le classi gia' bloccate in questo tentativo esterno).
          if (pianoGlobale.size > (migliorParziale?.oreAssegnate ?? 0)) {
            const {
              totale: violazioniParziali,
              docenti: docentiViolatiParziali,
              dettagli: dettagliViolazioniParziali,
            } = contaViolazioni(tutteLeUnitaTotali, pianoGlobale, slotById, prefsByTeacher, slotsByDay);
            migliorParziale = {
              entries: costruisciEntries(tutteLeUnitaTotali, pianoGlobale),
              preferenzeViolate: violazioniParziali,
              dettagliViolazioni: dettagliViolazioniParziali,
              docentiViolati: docentiViolatiParziali,
              oreAssegnate: pianoGlobale.size,
            };
          }

          break;
        }
      }

      if (!classeCompletata) {
        // Questa classe non si e' completata nonostante piu' combinazioni:
        // abbandoniamo l'intero tentativo e ripartiamo da capo (nuovo
        // ordine delle classi, nuove combinazioni per tutte). Prima di
        // ripartire, segnaliamo pero' come prioritari per il prossimo giro
        // i docenti coinvolti in QUESTA classe: e' li' che la ricerca si
        // e' bloccata, quindi conviene dar loro la prima scelta sugli slot
        // migliori nel prossimo tentativo invece di rischiare che restino
        // di nuovo in fondo alla coda per puro caso.
        const docentiClasseFallita = new Set(
          assegnazioni.filter((a) => a.class_id === classId).map((a) => a.teacher_id)
        );
        if (docentiClasseFallita.size > 0) docentiPrioritari = docentiClasseFallita;
        tuttoCompletato = false;
        break;
      }
    }

    if (tuttoCompletato) {
      // Vincolo hard-coded (sempre attivo): un docente, in un giorno in cui
      // lavora, deve avere ALMENO 2 ore (anche su classi diverse), mai una
      // singola ora isolata. Si valuta sul totale giornaliero del docente
      // su TUTTE le sue classi combinate, quindi e' verificabile solo ORA
      // che il tentativo ha completato tutte le classi (non incrementalmente
      // durante il piazzamento, perche' un'ora che sembra isolata potrebbe
      // diventare una coppia con un piazzamento successivo in un'altra
      // classe). Se violato, scartiamo l'intero tentativo: il ciclo
      // esterno ne ripartira' uno nuovo, con un ordine/combinazione diversi.
      let haOraSingolaIsolata = false;
      for (const [chiave, ore] of orePerTeacherGiorno.entries()) {
        if (ore.length === 1 && !giorniOraSingolaManualeInevitabile.has(chiave)) {
          haOraSingolaIsolata = true;
          break;
        }
      }

      if (!haOraSingolaIsolata) {
        const {
          totale: violazioni,
          docenti: docentiViolati,
          dettagli: dettagliViolazioni,
        } = contaViolazioni(tutteLeUnitaTotali, pianoGlobale, slotById, prefsByTeacher, slotsByDay);
        const entries = costruisciEntries(tutteLeUnitaTotali, pianoGlobale);
        return {
          riuscito: true,
          entries,
          preferenzeViolate: violazioni,
          preferenzeValutabili: preferenze.length,
          tentativi,
          docentiViolati,
          dettagliViolazioni,
          oreAssegnate: entries.length,
          oreTotali,
        };
      }
      // altrimenti: tentativo scartato per un'ora isolata, si riparte da
      // capo nel prossimo giro del ciclo esterno (vedi while piu' sopra)
    }
  }

  // Nessun tentativo ha completato TUTTE le classi entro il tempo
  // disponibile: restituiamo comunque la migliore combinazione PARZIALE
  // trovata (se ce n'e' una), cosi' che l'interfaccia possa mostrarla e
  // salvarla invece di perdere tutto il lavoro fatto.
  return {
    riuscito: false,
    entries: migliorParziale?.entries ?? [],
    preferenzeViolate: migliorParziale?.preferenzeViolate ?? 0,
    preferenzeValutabili: preferenze.length,
    tentativi,
    docentiViolati: migliorParziale?.docentiViolati ?? new Set(),
    dettagliViolazioni: migliorParziale?.dettagliViolazioni ?? [],
    oreAssegnate: migliorParziale?.oreAssegnate ?? 0,
    oreTotali,
  };
}

function clonaMappaOre(mappa: Map<string, number[]>): Map<string, number[]> {
  const clone = new Map<string, number[]>();
  for (const [chiave, valori] of mappa) clone.set(chiave, [...valori]);
  return clone;
}

function clonaMappaGiorniEccezione(mappa: Map<number, Set<number>>): Map<number, Set<number>> {
  const clone = new Map<number, Set<number>>();
  for (const [teacherId, giorni] of mappa) clone.set(teacherId, new Set(giorni));
  return clone;
}

// Costruisce le entrate finali a partire dall'elenco di unita' e dal piano
// dei piazzamenti, includendo solo le unita' che hanno effettivamente uno
// slot assegnato (utile anche per combinazioni parziali/incomplete, dove
// non tutte le unita' sono ancora state piazzate).
function costruisciEntries(unita: Unita[], piano: Map<number, number>): EntrataGenerata[] {
  const entries: EntrataGenerata[] = [];
  for (const u of unita) {
    const slotId = piano.get(u.unitaId);
    if (slotId !== undefined) {
      entries.push({
        teacher_id: u.teacherId,
        class_id: u.classId,
        subject_id: u.subjectId,
        time_slot_id: slotId,
      });
    }
  }
  return entries;
}

function registraPiazzamento(
  u: Unita,
  slot: TimeSlot,
  teacherBusy: Set<string>,
  classBusy: Set<number>,
  piano: Map<number, number>,
  orePerTeacherGiorno: Map<string, number[]>,
  orePerAssegnazioneGiorno: Map<string, number[]>,
  orePerTeacherClasseGiorno: Map<string, number>,
  materieMotoria: Set<number> | undefined,
  materieEscluseConMotoria: Set<number> | undefined,
  motoriaPerClasseGiorno: Map<string, number>,
  escluseConMotoriaPerClasseGiorno: Map<string, number>,
  giorniEccezionePerTeacher?: Map<number, Set<number>>
) {
  teacherBusy.add(`${u.teacherId}-${slot.id}`);
  classBusy.add(slot.id);
  piano.set(u.unitaId, slot.id);

  const chiaveGiorno = `${u.teacherId}-${slot.giorno}`;
  if (!orePerTeacherGiorno.has(chiaveGiorno)) orePerTeacherGiorno.set(chiaveGiorno, []);
  orePerTeacherGiorno.get(chiaveGiorno)!.push(slot.ora);

  // se questo piazzamento porta il docente sopra il limite normale in
  // questo giorno, il giorno diventa (se non lo era gia') una delle sue
  // giornate "eccezione" (al massimo NUMERO_MASSIMO_GIORNI_ECCEZIONE in
  // totale, verificato da passaVincoloOreGiorno prima di arrivare qui)
  if (giorniEccezionePerTeacher && orePerTeacherGiorno.get(chiaveGiorno)!.length > LIMITE_ORE_GIORNO_NORMALE) {
    if (!giorniEccezionePerTeacher.has(u.teacherId)) giorniEccezionePerTeacher.set(u.teacherId, new Set());
    giorniEccezionePerTeacher.get(u.teacherId)!.add(slot.giorno);
  }

  const chiaveAssegnazioneGiorno = `${u.assegnazioneId}-${slot.giorno}`;
  if (!orePerAssegnazioneGiorno.has(chiaveAssegnazioneGiorno)) orePerAssegnazioneGiorno.set(chiaveAssegnazioneGiorno, []);
  orePerAssegnazioneGiorno.get(chiaveAssegnazioneGiorno)!.push(slot.ora);

  const chiaveTCG = `${u.teacherId}-${u.classId}-${slot.giorno}`;
  orePerTeacherClasseGiorno.set(chiaveTCG, (orePerTeacherClasseGiorno.get(chiaveTCG) ?? 0) + 1);

  const chiaveClasseGiorno = `${u.classId}-${slot.giorno}`;
  if (materieMotoria?.has(u.subjectId)) {
    motoriaPerClasseGiorno.set(chiaveClasseGiorno, (motoriaPerClasseGiorno.get(chiaveClasseGiorno) ?? 0) + 1);
  }
  if (materieEscluseConMotoria?.has(u.subjectId)) {
    escluseConMotoriaPerClasseGiorno.set(
      chiaveClasseGiorno,
      (escluseConMotoriaPerClasseGiorno.get(chiaveClasseGiorno) ?? 0) + 1
    );
  }
}

// Vincoli generici rigidi:
// (1) un docente non può avere più di 2 ore al giorno nella stessa classe
//     (opzionale, disattivabile: vincoli.maxOreClasseGiorno);
// (2) se la stessa materia (stesso docente/classe) compare più volte nello
//     stesso giorno E la modalita' e' "a coppie", le ore devono essere
//     consecutive (mai "sparse") — quando se ne piazza una in un giorno,
//     un'altra ora della stessa materia va nella casella immediatamente
//     successiva dello stesso giorno, fino a un massimo di 2 ore
//     consecutive. Vincolo STRUTTURALE (non disattivabile dall'interfaccia).
// (3) se la modalita' e' "separate", vale la regola OPPOSTA: due ore della
//     stessa assegnazione non possono MAI finire in slot adiacenti dello
//     stesso giorno (possono comunque cadere nello stesso giorno, purché
//     non attaccate: es. 1ª e 4ª ora vanno bene, 1ª e 2ª no). Vincolo
//     STRUTTURALE, sempre attivo, non disattivabile dall'interfaccia. Per
//     "indifferente" non c'è invece nessun vincolo di adiacenza.
function passaVincoliGenerici(
  u: Unita,
  slot: TimeSlot,
  orePerTeacherClasseGiorno: Map<string, number>,
  orePerAssegnazioneGiorno: Map<string, number[]>,
  vincoli: VincoliOpzionali
): boolean {
  if (vincoli.maxOreClasseGiorno) {
    const chiaveTCG = `${u.teacherId}-${u.classId}-${slot.giorno}`;
    const oreEsistentiTCG = orePerTeacherClasseGiorno.get(chiaveTCG) ?? 0;
    if (oreEsistentiTCG >= 2) return false;
  }

  if (u.modalita === "coppie") {
    const chiaveAG = `${u.assegnazioneId}-${slot.giorno}`;
    const oreEsistentiAG = orePerAssegnazioneGiorno.get(chiaveAG) ?? [];
    if (oreEsistentiAG.length > 0) {
      const adiacente = oreEsistentiAG.some((o) => Math.abs(o - slot.ora) === 1);
      if (!adiacente) return false;
    }
  }

  if (u.modalita === "separate") {
    const chiaveAG = `${u.assegnazioneId}-${slot.giorno}`;
    const oreEsistentiAG = orePerAssegnazioneGiorno.get(chiaveAG) ?? [];
    const adiacente = oreEsistentiAG.some((o) => Math.abs(o - slot.ora) === 1);
    if (adiacente) return false;
  }

  return true;
}

// Vincolo rigido: nel giorno in cui una classe ha Scienze motorie non può
// avere né Arte né Tecnologia (e viceversa). Va verificato in entrambe le
// direzioni perché l'ordine di piazzamento tra le materie non è fisso: puo'
// capitare che Arte/Tecnologia venga piazzata prima di Motoria o viceversa.
function passaVincoloMotoria(
  u: Unita,
  slot: TimeSlot,
  materieMotoria: Set<number> | undefined,
  materieEscluseConMotoria: Set<number> | undefined,
  motoriaPerClasseGiorno: Map<string, number>,
  escluseConMotoriaPerClasseGiorno: Map<string, number>
): boolean {
  if (!materieMotoria || !materieEscluseConMotoria) return true;
  if (materieMotoria.size === 0 || materieEscluseConMotoria.size === 0) return true;

  const chiave = `${u.classId}-${slot.giorno}`;
  const isMotoria = materieMotoria.has(u.subjectId);
  const isEsclusa = materieEscluseConMotoria.has(u.subjectId);
  if (isMotoria && (escluseConMotoriaPerClasseGiorno.get(chiave) ?? 0) > 0) return false;
  if (isEsclusa && (motoriaPerClasseGiorno.get(chiave) ?? 0) > 0) return false;
  return true;
}

// Vincolo rigido HARD-CODED (sempre attivo): un docente non puo' mai
// superare LIMITE_ORE_GIORNO_NORMALE ore in un giorno, a meno che non sia
// tra i docentiOreEccezione (nella scuola attuale, solo "De Pascalis": vedi
// dove viene risolto in src/app/orario/page.tsx), nel qual caso puo'
// raggiungere LIMITE_ORE_GIORNO_ECCEZIONE ore in AL MASSIMO
// NUMERO_MASSIMO_GIORNI_ECCEZIONE giornate della settimana (mai piu' di
// quel numero di giornate, e mai oltre il limite eccezione in nessun
// giorno), con l'eccezione ULTERIORE che il giorno GIORNO_ESCLUSO_ECCEZIONE
// (martedi') non puo' MAI ospitare l'eccezione, anche se il docente ha
// ancora giornate eccezione disponibili: quel giorno resta sempre limitato
// a LIMITE_ORE_GIORNO_NORMALE. "incremento" e' quante ore aggiunge questo
// piazzamento (1 per una singola, 2 per una coppia).
function passaVincoloOreGiorno(
  teacherId: number,
  giorno: number,
  incremento: number,
  oreEsistenti: number,
  giorniEccezionePerTeacher: Map<number, Set<number>>,
  docentiOreEccezione: Set<number> | undefined
): boolean {
  const puoEccezione =
    (docentiOreEccezione?.has(teacherId) ?? false) && giorno !== GIORNO_ESCLUSO_ECCEZIONE;
  const limiteMax = puoEccezione ? LIMITE_ORE_GIORNO_ECCEZIONE : LIMITE_ORE_GIORNO_NORMALE;
  const oreDopo = oreEsistenti + incremento;
  if (oreDopo > limiteMax) return false;
  if (puoEccezione && oreDopo > LIMITE_ORE_GIORNO_NORMALE) {
    const giorniUsati = giorniEccezionePerTeacher.get(teacherId);
    const giaGiornoEccezione = giorniUsati?.has(giorno) ?? false;
    if (!giaGiornoEccezione && (giorniUsati?.size ?? 0) >= NUMERO_MASSIMO_GIORNI_ECCEZIONE) return false;
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

// Estrae il numero d'ora richiesto dal dettaglio della preferenza
// "no_ora_specifica" (es. { ora: 3, giorni: [1, 3] }). Ritorna undefined se
// il dettaglio è assente o non contiene un'ora valida.
function oraDaDettaglio(dettaglio: Record<string, unknown> | null): number | undefined {
  if (!dettaglio) return undefined;
  const d = dettaglio as { ora?: number };
  return typeof d.ora === "number" ? d.ora : undefined;
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
    if (p.tipo === "no_ora_specifica") {
      const oraRichiesta = oraDaDettaglio(p.dettaglio);
      if (oraRichiesta !== undefined && slot.ora === oraRichiesta && giornoCompatibile(p, slot.giorno)) {
        penalita += 20;
      }
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

// Piazza una singola ora. Per modalita' "separate" gli slot adiacenti a
// un'altra ora della stessa assegnazione nello stesso giorno sono gia'
// esclusi da "liberi" (vincolo rigido, vedi passaVincoliGenerici): qui in
// piu' si preferisce, quando possibile, un giorno in cui questa materia non
// ha ancora nessuna ora, per disperderle il piu' possibile invece di
// accumularne piu' d'una (non adiacente) nello stesso giorno.
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
  giorniEccezionePerTeacher: Map<number, Set<number>>,
  materieMotoria: Set<number> | undefined,
  materieEscluseConMotoria: Set<number> | undefined,
  motoriaPerClasseGiorno: Map<string, number>,
  escluseConMotoriaPerClasseGiorno: Map<string, number>,
  vincoli: VincoliOpzionali,
  docentiOreEccezione: Set<number> | undefined
): TimeSlot | null {
  const liberi = timeSlots.filter(
    (slot) =>
      !teacherBusy.has(`${u.teacherId}-${slot.id}`) &&
      !classBusy.has(slot.id) &&
      passaVincoliGenerici(u, slot, orePerTeacherClasseGiorno, orePerAssegnazioneGiorno, vincoli) &&
      passaVincoloOreGiorno(
        u.teacherId,
        slot.giorno,
        1,
        (orePerTeacherGiorno.get(`${u.teacherId}-${slot.giorno}`) ?? []).length,
        giorniEccezionePerTeacher,
        docentiOreEccezione
      ) &&
      passaVincoloMotoria(
        u,
        slot,
        materieMotoria,
        materieEscluseConMotoria,
        motoriaPerClasseGiorno,
        escluseConMotoriaPerClasseGiorno
      )
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

  // NOTA: per modalita' "separate" NON si preferisce piu' un giorno "nuovo"
  // per questa materia (a differenza di versioni precedenti): quella
  // preferenza spingeva a disperdere le ore su piu' giorni diversi, il che
  // confligge direttamente con il vincolo rigido "mai una sola ora isolata
  // al giorno per un docente" (vedi passaVincoloOreGiorno/il controllo
  // finale in generaOrario) quando questa e' l'unica assegnazione del
  // docente quel giorno: spingere verso giorni sempre nuovi produrrebbe
  // sistematicamente ore isolate, che il controllo finale scarterebbe
  // sempre, bloccando la ricerca. Si lascia quindi che il piazzamento scelga
  // liberamente tra tutti gli slot non adiacenti (vincolo "separate" gia'
  // applicato a monte in "liberi"), cosi' le ore della stessa materia
  // possono benissimo finire nello stesso giorno (purche' non adiacenti).
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
  giorniEccezionePerTeacher: Map<number, Set<number>>,
  materieMotoria: Set<number> | undefined,
  materieEscluseConMotoria: Set<number> | undefined,
  motoriaPerClasseGiorno: Map<string, number>,
  escluseConMotoriaPerClasseGiorno: Map<string, number>,
  vincoli: VincoliOpzionali,
  docentiOreEccezione: Set<number> | undefined
): [TimeSlot, TimeSlot] | null {
  let migliorCoppia: [TimeSlot, TimeSlot] | null = null;
  let migliorePenalita = Infinity;

  for (const oreGiorno of slotsByDay.values()) {
    for (let i = 0; i < oreGiorno.length - 1; i++) {
      const slot1 = oreGiorno[i];
      const slot2 = oreGiorno[i + 1];
      if (slot2.ora - slot1.ora !== 1) continue; // devono essere consecutive

      const libero1 = !teacherBusy.has(`${u.teacherId}-${slot1.id}`) && !classBusy.has(slot1.id);
      const libero2 = !teacherBusy.has(`${u.teacherId}-${slot2.id}`) && !classBusy.has(slot2.id);
      if (!libero1 || !libero2) continue;

      // la coppia aggiunge 2 ore: il docente deve partire da 0 ore quel
      // giorno in questa classe (mai più di 2 ore/giorno in totale), se il
      // vincolo e' attivo
      if (vincoli.maxOreClasseGiorno) {
        const chiaveTCG = `${u.teacherId}-${u.classId}-${slot1.giorno}`;
        const oreEsistentiTCG = orePerTeacherClasseGiorno.get(chiaveTCG) ?? 0;
        if (oreEsistentiTCG > 0) continue;
      }

      // se questa materia ha già un'ora quel giorno non c'è più spazio per
      // una coppia intera (supererebbe le 2 ore/giorno consentite): vincolo
      // strutturale di adiacenza, sempre attivo
      {
        const chiaveAG = `${u.assegnazioneId}-${slot1.giorno}`;
        const oreEsistentiAG = orePerAssegnazioneGiorno.get(chiaveAG) ?? [];
        if (oreEsistentiAG.length > 0) continue;
      }

      // il docente non può superare il proprio limite di ore/giorno (su
      // tutte le classi) aggiungendo queste 2 ore
      const chiaveGiornoDocente = `${u.teacherId}-${slot1.giorno}`;
      const oreEsistentiGiornoDocente = orePerTeacherGiorno.get(chiaveGiornoDocente) ?? [];
      if (
        !passaVincoloOreGiorno(
          u.teacherId,
          slot1.giorno,
          2,
          oreEsistentiGiornoDocente.length,
          giorniEccezionePerTeacher,
          docentiOreEccezione
        )
      )
        continue;

      // vincolo motoria/arte/tecnologia: la coppia e' sempre nello stesso
      // giorno (slot1.giorno === slot2.giorno), basta un solo controllo
      if (
        !passaVincoloMotoria(
          u,
          slot1,
          materieMotoria,
          materieEscluseConMotoria,
          motoriaPerClasseGiorno,
          escluseConMotoriaPerClasseGiorno
        )
      )
        continue;

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
): { totale: number; docenti: Set<number>; dettagli: ViolazionePreferenza[] } {
  let violazioni = 0;
  const docentiViolati = new Set<number>();
  const dettagli: ViolazionePreferenza[] = [];
  for (const [teacherId, prefs] of prefsByTeacher.entries()) {
    const oreDocente = unita
      .filter((u) => u.teacherId === teacherId)
      .map((u) => slotById.get(piano.get(u.unitaId)!))
      .filter((s): s is TimeSlot => Boolean(s));

    let violazioniDocente = 0;

    for (const p of prefs) {
      if (p.tipo === "giorno_libero") {
        for (const giorno of giorniDaDettaglio(p.dettaglio)) {
          if (oreDocente.some((s) => s.giorno === giorno)) {
            violazioniDocente++;
            dettagli.push({ teacherId, tipo: p.tipo, giorno });
          }
        }
      }

      if (p.tipo === "no_prima_ora") {
        for (const s of oreDocente) {
          if (!giornoCompatibile(p, s.giorno)) continue;
          const oreGiornoGriglia = slotsByDay.get(s.giorno) ?? [];
          const primaOra = oreGiornoGriglia[0]?.ora;
          if (s.ora === primaOra) {
            violazioniDocente++;
            dettagli.push({ teacherId, tipo: p.tipo, giorno: s.giorno });
          }
        }
      }

      if (p.tipo === "no_ultima_ora") {
        for (const s of oreDocente) {
          if (!giornoCompatibile(p, s.giorno)) continue;
          const oreGiornoGriglia = slotsByDay.get(s.giorno) ?? [];
          const ultimaOra = oreGiornoGriglia[oreGiornoGriglia.length - 1]?.ora;
          if (s.ora === ultimaOra) {
            violazioniDocente++;
            dettagli.push({ teacherId, tipo: p.tipo, giorno: s.giorno });
          }
        }
      }

      if (p.tipo === "no_ora_specifica") {
        const oraRichiesta = oraDaDettaglio(p.dettaglio);
        if (oraRichiesta !== undefined) {
          for (const s of oreDocente) {
            if (!giornoCompatibile(p, s.giorno)) continue;
            if (s.ora === oraRichiesta) {
              violazioniDocente++;
              dettagli.push({ teacherId, tipo: p.tipo, giorno: s.giorno, ora: s.ora });
            }
          }
        }
      }

      if (p.tipo === "evita_buchi") {
        const giorniConOre = new Map<number, number[]>();
        for (const s of oreDocente) {
          if (!giorniConOre.has(s.giorno)) giorniConOre.set(s.giorno, []);
          giorniConOre.get(s.giorno)!.push(s.ora);
        }
        for (const [giorno, ore] of giorniConOre.entries()) {
          const ordinate = [...ore].sort((a, b) => a - b);
          for (let i = 1; i < ordinate.length; i++) {
            if (ordinate[i] - ordinate[i - 1] > 1) {
              violazioniDocente++;
              dettagli.push({ teacherId, tipo: p.tipo, giorno });
            }
          }
        }
      }
    }

    violazioni += violazioniDocente;
    if (violazioniDocente > 0) docentiViolati.add(teacherId);
  }
  return { totale: violazioni, docenti: docentiViolati, dettagli };
}

// Ora minima per calcolare le violazioni di preferenza di un orario già
// esistente (salvato in database), sia esso stato prodotto dalla
// generazione automatica sia modificato/inserito a mano in seguito. Usata
// dall'interfaccia per mostrare l'elenco delle violazioni sempre allineato
// all'orario effettivamente salvato, anche dopo un ricaricamento della
// pagina (a differenza del risultato di generaOrario, che vive solo in
// memoria finché non si genera di nuovo).
export interface EntrataValutabile {
  teacher_id: number;
  time_slot_id: number;
}

export function calcolaViolazioni(
  entries: EntrataValutabile[],
  timeSlots: TimeSlot[],
  preferenze: Preferenza[]
): { totale: number; docenti: Set<number>; dettagli: ViolazionePreferenza[] } {
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

  const unita: Unita[] = entries.map((e, i) => ({
    unitaId: i,
    assegnazioneId: -1,
    teacherId: e.teacher_id,
    classId: -1,
    subjectId: -1,
    modalita: "indifferente",
  }));
  const piano = new Map<number, number>();
  entries.forEach((e, i) => piano.set(i, e.time_slot_id));

  return contaViolazioni(unita, piano, slotById, prefsByTeacher, slotsByDay);
}

// ============================================================
// Wrapper "a step": esegue generaOrario a piccoli blocchi di tempo,
// lasciando respirare il browser tra un blocco e l'altro (utile per
// non bloccare l'interfaccia durante una ricerca anche lunga, fino al
// tempo massimo passato dal chiamante in scadenzaTotale)
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
  // La dimensione del blocco e' adattiva: con orari grandi (molte classi,
  // molte ore) anche un solo tentativo completo puo' richiedere centinaia
  // di millisecondi o piu', quindi un blocco troppo piccolo verrebbe quasi
  // sempre interrotto a meta' senza mai completare un tentativo, sprecando
  // il tempo a disposizione. Si parte piccoli (per non bloccare l'interfaccia
  // troppo a lungo su orari piccoli/veloci) e si raddoppia ogni volta che un
  // blocco si esaurisce senza trovare nessuna combinazione completa.
  const CHUNK_MS_INIZIALE = 200;
  const CHUNK_MS_MASSIMO = 5000;
  let chunkMs = CHUNK_MS_INIZIALE;
  let migliore: GeneraOrarioOutput | null = null;
  // Migliore combinazione PARZIALE (incompleta) vista in un qualsiasi
  // blocco, tenuta da parte nel caso in cui nessun blocco riesca mai a
  // completare l'intero orario entro il tempo totale disponibile: meglio
  // restituire il meglio ottenuto che un fallimento totale senza nulla.
  let migliorParziale: GeneraOrarioOutput | null = null;
  let tentativiTotali = 0;
  // Docenti a cui dare priorita' nel prossimo blocco: si aggiorna solo
  // quando si trova un nuovo MIGLIOR risultato (non ad ogni tentativo
  // riuscito), cosi' la ricerca insegue in modo stabile i problemi della
  // combinazione migliore trovata finora, invece di rincorrere rumore da
  // tentativi che potrebbero essere peggiori di quello gia' trovato.
  let docentiPrioritari: Set<number> | undefined = input.docentiPrioritari;

  while (Date.now() < input.scadenzaTotale) {
    const inizioBlocco = Date.now();
    const scadenzaChunk = Math.min(inizioBlocco + chunkMs, input.scadenzaTotale);
    const risultato = generaOrario({ ...input, docentiPrioritari, scadenza: scadenzaChunk });
    tentativiTotali += risultato.tentativi;

    if (risultato.riuscito) {
      // Teniamo la combinazione completa con meno preferenze violate finora
      // trovata: continuiamo a cercare (entro il tempo totale disponibile)
      // finché non ne troviamo una perfetta (0 violazioni) o finisce il
      // tempo. Con la ricerca parallela (vedi schedulerParallelo.ts) l'intero
      // processo si ferma subito non appena UNO dei worker trova un
      // risultato perfetto: vedi il commento li' per i dettagli.
      if (!migliore || risultato.preferenzeViolate < migliore.preferenzeViolate) {
        migliore = risultato;
        docentiPrioritari = risultato.docentiViolati.size > 0 ? risultato.docentiViolati : undefined;
      }
    } else {
      // Il blocco e' scaduto senza trovare nessuna combinazione completa:
      // era troppo corto per questo orario, il prossimo sara' piu' lungo.
      chunkMs = Math.min(chunkMs * 2, CHUNK_MS_MASSIMO);
      // Teniamo comunque da parte la migliore combinazione PARZIALE vista in
      // questo blocco, nel caso non si arrivi mai a una combinazione completa.
      if (
        risultato.entries.length > 0 &&
        (!migliorParziale || risultato.oreAssegnate > migliorParziale.oreAssegnate)
      ) {
        migliorParziale = risultato;
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
  // Nessun blocco ha mai completato l'intero orario: restituiamo la
  // migliore combinazione PARZIALE trovata, se ce n'e' una, invece di un
  // fallimento totale senza nulla da mostrare o salvare.
  if (migliorParziale) {
    return { ...migliorParziale, tentativi: tentativiTotali };
  }
  return {
    riuscito: false,
    entries: [],
    preferenzeViolate: 0,
    preferenzeValutabili: input.preferenze.length,
    tentativi: tentativiTotali,
    docentiViolati: new Set(),
    dettagliViolazioni: [],
    oreAssegnate: 0,
    oreTotali: 0,
  };
}
