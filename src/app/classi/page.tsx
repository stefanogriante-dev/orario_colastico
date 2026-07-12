"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Classe } from "@/lib/types";

const ANNI = [1, 2, 3, 4, 5];
const ANNI_LABEL: Record<number, string> = {
  1: "Prima",
  2: "Seconda",
  3: "Terza",
  4: "Quarta",
  5: "Quinta",
};

function letteraSezione(indice: number) {
  return String.fromCharCode(65 + indice);
}

export default function ClassiPage() {
  const [classi, setClassi] = useState<Classe[]>([]);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);
  const [numeroSezioni, setNumeroSezioni] = useState<Record<number, number>>({});
  const [sezioneManuale, setSezioneManuale] = useState({ anno: 1, sezione: "" });
  const [salvataggio, setSalvataggio] = useState(false);

  async function caricaClassi() {
    setLoading(true);
    const { data, error } = await supabase
      .from("classes")
      .select("id, anno, sezione, nome")
      .order("anno", { ascending: true })
      .order("sezione", { ascending: true });
    if (error) {
      setErrore(error.message);
    } else {
      setClassi((data as Classe[]) ?? []);
      setErrore(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    caricaClassi();
  }, []);

  async function generaSezioni(anno: number) {
    const n = numeroSezioni[anno];
    if (!n || n < 1) return;
    setSalvataggio(true);
    const righe = Array.from({ length: n }, (_, i) => ({
      anno,
      sezione: letteraSezione(i),
    }));
    const { error } = await supabase
      .from("classes")
      .upsert(righe, { onConflict: "anno,sezione", ignoreDuplicates: true });
    setErrore(error ? error.message : null);
    setSalvataggio(false);
    caricaClassi();
  }

  async function aggiungiClasseManuale(e: React.FormEvent) {
    e.preventDefault();
    if (!sezioneManuale.sezione.trim()) return;
    setSalvataggio(true);
    const { error } = await supabase.from("classes").insert({
      anno: sezioneManuale.anno,
      sezione: sezioneManuale.sezione.trim().toUpperCase(),
    });
    if (error) {
      setErrore(error.message);
    } else {
      setErrore(null);
      setSezioneManuale({ anno: sezioneManuale.anno, sezione: "" });
    }
    setSalvataggio(false);
    caricaClassi();
  }

  async function eliminaClasse(id: number) {
    if (
      !confirm(
        "Eliminare questa classe? Verranno rimosse anche le assegnazioni e l'orario collegati."
      )
    )
      return;
    setSalvataggio(true);
    const { error } = await supabase.from("classes").delete().eq("id", id);
    setErrore(error ? error.message : null);
    setSalvataggio(false);
    caricaClassi();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Classi</h1>
        <p className="mt-1 text-gray-600">
          Indica quante sezioni ci sono per ogni anno: verranno generate
          automaticamente (1A, 1B, 1C...).
        </p>
      </div>

      {errore && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {errore}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ANNI.map((anno) => {
          const classiAnno = classi.filter((c) => c.anno === anno);
          return (
            <div
              key={anno}
              className="rounded-lg border border-gray-200 bg-white p-4"
            >
              <h2 className="font-medium text-gray-900">{ANNI_LABEL[anno]}</h2>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={10}
                  placeholder="n. sezioni"
                  className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
                  value={numeroSezioni[anno] ?? ""}
                  onChange={(e) =>
                    setNumeroSezioni((prev) => ({
                      ...prev,
                      [anno]: Number(e.target.value),
                    }))
                  }
                />
                <button
                  onClick={() => generaSezioni(anno)}
                  disabled={salvataggio}
                  className="rounded bg-gray-900 px-3 py-1 text-sm text-white disabled:opacity-50"
                >
                  Genera
                </button>
              </div>
              <ul className="mt-3 space-y-1 text-sm text-gray-700">
                {classiAnno.map((c) => (
                  <li key={c.id} className="flex items-center justify-between">
                    <span>{c.nome}</span>
                    <button
                      onClick={() => eliminaClasse(c.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      elimina
                    </button>
                  </li>
                ))}
                {classiAnno.length === 0 && (
                  <li className="text-gray-400">Nessuna classe</li>
                )}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-medium text-gray-900">Aggiungi una singola classe</h2>
        <form
          onSubmit={aggiungiClasseManuale}
          className="mt-2 flex flex-wrap items-end gap-2"
        >
          <div>
            <label className="block text-xs text-gray-500">Anno</label>
            <select
              className="rounded border border-gray-300 px-2 py-1 text-sm"
              value={sezioneManuale.anno}
              onChange={(e) =>
                setSezioneManuale((prev) => ({
                  ...prev,
                  anno: Number(e.target.value),
                }))
              }
            >
              {ANNI.map((a) => (
                <option key={a} value={a}>
                  {ANNI_LABEL[a]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500">Sezione</label>
            <input
              type="text"
              maxLength={3}
              placeholder="es. D"
              className="w-20 rounded border border-gray-300 px-2 py-1 text-sm uppercase"
              value={sezioneManuale.sezione}
              onChange={(e) =>
                setSezioneManuale((prev) => ({
                  ...prev,
                  sezione: e.target.value,
                }))
              }
            />
          </div>
          <button
            type="submit"
            disabled={salvataggio}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Aggiungi
          </button>
        </form>
      </div>

      {loading && <p className="text-sm text-gray-400">Caricamento...</p>}
    </div>
  );
}
