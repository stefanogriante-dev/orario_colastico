"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { Classe, Materia, Docente, Modalita, Assegnazione } from "@/lib/types";

const MODALITA_LABEL: Record<Modalita, string> = {
  coppie: "A coppie",
  separate: "Separate",
  indifferente: "Indifferente",
};

export default function DocentiPage() {
  const [docenti, setDocenti] = useState<Docente[]>([]);
  const [classi, setClassi] = useState<Classe[]>([]);
  const [materie, setMaterie] = useState<Materia[]>([]);
  const [assegnazioni, setAssegnazioni] = useState<Assegnazione[]>([]);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);
  const [nuovoDocente, setNuovoDocente] = useState({
    nome: "",
    cognome: "",
    email: "",
  });
  const [docenteAperto, setDocenteAperto] = useState<number | null>(null);

  async function caricaTutto() {
    setLoading(true);
    const [d, c, m, a] = await Promise.all([
      supabase.from("teachers").select("id, nome, cognome, email").order("cognome"),
      supabase
        .from("classes")
        .select("id, anno, sezione, nome")
        .order("anno")
        .order("sezione"),
      supabase.from("subjects").select("id, nome").order("nome"),
      supabase
        .from("teacher_classes")
        .select(
          "id, teacher_id, ore_settimanali, modalita, classes(id,nome), subjects(id,nome)"
        ),
    ]);
    const errori = [d.error, c.error, m.error, a.error].filter(Boolean);
    if (errori.length > 0) {
      setErrore(errori.map((e) => e!.message).join(" / "));
    } else {
      setDocenti((d.data as Docente[]) ?? []);
      setClassi((c.data as Classe[]) ?? []);
      setMaterie((m.data as Materia[]) ?? []);
      setAssegnazioni((a.data as unknown as Assegnazione[]) ?? []);
      setErrore(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    caricaTutto();
  }, []);

  async function aggiungiDocente(e: React.FormEvent) {
    e.preventDefault();
    if (!nuovoDocente.nome.trim() || !nuovoDocente.cognome.trim()) return;
    const { error } = await supabase.from("teachers").insert({
      nome: nuovoDocente.nome.trim(),
      cognome: nuovoDocente.cognome.trim(),
      email: nuovoDocente.email.trim() || null,
    });
    if (error) {
      setErrore(error.message);
    } else {
      setErrore(null);
      setNuovoDocente({ nome: "", cognome: "", email: "" });
    }
    caricaTutto();
  }

  async function eliminaDocente(id: number) {
    if (
      !confirm(
        "Eliminare questo docente? Verranno rimosse anche le sue assegnazioni e le ore in orario."
      )
    )
      return;
    const { error } = await supabase.from("teachers").delete().eq("id", id);
    setErrore(error ? error.message : null);
    caricaTutto();
  }

  async function aggiungiMateria(nome: string): Promise<number | null> {
    const esistente = materie.find(
      (m) => m.nome.toLowerCase() === nome.toLowerCase()
    );
    if (esistente) return esistente.id;
    const { data, error } = await supabase
      .from("subjects")
      .insert({ nome })
      .select("id")
      .single();
    if (error) {
      setErrore(error.message);
      return null;
    }
    return (data as { id: number }).id;
  }

  async function aggiungiAssegnazione(
    teacherId: number,
    form: { classId: number; materiaNome: string; ore: number; modalita: Modalita }
  ) {
    if (!form.classId || !form.materiaNome.trim() || !form.ore) return;
    const subjectId = await aggiungiMateria(form.materiaNome.trim());
    if (!subjectId) return;
    const { error } = await supabase.from("teacher_classes").insert({
      teacher_id: teacherId,
      class_id: form.classId,
      subject_id: subjectId,
      ore_settimanali: form.ore,
      modalita: form.modalita,
    });
    setErrore(error ? error.message : null);
    caricaTutto();
  }

  async function eliminaAssegnazione(id: number) {
    const { error } = await supabase.from("teacher_classes").delete().eq("id", id);
    setErrore(error ? error.message : null);
    caricaTutto();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Docenti</h1>
        <p className="mt-1 text-gray-600">
          Anagrafica docenti e assegnazione a classi, materie e ore
          settimanali.
        </p>
      </div>

      {errore && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {errore}
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-medium text-gray-900">Nuovo docente</h2>
        <form
          onSubmit={aggiungiDocente}
          className="mt-2 flex flex-wrap items-end gap-2"
        >
          <div>
            <label className="block text-xs text-gray-500">Nome</label>
            <input
              className="rounded border border-gray-300 px-2 py-1 text-sm"
              value={nuovoDocente.nome}
              onChange={(e) =>
                setNuovoDocente((p) => ({ ...p, nome: e.target.value }))
              }
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500">Cognome</label>
            <input
              className="rounded border border-gray-300 px-2 py-1 text-sm"
              value={nuovoDocente.cognome}
              onChange={(e) =>
                setNuovoDocente((p) => ({ ...p, cognome: e.target.value }))
              }
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500">
              Email (opzionale)
            </label>
            <input
              type="email"
              className="rounded border border-gray-300 px-2 py-1 text-sm"
              value={nuovoDocente.email}
              onChange={(e) =>
                setNuovoDocente((p) => ({ ...p, email: e.target.value }))
              }
            />
          </div>
          <button
            type="submit"
            className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white"
          >
            Aggiungi
          </button>
        </form>
      </div>

      <div className="space-y-3">
        {docenti.map((docente) => (
          <DocenteRiga
            key={docente.id}
            docente={docente}
            classi={classi}
            materie={materie}
            assegnazioni={assegnazioni.filter((a) => a.teacher_id === docente.id)}
            aperto={docenteAperto === docente.id}
            onToggle={() =>
              setDocenteAperto(docenteAperto === docente.id ? null : docente.id)
            }
            onElimina={() => eliminaDocente(docente.id)}
            onAggiungiAssegnazione={(form) => aggiungiAssegnazione(docente.id, form)}
            onEliminaAssegnazione={eliminaAssegnazione}
          />
        ))}
        {docenti.length === 0 && !loading && (
          <p className="text-sm text-gray-400">Nessun docente inserito.</p>
        )}
      </div>

      {loading && <p className="text-sm text-gray-400">Caricamento...</p>}
    </div>
  );
}

function DocenteRiga({
  docente,
  classi,
  materie,
  assegnazioni,
  aperto,
  onToggle,
  onElimina,
  onAggiungiAssegnazione,
  onEliminaAssegnazione,
}: {
  docente: Docente;
  classi: Classe[];
  materie: Materia[];
  assegnazioni: Assegnazione[];
  aperto: boolean;
  onToggle: () => void;
  onElimina: () => void;
  onAggiungiAssegnazione: (form: {
    classId: number;
    materiaNome: string;
    ore: number;
    modalita: Modalita;
  }) => void;
  onEliminaAssegnazione: (id: number) => void;
}) {
  const [form, setForm] = useState({
    classId: 0,
    materiaNome: "",
    ore: 1,
    modalita: "indifferente" as Modalita,
  });

  const oreTotali = assegnazioni.reduce((tot, a) => tot + a.ore_settimanali, 0);

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-medium text-gray-900">
          {docente.cognome} {docente.nome}
        </span>
        <span className="text-sm text-gray-500">{oreTotali} ore/settimana</span>
      </button>

      {aperto && (
        <div className="space-y-3 border-t border-gray-100 px-4 py-3">
          <ul className="space-y-1 text-sm text-gray-700">
            {assegnazioni.map((a) => (
              <li key={a.id} className="flex items-center justify-between">
                <span>
                  {a.classes?.nome} — {a.subjects?.nome} — {a.ore_settimanali}h —{" "}
                  {MODALITA_LABEL[a.modalita]}
                </span>
                <button
                  onClick={() => onEliminaAssegnazione(a.id)}
                  className="text-xs text-red-600 hover:underline"
                >
                  rimuovi
                </button>
              </li>
            ))}
            {assegnazioni.length === 0 && (
              <li className="text-gray-400">Nessuna classe assegnata</li>
            )}
          </ul>

          <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
            <div>
              <label className="block text-xs text-gray-500">Classe</label>
              <select
                className="rounded border border-gray-300 px-2 py-1 text-sm"
                value={form.classId}
                onChange={(e) =>
                  setForm((p) => ({ ...p, classId: Number(e.target.value) }))
                }
              >
                <option value={0}>Seleziona...</option>
                {classi.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500">Materia</label>
              <input
                list={`materie-${docente.id}`}
                className="w-32 rounded border border-gray-300 px-2 py-1 text-sm"
                value={form.materiaNome}
                onChange={(e) =>
                  setForm((p) => ({ ...p, materiaNome: e.target.value }))
                }
                placeholder="es. Matematica"
              />
              <datalist id={`materie-${docente.id}`}>
                {materie.map((m) => (
                  <option key={m.id} value={m.nome} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block text-xs text-gray-500">Ore/sett.</label>
              <input
                type="number"
                min={1}
                max={30}
                className="w-16 rounded border border-gray-300 px-2 py-1 text-sm"
                value={form.ore}
                onChange={(e) =>
                  setForm((p) => ({ ...p, ore: Number(e.target.value) }))
                }
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500">Modalità ore</label>
              <select
                className="rounded border border-gray-300 px-2 py-1 text-sm"
                value={form.modalita}
                onChange={(e) =>
                  setForm((p) => ({ ...p, modalita: e.target.value as Modalita }))
                }
              >
                <option value="indifferente">Indifferente</option>
                <option value="coppie">A coppie</option>
                <option value="separate">Separate</option>
              </select>
            </div>
            <button
              onClick={() => {
                onAggiungiAssegnazione(form);
                setForm({ classId: 0, materiaNome: "", ore: 1, modalita: "indifferente" });
              }}
              className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white"
            >
              Aggiungi
            </button>
          </div>

          <button onClick={onElimina} className="text-xs text-red-600 hover:underline">
            Elimina docente
          </button>
        </div>
      )}
    </div>
  );
}
