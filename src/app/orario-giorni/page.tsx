"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { esportaOrarioPerGiorni } from "@/lib/exportExcel";
import type { Classe, Docente, Materia, TimeSlot } from "@/lib/types";

const GIORNI_TUTTI = [
  { valore: 1, label: "Lunedì" },
  { valore: 2, label: "Martedì" },
  { valore: 3, label: "Mercoledì" },
  { valore: 4, label: "Giovedì" },
  { valore: 5, label: "Venerdì" },
  { valore: 6, label: "Sabato" },
  { valore: 7, label: "Domenica" },
];

interface EntrataOrario {
  id: number;
  class_id: number;
  teacher_id: number;
  subject_id: number;
  time_slot_id: number;
  manual: boolean;
}

export default function OrarioGiorniPage() {
  const [classi, setClassi] = useState<Classe[]>([]);
  const [docenti, setDocenti] = useState<Docente[]>([]);
  const [materie, setMaterie] = useState<Materia[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [entrate, setEntrate] = useState<EntrataOrario[]>([]);
  const [giorniSettimana, setGiorniSettimana] = useState(6);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);

  async function caricaTutto() {
    setLoading(true);
    const [c, d, m, sc, ts, en] = await Promise.all([
      supabase.from("classes").select("id, anno, sezione, nome").order("anno").order("sezione"),
      supabase.from("teachers").select("id, nome, cognome, email, colore").order("cognome"),
      supabase.from("subjects").select("id, nome").order("nome"),
      supabase.from("school_config").select("giorni_settimana").eq("id", 1).single(),
      supabase.from("time_slots").select("id, giorno, ora").order("giorno").order("ora"),
      supabase
        .from("schedule_entries")
        .select("id, class_id, teacher_id, subject_id, time_slot_id, manual"),
    ]);
    const errori = [c.error, d.error, m.error, ts.error, en.error].filter(Boolean);
    if (errori.length > 0) {
      setErrore(errori.map((e) => e!.message).join(" / "));
    } else {
      setClassi((c.data as Classe[]) ?? []);
      setDocenti((d.data as Docente[]) ?? []);
      setMaterie((m.data as Materia[]) ?? []);
      const giorniConfigurati = sc.data
        ? (sc.data as { giorni_settimana: number }).giorni_settimana
        : giorniSettimana;
      if (sc.data) setGiorniSettimana(giorniConfigurati);

      // Stessa normalizzazione della pagina Orario: uno slot canonico per
      // ogni giorno/ora, cosi' la vista e l'export usano sempre gli stessi dati.
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

  async function esporta() {
    try {
      await esportaOrarioPerGiorni(classi, {
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Orario per giorni</h1>
          <p className="mt-1 text-gray-600">
            Stesso orario della pagina Orario, con una tabella per ogni
            giorno (tutte le classi affiancate) impilate nella stessa pagina.
          </p>
        </div>
        <button
          onClick={esporta}
          disabled={loading || classi.length === 0}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Esporta in Excel
        </button>
      </div>

      {errore && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{errore}</div>
      )}

      {!loading && classi.length > 0 && timeSlots.length > 0 && (
        <div className="space-y-10">
          {giorni.map((g) => (
            <GrigliaGiorno
              key={g.valore}
              giorno={g}
              classi={classi}
              oreMax={oreMax}
              timeSlots={timeSlots}
              entrate={entrate}
              docenteById={docenteById}
              materiaById={materiaById}
            />
          ))}
        </div>
      )}

      {!loading && (classi.length === 0 || timeSlots.length === 0) && (
        <p className="text-sm text-gray-400">
          Nessun orario da mostrare: configura classi e griglia oraria nella
          pagina Orario.
        </p>
      )}

      {loading && <p className="text-sm text-gray-400">Caricamento...</p>}
    </div>
  );
}

function GrigliaGiorno({
  giorno,
  classi,
  oreMax,
  timeSlots,
  entrate,
  docenteById,
  materiaById,
}: {
  giorno: { valore: number; label: string };
  classi: Classe[];
  oreMax: number;
  timeSlots: TimeSlot[];
  entrate: EntrataOrario[];
  docenteById: Map<number, Docente>;
  materiaById: Map<number, Materia>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-2 font-medium text-gray-900">{giorno.label}</h2>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="w-10 border-b border-gray-200 pb-2 text-left text-xs text-gray-400">
              Ora
            </th>
            {classi.map((c) => (
              <th
                key={c.id}
                className="border-b border-gray-200 pb-2 text-left text-xs text-gray-500"
              >
                {c.nome}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: oreMax }, (_, i) => i + 1).map((ora) => {
            const slot = timeSlots.find((s) => s.giorno === giorno.valore && s.ora === ora);
            return (
              <tr key={ora}>
                <td className="py-1 pr-2 align-top text-xs text-gray-400">{ora}</td>
                {classi.map((classe) => {
                  const entrata = slot
                    ? entrate.find((e) => e.time_slot_id === slot.id && e.class_id === classe.id)
                    : undefined;
                  const docente = entrata ? docenteById.get(entrata.teacher_id) : undefined;
                  const materia = entrata ? materiaById.get(entrata.subject_id) : undefined;
                  return (
                    <td key={classe.id} className="p-1 align-top">
                      {entrata ? (
                        <div
                          className={`min-w-[6rem] rounded px-2 py-1 text-xs ${
                            entrata.manual
                              ? "border border-gray-400"
                              : "border border-dashed border-gray-400"
                          }`}
                          style={{ backgroundColor: docente?.colore ?? "#f3f4f6" }}
                        >
                          <div className="font-medium text-black">{materia?.nome ?? "—"}</div>
                          <div className="text-black">
                            {docente ? `${docente.cognome} ${docente.nome}` : "—"}
                          </div>
                        </div>
                      ) : (
                        <div className="flex h-10 min-w-[6rem] items-center justify-center rounded border border-dashed border-gray-200 text-gray-300">
                          —
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
