"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { generaOrarioProgressivo, type AssegnazioneInput } from "@/lib/scheduler";
import type { Classe, Docente, Materia, Preferenza, TimeSlot } from "@/lib/types";

const GIORNI_TUTTI = [
  { valore: 1, label: "Lunedì" },
  { valore: 2, label: "Martedì" },
  { valore: 3, label: "Mercoledì" },
  { valore: 4, label: "Giovedì" },
  { valore: 5, label: "Venerdì" },
  { valore: 6, label: "Sabato" },
  { valore: 7, label: "Domenica" },
];

const DURATA_GENERAZIONE_MS = 30000;

interface EntrataOrario {
  id: number;
  class_id: number;
  teacher_id: number;
  subject_id: number;
  time_slot_id: number;
  manual: boolean;
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

  const [classeSelezionata, setClasseSelezionata] = useState<number | null>(null);
  const [cellaAperta, setCellaAperta] = useState<number | null>(null);
  const [oreAlGiorno, setOreAlGiorno] = useState(5);

  const [generazioneInCorso, setGenerazioneInCorso] = useState(false);
  const [progresso, setProgresso] = useState<{ tentativi: number; secondi: number } | null>(null);
  const [esitoGenerazione, setEsitoGenerazione] = useState<
    { tipo: "successo" | "fallimento"; messaggio: string } | null
  >(null);

  async function caricaTutto() {
    setLoading(true);
    const [c, d, m, a, p, sc, ts, en] = await Promise.all([
      supabase.from("classes").select("id, anno, sezione, nome").order("anno").order("sezione"),
      supabase.from("teachers").select("id, nome, cognome, email").order("cognome"),
      supabase.from("subjects").select("id, nome").order("nome"),
      supabase
        .from("teacher_classes")
        .select("id, teacher_id, class_id, subject_id, ore_settimanali, modalita"),
      supabase.from("preferences").select("id, teacher_id, tipo, dettaglio, nota, stato"),
      supabase.from("school_config").select("giorni_settimana").eq("id", 1).single(),
      supabase.from("time_slots").select("id, giorno, ora").order("giorno").order("ora"),
      supabase
        .from("schedule_entries")
        .select("id, class_id, teacher_id, subject_id, time_slot_id, manual"),
    ]);
    const errori = [c.error, d.error, m.error, a.error, p.error, ts.error, en.error].filter(Boolean);
    if (errori.length > 0) {
      setErrore(errori.map((e) => e!.message).join(" / "));
    } else {
      const classiCaricate = (c.data as Classe[]) ?? [];
      setClassi(classiCaricate);
      setDocenti((d.data as Docente[]) ?? []);
      setMaterie((m.data as Materia[]) ?? []);
      setAssegnazioni((a.data as AssegnazioneInput[]) ?? []);
      setPreferenze((p.data as Preferenza[]) ?? []);
      if (sc.data) {
        setGiorniSettimana((sc.data as { giorni_settimana: number }).giorni_settimana);
      }
      setTimeSlots((ts.data as TimeSlot[]) ?? []);
      setEntrate((en.data as EntrataOrario[]) ?? []);
      setErrore(null);
      setClasseSelezionata((corrente) => corrente ?? classiCaricate[0]?.id ?? null);
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

  const entrateClasseSelezionata = useMemo(
    () => entrate.filter((e) => e.class_id === classeSelezionata),
    [entrate, classeSelezionata]
  );

  const assegnazioniClasse = useMemo(
    () => assegnazioni.filter((a) => a.class_id === classeSelezionata),
    [assegnazioni, classeSelezionata]
  );

  const docentiDisponibiliClasse = useMemo(() => {
    const ids = new Set(assegnazioniClasse.map((a) => a.teacher_id));
    return docenti.filter((d) => ids.has(d.id));
  }, [assegnazioniClasse, docenti]);

  const oreRichiesteClasse = useMemo(
    () => assegnazioniClasse.reduce((tot, a) => tot + a.ore_settimanali, 0),
    [assegnazioniClasse]
  );

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

  function apriCella(slotId: number) {
    setCellaAperta(slotId);
  }

  async function confermaAssegnazione(teacherId: number, subjectId: number) {
    if (!cellaAperta || !classeSelezionata) return;
    const { error } = await supabase.from("schedule_entries").insert({
      class_id: classeSelezionata,
      teacher_id: teacherId,
      subject_id: subjectId,
      time_slot_id: cellaAperta,
      manual: true,
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

  async function generaAutomaticamente() {
    setGenerazioneInCorso(true);
    setEsitoGenerazione(null);
    setProgresso({ tentativi: 0, secondi: 0 });

    const entrateManualiComplete = entrate.filter((e) => e.manual);
    const inizio = Date.now();

    const risultato = await generaOrarioProgressivo(
      {
        timeSlots,
        assegnazioni,
        entrateManuali: entrateManualiComplete.map((e) => ({
          teacher_id: e.teacher_id,
          class_id: e.class_id,
          time_slot_id: e.time_slot_id,
        })),
        preferenze,
        scadenzaTotale: inizio + DURATA_GENERAZIONE_MS,
      },
      (p) => {
        setProgresso({
          tentativi: p.tentativiTotali,
          secondi: Math.round(p.tempoTrascorsoMs / 1000),
        });
      }
    );

    if (risultato.riuscito) {
      const { error: delError } = await supabase.from("schedule_entries").delete().eq("manual", false);
      if (delError) {
        setErrore(delError.message);
        setGenerazioneInCorso(false);
        return;
      }
      if (risultato.entries.length > 0) {
        const { error: insError } = await supabase
          .from("schedule_entries")
          .insert(risultato.entries.map((e) => ({ ...e, manual: false })));
        if (insError) {
          setErrore(insError.message);
          setGenerazioneInCorso(false);
          return;
        }
      }
      setErrore(null);
      setEsitoGenerazione({
        tipo: "successo",
        messaggio:
          risultato.preferenzeViolate === 0
            ? "Orario completato: tutte le preferenze valutabili sono state rispettate."
            : `Orario completato con ${risultato.preferenzeViolate} preferenza/e non rispettate su ${risultato.preferenzeValutabili}.`,
      });
      caricaTutto();
    } else {
      setEsitoGenerazione({
        tipo: "fallimento",
        messaggio:
          "Non è stato possibile completare l'orario entro 30 secondi. Prova a rimuovere o allentare qualche vincolo (preferenza di un docente) e riprova.",
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
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">Classe</label>
                <select
                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                  value={classeSelezionata ?? 0}
                  onChange={(e) => {
                    setClasseSelezionata(Number(e.target.value));
                    setCellaAperta(null);
                  }}
                >
                  {classi.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
                {classeSelezionata && (
                  <span className="text-xs text-gray-400">
                    {entrateClasseSelezionata.length} / {oreRichiesteClasse} ore assegnate
                  </span>
                )}
              </div>

              <button
                onClick={generaAutomaticamente}
                disabled={generazioneInCorso}
                className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {generazioneInCorso ? "Generazione in corso..." : "Genera automaticamente"}
              </button>
            </div>

            {generazioneInCorso && progresso && (
              <p className="mt-2 text-xs text-gray-500">
                Ricerca in corso... {progresso.secondi}s / 30s — {progresso.tentativi} tentativi
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
          </div>

          {classeSelezionata && (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-4">
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
                        const entrata = entrateClasseSelezionata.find(
                          (e) => e.time_slot_id === slot.id
                        );
                        return (
                          <td key={g.valore} className="p-1 align-top">
                            <CellaOrario
                              entrata={entrata}
                              docente={entrata ? docenteById.get(entrata.teacher_id) : undefined}
                              materia={entrata ? materiaById.get(entrata.subject_id) : undefined}
                              aperta={cellaAperta === slot.id}
                              docentiDisponibili={docentiDisponibiliClasse}
                              materie={materie}
                              assegnazioniClasse={assegnazioniClasse}
                              onApri={() => apriCella(slot.id)}
                              onChiudi={() => setCellaAperta(null)}
                              onElimina={entrata ? () => eliminaEntrata(entrata.id) : undefined}
                              onConferma={confermaAssegnazione}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {loading && <p className="text-sm text-gray-400">Caricamento...</p>}
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
          entrata.manual
            ? "border border-gray-400 bg-white"
            : "border border-dashed border-gray-300 bg-gray-50"
        }`}
      >
        <div className="font-medium text-gray-800">{materia?.nome ?? "—"}</div>
        <div className="text-gray-500">
          {docente ? `${docente.cognome} ${docente.nome}` : "—"}
        </div>
        {onElimina && (
          <button onClick={onElimina} className="mt-1 text-[10px] text-red-600 hover:underline">
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
