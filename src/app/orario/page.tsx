"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  calcolaViolazioni,
  type AssegnazioneInput,
  type ViolazionePreferenza,
} from "@/lib/scheduler";
import { generaOrarioParallelo } from "@/lib/schedulerParallelo";
import { generaOrarioCpSat } from "@/lib/schedulerCpSat";
import { esportaOrarioPerClassi } from "@/lib/exportExcel";
import type { Classe, ConfigurazioneScuola, Docente, Materia, Preferenza, TimeSlot } from "@/lib/types";

const GIORNI_TUTTI = [
  { valore: 1, label: "Lunedì" },
  { valore: 2, label: "Martedì" },
  { valore: 3, label: "Mercoledì" },
  { valore: 4, label: "Giovedì" },
  { valore: 5, label: "Venerdì" },
  { valore: 6, label: "Sabato" },
  { valore: 7, label: "Domenica" },
];

// Impostazioni di default della generazione: usate finché school_config non
// è stato caricato, e come fallback per righe create prima della migrazione
// che ha aggiunto queste colonne.
const IMPOSTAZIONI_DEFAULT: ConfigurazioneScuola = {
  giorni_settimana: 6,
  vincolo_max_ore_classe_giorno: true,
  vincolo_motoria_arte_tecnologia: true,
  durata_generazione_minuti: 5,
};

const TIPO_LABEL: Record<ViolazionePreferenza["tipo"], string> = {
  giorno_libero: "Giorno libero",
  no_prima_ora: "Evita la prima ora",
  no_ultima_ora: "Evita l'ultima ora",
  no_ora_specifica: "Evita un'ora specifica",
  evita_buchi: "Evita ore buche",
  altro: "Altro",
};

function giornoLabel(giorno: number | undefined): string {
  if (giorno === undefined) return "";
  return GIORNI_TUTTI.find((g) => g.valore === giorno)?.label ?? "";
}

interface EntrataOrario {
  id: number;
  class_id: number;
  teacher_id: number;
  subject_id: number;
  time_slot_id: number;
  manual: boolean;
}

interface CellaAperta {
  classId: number;
  slotId: number;
}

function traduciErroreConflitto(msg: string): string {
  if (msg.includes("teacher_id_time_slot_id")) {
    return "Questo docente è già impegnato in un'altra classe in questo stesso orario.";
  }
  if (msg.includes("class_id_time_slot_id")) {
    return "Questa classe ha già una lezione in questo stesso orario.";
  }
  return msg;
}

export default function OrarioPage() {
  const [classi, setClassi] = useState<Classe[]>([]);
  const [docenti, setDocenti] = useState<Docente[]>([]);
  const [materie, setMaterie] = useState<Materia[]>([]);
  const [assegnazioni, setAssegnazioni] = useState<AssegnazioneInput[]>([]);
  const [preferenze, setPreferenze] = useState<Preferenza[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [entrate, setEntrate] = useState<EntrataOrario[]>([]);
  const [giorniSettimana, setGiorniSettimana] = useState(6);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);

  // Impostazioni della generazione automatica: quali vincoli rigidi
  // opzionali sono attivi e per quanti minuti la ricerca prova a
  // completare l'orario. Caricate da school_config e salvate lì ad ogni
  // modifica, così restano le stesse tra una sessione e l'altra.
  const [impostazioni, setImpostazioni] = useState<ConfigurazioneScuola>(IMPOSTAZIONI_DEFAULT);

  const [cellaAperta, setCellaAperta] = useState<CellaAperta | null>(null);
  const [oreAlGiorno, setOreAlGiorno] = useState(5);

  const [generazioneInCorso, setGenerazioneInCorso] = useState(false);
  const [operazioneInCorso, setOperazioneInCorso] = useState(false);
  const [progresso, setProgresso] = useState<{
    tentativi: number;
    secondi: number;
    workerAttivi?: number;
  } | null>(null);
  const [esitoGenerazione, setEsitoGenerazione] = useState<
    { tipo: "successo" | "fallimento"; messaggio: string } | null
  >(null);

  async function caricaTutto() {
    setLoading(true);
    const [c, d, m, a, p, sc, ts, en] = await Promise.all([
      supabase.from("classes").select("id, anno, sezione, nome").order("anno").order("sezione"),
      supabase.from("teachers").select("id, nome, cognome, email, colore").order("cognome"),
      supabase.from("subjects").select("id, nome").order("nome"),
      supabase
        .from("teacher_classes")
        .select("id, teacher_id, class_id, subject_id, ore_settimanali, modalita"),
      supabase.from("preferences").select("id, teacher_id, tipo, dettaglio, nota, stato"),
      supabase
        .from("school_config")
        .select(
          "giorni_settimana, vincolo_max_ore_classe_giorno, vincolo_motoria_arte_tecnologia, durata_generazione_minuti"
        )
        .eq("id", 1)
        .single(),
      supabase.from("time_slots").select("id, giorno, ora").order("giorno").order("ora"),
      supabase
        .from("schedule_entries")
        .select("id, class_id, teacher_id, subject_id, time_slot_id, manual"),
    ]);
    const errori = [c.error, d.error, m.error, a.error, p.error, ts.error, en.error].filter(Boolean);
    if (errori.length > 0) {
      setErrore(errori.map((e) => e!.message).join(" / "));
    } else {
      setClassi((c.data as Classe[]) ?? []);
      setDocenti((d.data as Docente[]) ?? []);
      setMaterie((m.data as Materia[]) ?? []);
      setAssegnazioni((a.data as AssegnazioneInput[]) ?? []);
      setPreferenze((p.data as Preferenza[]) ?? []);
      const configCaricata = sc.data as ConfigurazioneScuola | null;
      const giorniConfigurati = configCaricata ? configCaricata.giorni_settimana : giorniSettimana;
      if (configCaricata) {
        setGiorniSettimana(giorniConfigurati);
        // Le colonne dei vincoli opzionali potrebbero non esistere ancora su
        // un database non migrato: si ripiega sui default per ciascun campo
        // singolarmente invece che sull'intera riga, così i giorni_settimana
        // già configurati non vengono comunque persi.
        setImpostazioni({
          giorni_settimana: giorniConfigurati,
          vincolo_max_ore_classe_giorno:
            configCaricata.vincolo_max_ore_classe_giorno ?? IMPOSTAZIONI_DEFAULT.vincolo_max_ore_classe_giorno,
          vincolo_motoria_arte_tecnologia:
            configCaricata.vincolo_motoria_arte_tecnologia ?? IMPOSTAZIONI_DEFAULT.vincolo_motoria_arte_tecnologia,
          durata_generazione_minuti:
            configCaricata.durata_generazione_minuti ?? IMPOSTAZIONI_DEFAULT.durata_generazione_minuti,
        });
      }
      // Alcuni slot potrebbero essere duplicati (stesso giorno/ora) o oltre i
      // giorni configurati: teniamo solo uno slot "canonico" per ogni
      // giorno/ora, cosi' la griglia mostrata e il motore di generazione
      // usano sempre esattamente le stesse celle.
      const slotCanonici = new Map<string, TimeSlot>();
      for (const s of (ts.data as TimeSlot[]) ?? []) {
        if (s.giorno > giorniConfigurati) continue;
        const chiave = `${s.giorno}-${s.ora}`;
        if (!slotCanonici.has(chiave)) slotCanonici.set(chiave, s);
      }
      const timeSlotsNormalizzati = Array.from(slotCanonici.values());
      const idSlotValidi = new Set(timeSlotsNormalizzati.map((s) => s.id));
      setTimeSlots(timeSlotsNormalizzati);
      setEntrate(((en.data as EntrataOrario[]) ?? []).filter((e) => idSlotValidi.has(e.time_slot_id)));
      setErrore(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    caricaTutto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const docenteById = useMemo(() => new Map(docenti.map((d) => [d.id, d])), [docenti]);
  const materiaById = useMemo(() => new Map(materie.map((m) => [m.id, m])), [materie]);

  const giorni = GIORNI_TUTTI.slice(0, giorniSettimana);
  const oreMax = useMemo(() => {
    const ore = timeSlots.map((s) => s.ora);
    return ore.length > 0 ? Math.max(...ore) : 0;
  }, [timeSlots]);

  // Vincolo rigido: nel giorno in cui una classe ha Scienze motorie non può
  // avere né Arte né Tecnologia (materie riconosciute per nome, stesso
  // criterio già usato per l'eccezione "doppia classe" di Scienze motorie).
  const materieMotoria = useMemo(() => {
    return new Set(
      materie.filter((m) => m.nome.toLowerCase().includes("motori")).map((m) => m.id)
    );
  }, [materie]);
  const materieEscluseConMotoria = useMemo(() => {
    return new Set(
      materie
        .filter((m) => {
          const nome = m.nome.toLowerCase();
          return nome.includes("arte") || nome.includes("tecnolog");
        })
        .map((m) => m.id)
    );
  }, [materie]);

  // Vincolo hard-coded (non piu' configurabile dall'interfaccia): solo la
  // prof.ssa De Pascalis puo' avere fino a NUMERO_MASSIMO_GIORNI_ECCEZIONE
  // giornate a settimana con LIMITE_ORE_GIORNO_ECCEZIONE ore; tutti gli
  // altri docenti sono sempre limitati a LIMITE_ORE_GIORNO_NORMALE ore al
  // giorno (vedi src/lib/scheduler.ts). Identificata per cognome, come
  // "Scienze motorie" per le materie qui sopra.
  const docentiOreEccezione = useMemo(() => {
    return new Set(
      docenti.filter((d) => d.cognome.toLowerCase().includes("pascalis")).map((d) => d.id)
    );
  }, [docenti]);

  // Elenco delle preferenze non rispettate nell'orario ATTUALMENTE salvato
  // (non solo appena generato): ricalcolato ogni volta che cambiano le ore
  // o le preferenze, cosi' resta corretto anche dopo un ricaricamento della
  // pagina o dopo modifiche manuali all'orario.
  const violazioniDettaglio = useMemo<ViolazionePreferenza[]>(() => {
    if (timeSlots.length === 0 || entrate.length === 0 || preferenze.length === 0) return [];
    return calcolaViolazioni(
      entrate.map((e) => ({ teacher_id: e.teacher_id, time_slot_id: e.time_slot_id })),
      timeSlots,
      preferenze
    ).dettagli;
  }, [entrate, timeSlots, preferenze]);

  // Docenti che nell'orario ATTUALMENTE salvato hanno 6 ore di lezione in un
  // giorno (il "giorno eccezione" concesso dal vincolo rigido: normalmente
  // massimo 5 ore/giorno, con una sola giornata a 6 ore consentita).
  const docentiSeiOre = useMemo(() => {
    if (timeSlots.length === 0 || entrate.length === 0) return [];
    const slotById = new Map(timeSlots.map((s) => [s.id, s]));
    const oreGiornoPerTeacher = new Map<string, number>();
    for (const e of entrate) {
      const slot = slotById.get(e.time_slot_id);
      if (!slot) continue;
      const chiave = `${e.teacher_id}-${slot.giorno}`;
      oreGiornoPerTeacher.set(chiave, (oreGiornoPerTeacher.get(chiave) ?? 0) + 1);
    }
    const risultato: { teacherId: number; giorno: number }[] = [];
    for (const [chiave, ore] of oreGiornoPerTeacher.entries()) {
      if (ore >= 6) {
        const [teacherIdStr, giornoStr] = chiave.split("-");
        risultato.push({ teacherId: Number(teacherIdStr), giorno: Number(giornoStr) });
      }
    }
    risultato.sort((a, b) => {
      const da = docenteById.get(a.teacherId);
      const db = docenteById.get(b.teacherId);
      const nomeA = da ? `${da.cognome} ${da.nome}` : "";
      const nomeB = db ? `${db.cognome} ${db.nome}` : "";
      return nomeA.localeCompare(nomeB) || a.giorno - b.giorno;
    });
    return risultato;
  }, [entrate, timeSlots, docenteById]);

  // Aggiorna una o più impostazioni della generazione (vincoli opzionali o
  // durata) e le salva subito in school_config, così restano le stesse
  // anche dopo un ricaricamento della pagina o in una sessione successiva.
  async function aggiornaImpostazioni(patch: Partial<ConfigurazioneScuola>) {
    const nuove = { ...impostazioni, ...patch };
    setImpostazioni(nuove);
    const { error } = await supabase
      .from("school_config")
      .update({
        vincolo_max_ore_classe_giorno: nuove.vincolo_max_ore_classe_giorno,
        vincolo_motoria_arte_tecnologia: nuove.vincolo_motoria_arte_tecnologia,
        durata_generazione_minuti: nuove.durata_generazione_minuti,
      })
      .eq("id", 1);
    if (error) setErrore(error.message);
  }

  async function generaGrigliaOraria() {
    if (oreAlGiorno < 1) return;
    const righe: { giorno: number; ora: number }[] = [];
    for (let giorno = 1; giorno <= giorniSettimana; giorno++) {
      for (let ora = 1; ora <= oreAlGiorno; ora++) {
        righe.push({ giorno, ora });
      }
    }
    const { error } = await supabase
      .from("time_slots")
      .upsert(righe, { onConflict: "giorno,ora", ignoreDuplicates: true });
    setErrore(error ? error.message : null);
    caricaTutto();
  }

  async function confermaAssegnazione(classId: number, slotId: number, teacherId: number, subjectId: number) {
    // Eccezione: solo per "Scienze motorie" e solo nell'inserimento manuale,
    // lo stesso docente può comparire nello stesso orario in due classi
    // diverse (es. due classi unite per l'attività motoria).
    const materiaSelezionata = materie.find((m) => m.id === subjectId);
    const permetteDoppiaClasse = materiaSelezionata?.nome.toLowerCase().includes("motori") ?? false;

    const { error } = await supabase.from("schedule_entries").insert({
      class_id: classId,
      teacher_id: teacherId,
      subject_id: subjectId,
      time_slot_id: slotId,
      manual: true,
      permette_doppia_classe: permetteDoppiaClasse,
    });
    if (error) {
      setErrore(traduciErroreConflitto(error.message));
    } else {
      setErrore(null);
      setCellaAperta(null);
      caricaTutto();
    }
  }

  async function eliminaEntrata(id: number) {
    if (!confirm("Eliminare questa ora dall'orario?")) return;
    const { error } = await supabase.from("schedule_entries").delete().eq("id", id);
    setErrore(error ? error.message : null);
    caricaTutto();
  }

  async function svuotaAutomatiche() {
    if (
      !confirm(
        "Rimuovere tutte le ore generate automaticamente da tutte le classi? Le ore inserite a mano non verranno toccate."
      )
    )
      return;
    setOperazioneInCorso(true);
    const { error } = await supabase.from("schedule_entries").delete().eq("manual", false);
    setErrore(error ? error.message : null);
    setEsitoGenerazione(null);
    await caricaTutto();
    setOperazioneInCorso(false);
  }

  async function svuotaTutto() {
    if (
      !confirm(
        "Svuotare COMPLETAMENTE l'orario di tutte le classi, comprese le ore inserite a mano? L'operazione non si può annullare."
      )
    )
      return;
    setOperazioneInCorso(true);
    const { error } = await supabase.from("schedule_entries").delete().gt("id", 0);
    setErrore(error ? error.message : null);
    setEsitoGenerazione(null);
    await caricaTutto();
    setOperazioneInCorso(false);
  }

  async function esporta() {
    try {
      await esportaOrarioPerClassi(classi, {
        giorni,
        oreMax,
        timeSlots,
        entrate,
        docenteById,
        materiaById,
      });
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Errore durante l'esportazione in Excel.");
    }
  }

  async function generaAutomaticamente() {
    setGenerazioneInCorso(true);
    setEsitoGenerazione(null);
    setProgresso({ tentativi: 0, secondi: 0 });

    const entrateManualiComplete = entrate.filter((e) => e.manual);
    const inizio = Date.now();
    const durataMs = impostazioni.durata_generazione_minuti * 60000;

    // Aggiorna i secondi trascorsi ogni secondo indipendentemente da quale
    // motore sta girando: il motore CP-SAT (vedi sotto) non riporta un
    // progresso incrementale come l'euristica (e' una singola chiamata che
    // risponde solo a fine ricerca), quindi senza questo timer l'utente non
    // vedrebbe alcun avanzamento durante l'attesa.
    const timerSecondi = setInterval(() => {
      setProgresso((precedente) => ({
        tentativi: precedente?.tentativi ?? 0,
        secondi: Math.round((Date.now() - inizio) / 1000),
        workerAttivi: precedente?.workerAttivi,
      }));
    }, 1000);

    const inputComune = {
      timeSlots,
      assegnazioni,
      entrateManuali: entrateManualiComplete.map((e) => ({
        teacher_id: e.teacher_id,
        class_id: e.class_id,
        subject_id: e.subject_id,
        time_slot_id: e.time_slot_id,
      })),
      preferenze,
      vincoliOpzionali: {
        maxOreClasseGiorno: impostazioni.vincolo_max_ore_classe_giorno,
      },
      // Vincolo hard-coded, sempre attivo: vedi la definizione di
      // docentiOreEccezione piu' sopra.
      docentiOreEccezione,
    };

    let risultato: {
      riuscito: boolean;
      entries: { teacher_id: number; class_id: number; subject_id: number; time_slot_id: number }[];
      preferenzeViolate: number;
      preferenzeValutabili: number;
      oreAssegnate: number;
      oreTotali: number;
      // Solo per il motore CP-SAT: "OPTIMAL" se il risolutore ha DIMOSTRATO
      // matematicamente che nessuna combinazione fa meglio (nessun tempo di
      // ricerca aggiuntivo cambierebbe il risultato), "FEASIBLE" se il tempo
      // a disposizione e' scaduto prima di riuscire a dimostrarlo (una
      // combinazione migliore potrebbe esistere). Assente per l'euristica di
      // riserva, che non fornisce questa garanzia.
      stato?: string;
    };
    // Quale motore ha effettivamente prodotto il risultato: mostrato
    // nel messaggio finale, cosi' e' sempre chiaro se si e' usato CP-SAT
    // o si e' ripiegato sull'euristica (il fallback prima avveniva in
    // modo completamente silenzioso, rendendo difficile capire perche'
    // una ricerca "andasse male" nonostante il motore piu' potente).
    let motoreUsato: "CP-SAT" | "euristica di riserva" = "CP-SAT";

    try {
      // Primo tentativo: motore CP-SAT (Google OR-Tools) sul server, che
      // trova sempre la combinazione OTTIMA entro il tempo a disposizione
      // invece di affidarsi a tentativi casuali come l'euristica.
      risultato = await generaOrarioCpSat(
        {
          ...inputComune,
          materieMotoria: impostazioni.vincolo_motoria_arte_tecnologia ? Array.from(materieMotoria) : [],
          materieEscluseConMotoria: impostazioni.vincolo_motoria_arte_tecnologia
            ? Array.from(materieEscluseConMotoria)
            : [],
          docentiOreEccezione: Array.from(docentiOreEccezione),
        },
        durataMs / 1000
      );
    } catch (erroreCpSat) {
      // Il motore CP-SAT non e' disponibile (backend non distribuito,
      // errore di rete, timeout) o ha risposto con un errore: ripieghiamo
      // sulla ricerca euristica nel browser, cosi' la generazione funziona
      // comunque anche senza il backend Python.
      console.warn("Motore CP-SAT non disponibile, uso la ricerca euristica locale:", erroreCpSat);
      motoreUsato = "euristica di riserva";
      risultato = await generaOrarioParallelo(
        {
          timeSlots,
          assegnazioni,
          entrateManuali: inputComune.entrateManuali,
          preferenze,
          // Il vincolo Motoria/Arte/Tecnologia si disattiva semplicemente non
          // passando gli insiemi delle materie coinvolte.
          materieMotoria: impostazioni.vincolo_motoria_arte_tecnologia ? materieMotoria : undefined,
          materieEscluseConMotoria: impostazioni.vincolo_motoria_arte_tecnologia
            ? materieEscluseConMotoria
            : undefined,
          vincoliOpzionali: inputComune.vincoliOpzionali,
          docentiOreEccezione,
          scadenzaTotale: inizio + durataMs,
        },
        (p) => {
          setProgresso({
            tentativi: p.tentativiTotali,
            secondi: Math.round(p.tempoTrascorsoMs / 1000),
            workerAttivi: p.workerAttivi,
          });
        }
      );
    } finally {
      clearInterval(timerSecondi);
    }

    // Tempo REALMENTE trascorso (non quello impostato in
    // impostazioni.durata_generazione_minuti): il motore CP-SAT sul
    // server ha un tetto massimo indipendente (vedi
    // MAX_SECONDI_SOLVER_LIMITE in api/genera-orario.py, legato al
    // "maxDuration" del piano Vercel) che puo' essere piu' basso del
    // tempo richiesto qui, quindi la ricerca puo' fermarsi prima. Usare
    // il tempo configurato nel messaggio sarebbe fuorviante: sembrerebbe
    // che la ricerca abbia usato tutto il tempo a disposizione quando
    // magari si e' fermata molto prima.
    const minutiTrascorsi = (Date.now() - inizio) / 60000;
    const minutiTrascorsiTesto =
      minutiTrascorsi < 1
        ? `${Math.max(1, Math.round(minutiTrascorsi * 60))} secondi`
        : `${minutiTrascorsi.toFixed(1).replace(/\.0$/, "")} minuti`;

    if (risultato.entries.length > 0) {
      // Salviamo il risultato anche quando la ricerca non e' riuscita a
      // completare TUTTE le ore entro il tempo massimo: in quel caso
      // generaOrarioProgressivo restituisce comunque la migliore
      // combinazione PARZIALE trovata, che mostriamo e salviamo al posto
      // di scartare tutto il lavoro fatto.
      const { error: delError } = await supabase.from("schedule_entries").delete().eq("manual", false);
      if (delError) {
        setErrore(delError.message);
        setGenerazioneInCorso(false);
        return;
      }
      const { error: insError } = await supabase
        .from("schedule_entries")
        .insert(risultato.entries.map((e) => ({ ...e, manual: false })));
      if (insError) {
        setErrore(insError.message);
        setGenerazioneInCorso(false);
        return;
      }
      setErrore(null);
      if (risultato.riuscito) {
        // Se il motore CP-SAT ha dimostrato l'ottimalita' (stato "OPTIMAL"),
        // lo segnaliamo esplicitamente: significa che nessuna combinazione
        // fa rispettare piu' preferenze di queste, quindi cercare ancora
        // (anche con piu' tempo) non cambierebbe il risultato. Se invece e'
        // solo "FEASIBLE" (tempo scaduto prima di dimostrarlo), lo
        // segnaliamo altrettanto: una combinazione migliore potrebbe
        // esistere e provare con piu' tempo potrebbe aiutare.
        const notaOttimalita =
          risultato.stato === "OPTIMAL"
            ? " Il risultato è provatamente il migliore possibile: nessuna ricerca più lunga potrebbe fare meglio, dati i vincoli rigidi attivi."
            : risultato.stato === "FEASIBLE"
              ? " Il tempo a disposizione è scaduto prima di dimostrare che questo sia il migliore possibile: una ricerca più lunga potrebbe (ma non è garantito) trovare una combinazione con meno preferenze violate."
              : "";
        setEsitoGenerazione({
          tipo: "successo",
          messaggio:
            risultato.preferenzeViolate === 0
              ? `Orario completato (motore: ${motoreUsato}): tutte le preferenze valutabili sono state rispettate.`
              : `Orario completato (motore: ${motoreUsato}) con ${risultato.preferenzeViolate} preferenza/e non rispettate su ${risultato.preferenzeValutabili}.${notaOttimalita}`,
        });
      } else {
        setEsitoGenerazione({
          tipo: "fallimento",
          messaggio: `Non è stato possibile completare l'orario in ${minutiTrascorsiTesto} (motore: ${motoreUsato}): assegnate ${risultato.oreAssegnate} ore su ${risultato.oreTotali}. È stata salvata la migliore combinazione parziale trovata (${risultato.preferenzeViolate} preferenza/e non rispettate su ${risultato.preferenzeValutabili}, elencate qui sotto). Prova a rimuovere o allentare qualche vincolo e riprova.`,
        });
      }
      caricaTutto();
    } else {
      setEsitoGenerazione({
        tipo: "fallimento",
        messaggio:
          `Non è stato possibile trovare nessuna combinazione valida in ${minutiTrascorsiTesto} (motore: ${motoreUsato}). Prova a rimuovere o allentare qualche vincolo (preferenza di un docente) e riprova.`,
      });
    }

    setGenerazioneInCorso(false);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Orario</h1>
        <p className="mt-1 text-gray-600">
          Editor a griglia: inserimento manuale, completamento o generazione
          automatica, con controllo delle sovrapposizioni tra classi.
        </p>
      </div>

      {errore && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{errore}</div>
      )}

      {timeSlots.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="font-medium text-gray-900">Griglia oraria</h2>
          <p className="mt-1 text-sm text-gray-600">
            Non è ancora stata configurata la griglia oraria della scuola.
            Indica quante ore ci sono ogni giorno (uguali per tutti i{" "}
            {giorniSettimana} giorni).
          </p>
          <div className="mt-2 flex items-end gap-2">
            <div>
              <label className="block text-xs text-gray-500">Ore al giorno</label>
              <input
                type="number"
                min={1}
                max={10}
                className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
                value={oreAlGiorno}
                onChange={(e) => setOreAlGiorno(Number(e.target.value))}
              />
            </div>
            <button
              onClick={generaGrigliaOraria}
              className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white"
            >
              Genera griglia
            </button>
          </div>
        </div>
      )}

      {timeSlots.length > 0 && (
        <>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={generaAutomaticamente}
                  disabled={generazioneInCorso || operazioneInCorso}
                  className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  {generazioneInCorso ? "Generazione in corso..." : "Genera automaticamente"}
                </button>
                <button
                  onClick={svuotaAutomatiche}
                  disabled={generazioneInCorso || operazioneInCorso}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 disabled:opacity-50"
                >
                  Svuota ore automatiche
                </button>
                <button
                  onClick={svuotaTutto}
                  disabled={generazioneInCorso || operazioneInCorso}
                  className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
                >
                  Svuota tutto l'orario
                </button>
                <button
                  onClick={esporta}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
                >
                  Esporta in Excel
                </button>
              </div>
            </div>

            <div className="mt-4 border-t border-gray-100 pt-4">
              <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Impostazioni generazione
              </h3>
              <div className="mt-2 flex flex-wrap items-start gap-x-6 gap-y-3">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={impostazioni.vincolo_max_ore_classe_giorno}
                    onChange={(e) =>
                      aggiornaImpostazioni({ vincolo_max_ore_classe_giorno: e.target.checked })
                    }
                  />
                  Massimo 2 ore al giorno per la stessa classe
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={impostazioni.vincolo_motoria_arte_tecnologia}
                    onChange={(e) =>
                      aggiornaImpostazioni({ vincolo_motoria_arte_tecnologia: e.target.checked })
                    }
                  />
                  Motoria esclude Arte/Tecnologia nello stesso giorno
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  Durata massima ricerca (minuti)
                  <input
                    type="number"
                    min={1}
                    max={30}
                    className="w-16 rounded border border-gray-300 px-2 py-1 text-sm"
                    value={impostazioni.durata_generazione_minuti}
                    onChange={(e) =>
                      aggiornaImpostazioni({ durata_generazione_minuti: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
            </div>

            {generazioneInCorso && progresso && (
              <p className="mt-2 text-xs text-gray-500">
                Ricerca in corso
                {progresso.workerAttivi && progresso.workerAttivi > 1
                  ? ` su ${progresso.workerAttivi} processi in parallelo`
                  : ""}
                ... {progresso.secondi}s / {impostazioni.durata_generazione_minuti * 60}s — {progresso.tentativi} tentativi
              </p>
            )}

            {esitoGenerazione && (
              <div
                className={`mt-3 rounded-md px-3 py-2 text-sm ${
                  esitoGenerazione.tipo === "successo"
                    ? "bg-green-50 text-green-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                {esitoGenerazione.messaggio}
              </div>
            )}

            <p className="mt-2 text-xs text-gray-400">
              Le ore inserite a mano (bordo pieno) non vengono mai toccate dalla
              generazione automatica. Le ore generate automaticamente (bordo
              tratteggiato) vengono ricalcolate ad ogni nuova generazione.
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Massimo ore/giorno per docente: sempre attivo, non disattivabile.
              Ogni docente è limitato a 5 ore al giorno, tranne De Pascalis che
              può averne 6 in massimo 2 giornate a settimana (mai di martedì).
            </p>
          </div>

          {violazioniDettaglio.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h2 className="text-sm font-medium text-amber-800">
                Preferenze non rispettate ({violazioniDettaglio.length})
              </h2>
              <ul className="mt-2 space-y-1 text-sm text-amber-700">
                {violazioniDettaglio.map((v, i) => {
                  const docente = docenteById.get(v.teacherId);
                  const nomeDocente = docente ? `${docente.cognome} ${docente.nome}` : "Docente sconosciuto";
                  const giorno = giornoLabel(v.giorno);
                  const dettagli = [v.ora ? `${v.ora}ª ora` : null, giorno || null]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <li key={i}>
                      {nomeDocente}: {TIPO_LABEL[v.tipo]}
                      {dettagli ? ` (${dettagli})` : ""}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {docentiSeiOre.length > 0 && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <h2 className="text-sm font-medium text-blue-800">
                Docenti con 6 ore in un giorno ({docentiSeiOre.length})
              </h2>
              <ul className="mt-2 space-y-1 text-sm text-blue-700">
                {docentiSeiOre.map((d, i) => {
                  const docente = docenteById.get(d.teacherId);
                  const nomeDocente = docente ? `${docente.cognome} ${docente.nome}` : "Docente sconosciuto";
                  return (
                    <li key={i}>
                      {nomeDocente}: {giornoLabel(d.giorno)}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="space-y-10">
            {classi.map((classe) => (
              <GrigliaClasse
                key={classe.id}
                classe={classe}
                giorni={giorni}
                oreMax={oreMax}
                timeSlots={timeSlots}
                entrateClasse={entrate.filter((e) => e.class_id === classe.id)}
                assegnazioniClasse={assegnazioni.filter((a) => a.class_id === classe.id)}
                docenti={docenti}
                materie={materie}
                docenteById={docenteById}
                materiaById={materiaById}
                cellaAperta={cellaAperta}
                onApriCella={(slotId) => setCellaAperta({ classId: classe.id, slotId })}
                onChiudiCella={() => setCellaAperta(null)}
                onConferma={(slotId, teacherId, subjectId) =>
                  confermaAssegnazione(classe.id, slotId, teacherId, subjectId)
                }
                onElimina={eliminaEntrata}
              />
            ))}
            {classi.length === 0 && !loading && (
              <p className="text-sm text-gray-400">
                Nessuna classe inserita. Aggiungile prima dalla pagina Classi.
              </p>
            )}
          </div>
        </>
      )}

      {loading && <p className="text-sm text-gray-400">Caricamento...</p>}
    </div>
  );
}

function GrigliaClasse({
  classe,
  giorni,
  oreMax,
  timeSlots,
  entrateClasse,
  assegnazioniClasse,
  docenti,
  materie,
  docenteById,
  materiaById,
  cellaAperta,
  onApriCella,
  onChiudiCella,
  onConferma,
  onElimina,
}: {
  classe: Classe;
  giorni: { valore: number; label: string }[];
  oreMax: number;
  timeSlots: TimeSlot[];
  entrateClasse: EntrataOrario[];
  assegnazioniClasse: AssegnazioneInput[];
  docenti: Docente[];
  materie: Materia[];
  docenteById: Map<number, Docente>;
  materiaById: Map<number, Materia>;
  cellaAperta: CellaAperta | null;
  onApriCella: (slotId: number) => void;
  onChiudiCella: () => void;
  onConferma: (slotId: number, teacherId: number, subjectId: number) => void;
  onElimina: (id: number) => void;
}) {
  const docentiDisponibili = useMemo(() => {
    const ids = new Set(assegnazioniClasse.map((a) => a.teacher_id));
    return docenti.filter((d) => ids.has(d.id));
  }, [assegnazioniClasse, docenti]);

  const oreRichieste = useMemo(
    () => assegnazioniClasse.reduce((tot, a) => tot + a.ore_settimanali, 0),
    [assegnazioniClasse]
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-medium text-gray-900">{classe.nome}</h2>
        <span className="text-xs text-gray-400">
          {entrateClasse.length} / {oreRichieste} ore assegnate
        </span>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="w-10 border-b border-gray-200 pb-2 text-left text-xs text-gray-400">
              Ora
            </th>
            {giorni.map((g) => (
              <th
                key={g.valore}
                className="border-b border-gray-200 pb-2 text-left text-xs text-gray-500"
              >
                {g.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: oreMax }, (_, i) => i + 1).map((ora) => (
            <tr key={ora}>
              <td className="py-1 pr-2 align-top text-xs text-gray-400">{ora}</td>
              {giorni.map((g) => {
                const slot = timeSlots.find((s) => s.giorno === g.valore && s.ora === ora);
                if (!slot) return <td key={g.valore} className="p-1" />;
                const entrata = entrateClasse.find((e) => e.time_slot_id === slot.id);
                return (
                  <td key={g.valore} className="p-1 align-top">
                    <CellaOrario
                      entrata={entrata}
                      docente={entrata ? docenteById.get(entrata.teacher_id) : undefined}
                      materia={entrata ? materiaById.get(entrata.subject_id) : undefined}
                      aperta={cellaAperta?.classId === classe.id && cellaAperta?.slotId === slot.id}
                      docentiDisponibili={docentiDisponibili}
                      materie={materie}
                      assegnazioniClasse={assegnazioniClasse}
                      onApri={() => onApriCella(slot.id)}
                      onChiudi={onChiudiCella}
                      onElimina={entrata ? () => onElimina(entrata.id) : undefined}
                      onConferma={(teacherId, subjectId) => onConferma(slot.id, teacherId, subjectId)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CellaOrario({
  entrata,
  docente,
  materia,
  aperta,
  docentiDisponibili,
  materie,
  assegnazioniClasse,
  onApri,
  onChiudi,
  onElimina,
  onConferma,
}: {
  entrata: EntrataOrario | undefined;
  docente: Docente | undefined;
  materia: Materia | undefined;
  aperta: boolean;
  docentiDisponibili: Docente[];
  materie: Materia[];
  assegnazioniClasse: AssegnazioneInput[];
  onApri: () => void;
  onChiudi: () => void;
  onElimina?: () => void;
  onConferma: (teacherId: number, subjectId: number) => void;
}) {
  const [teacherId, setTeacherId] = useState(0);
  const [subjectId, setSubjectId] = useState(0);

  const materieDisponibili = useMemo(() => {
    if (!teacherId) return [];
    const ids = assegnazioniClasse
      .filter((a) => a.teacher_id === teacherId)
      .map((a) => a.subject_id);
    return materie.filter((m) => ids.includes(m.id));
  }, [teacherId, assegnazioniClasse, materie]);

  if (entrata) {
    return (
      <div
        className={`min-w-[6rem] rounded px-2 py-1 text-xs ${
          entrata.manual ? "border border-gray-400" : "border border-dashed border-gray-400"
        }`}
        style={{ backgroundColor: docente?.colore ?? "#f3f4f6" }}
      >
        <div className="font-medium text-black">{materia?.nome ?? "—"}</div>
        <div className="text-black">
          {docente ? `${docente.cognome} ${docente.nome}` : "—"}
        </div>
        {onElimina && (
          <button onClick={onElimina} className="mt-1 text-[10px] text-black underline hover:opacity-70">
            rimuovi
          </button>
        )}
      </div>
    );
  }

  if (!aperta) {
    return (
      <button
        onClick={onApri}
        className="flex h-12 w-full min-w-[6rem] items-center justify-center rounded border border-dashed border-gray-200 text-gray-300 hover:border-gray-400 hover:text-gray-500"
      >
        +
      </button>
    );
  }

  return (
    <div className="min-w-[10rem] space-y-1 rounded border border-gray-300 bg-white p-2">
      <select
        className="w-full rounded border border-gray-300 px-1 py-0.5 text-xs"
        value={teacherId}
        onChange={(e) => {
          setTeacherId(Number(e.target.value));
          setSubjectId(0);
        }}
      >
        <option value={0}>Docente...</option>
        {docentiDisponibili.map((d) => (
          <option key={d.id} value={d.id}>
            {d.cognome} {d.nome}
          </option>
        ))}
      </select>
      <select
        className="w-full rounded border border-gray-300 px-1 py-0.5 text-xs"
        value={subjectId}
        onChange={(e) => setSubjectId(Number(e.target.value))}
        disabled={!teacherId}
      >
        <option value={0}>Materia...</option>
        {materieDisponibili.map((m) => (
          <option key={m.id} value={m.id}>
            {m.nome}
          </option>
        ))}
      </select>
      <div className="flex gap-1">
        <button
          onClick={() => teacherId && subjectId && onConferma(teacherId, subjectId)}
          className="flex-1 rounded bg-gray-900 px-1 py-0.5 text-[10px] text-white"
        >
          OK
        </button>
        <button
          onClick={onChiudi}
          className="flex-1 rounded border border-gray-300 px-1 py-0.5 text-[10px] text-gray-600"
        >
          Annulla
        </button>
      </div>
    </div>
  );
}
