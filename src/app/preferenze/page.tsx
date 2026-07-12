"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  Classe,
  Docente,
  Preferenza,
  TipoPreferenza,
  StatoPreferenza,
} from "@/lib/types";

const TIPO_LABEL: Record<TipoPreferenza, string> = {
  giorno_libero: "Giorno libero",
  no_prima_ora: "Evita la prima ora",
  no_ultima_ora: "Evita l'ultima ora",
  evita_buchi: "Evita ore buche",
  continuita_classe: "Continuità su una classe",
  altro: "Altro",
};

const STATO_LABEL: Record<StatoPreferenza, string> = {
  non_valutata: "Non valutata",
  soddisfatta: "Soddisfatta",
  non_soddisfatta: "Non soddisfatta",
};

const STATO_COLORE: Record<StatoPreferenza, string> = {
  non_valutata: "bg-gray-100 text-gray-700",
  soddisfatta: "bg-green-100 text-green-700",
  non_soddisfatta: "bg-red-100 text-red-700",
};

const GIORNI_TUTTI = [
  { valore: 1, label: "Lunedì" },
  { valore: 2, label: "Martedì" },
  { valore: 3, label: "Mercoledì" },
  { valore: 4, label: "Giovedì" },
  { valore: 5, label: "Venerdì" },
  { valore: 6, label: "Sabato" },
  { valore: 7, label: "Domenica" },
];

export default function PreferenzePage() {
  const [docenti, setDocenti] = useState<Docente[]>([]);
  const [classi, setClassi] = useState<Classe[]>([]);
  const [preferenze, setPreferenze] = useState<Preferenza[]>([]);
  const [giorniSettimana, setGiorniSettimana] = useState(6);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);
  const [docenteAperto, setDocenteAperto] = useState<number | null>(null);

  async function caricaTutto() {
    setLoading(true);
    const [d, c, p, sc] = await Promise.all([
      supabase.from("teachers").select("id, nome, cognome, email").order("cognome"),
      supabase
        .from("classes")
        .select("id, anno, sezione, nome")
        .order("anno")
        .order("sezione"),
      supabase
        .from("preferences")
        .select("id, teacher_id, tipo, dettaglio, nota, stato"),
      supabase.from("school_config").select("giorni_settimana").eq("id", 1).single(),
    ]);
    const errori = [d.error, c.error, p.error].filter(Boolean);
    if (errori.length > 0) {
      setErrore(errori.map((e) => e!.message).join(" / "));
    } else {
      setDocenti((d.data as Docente[]) ?? []);
      setClassi((c.data as Classe[]) ?? []);
      setPreferenze((p.data as Preferenza[]) ?? []);
      if (sc.data) setGiorniSettimana((sc.data as { giorni_settimana: number }).giorni_settimana);
      setErrore(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    caricaTutto();
  }, []);

  async function aggiungiPreferenza(
    teacherId: number,
    form: { tipo: TipoPreferenza; giorno: number; classId: number; nota: string }
  ) {
    let dettaglio: Record<string, unknown> | null = null;
    if (form.tipo === "giorno_libero") dettaglio = { giorno: form.giorno };
    if (form.tipo === "no_prima_ora" || form.tipo === "no_ultima_ora") {
      // giorno 0 = "Sempre": nessun dettaglio, si applica tutti i giorni
      dettaglio = form.giorno === 0 ? null : { giorno: form.giorno };
    }
    if (form.tipo === "continuita_classe") dettaglio = { class_id: form.classId };

    const { error } = await supabase.from("preferences").insert({
      teacher_id: teacherId,
      tipo: form.tipo,
      dettaglio,
      nota: form.nota.trim() || null,
      stato: "non_valutata",
    });
    setErrore(error ? error.message : null);
    caricaTutto();
  }

  async function cambiaStato(id: number, stato: StatoPreferenza) {
    const { error } = await supabase.from("preferences").update({ stato }).eq("id", id);
    setErrore(error ? error.message : null);
    caricaTutto();
  }

  async function eliminaPreferenza(id: number) {
    const { error } = await supabase.from("preferences").delete().eq("id", id);
    setErrore(error ? error.message : null);
    caricaTutto();
  }

  const giorni = GIORNI_TUTTI.slice(0, giorniSettimana);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Preferenze</h1>
        <p className="mt-1 text-gray-600">
          Vincoli espressi dai docenti: giorno libero, evitare prima/ultima
          ora, evitare buchi, continuità su una classe, ore consecutive o
          separate (queste ultime si impostano nella pagina Docenti).
        </p>
      </div>

      {errore && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {errore}
        </div>
      )}

      <div className="space-y-3">
        {docenti.map((docente) => (
          <DocentePreferenze
            key={docente.id}
            docente={docente}
            classi={classi}
            giorni={giorni}
            preferenze={preferenze.filter((p) => p.teacher_id === docente.id)}
            aperto={docenteAperto === docente.id}
            onToggle={() =>
              setDocenteAperto(docenteAperto === docente.id ? null : docente.id)
            }
            onAggiungi={(form) => aggiungiPreferenza(docente.id, form)}
            onCambiaStato={cambiaStato}
            onElimina={eliminaPreferenza}
          />
        ))}
        {docenti.length === 0 && !loading && (
          <p className="text-sm text-gray-400">
            Nessun docente inserito. Aggiungili prima dalla pagina Docenti.
          </p>
        )}
      </div>

      {loading && <p className="text-sm text-gray-400">Caricamento...</p>}
    </div>
  );
}

function DocentePreferenze({
  docente,
  classi,
  giorni,
  preferenze,
  aperto,
  onToggle,
  onAggiungi,
  onCambiaStato,
  onElimina,
}: {
  docente: Docente;
  classi: Classe[];
  giorni: { valore: number; label: string }[];
  preferenze: Preferenza[];
  aperto: boolean;
  onToggle: () => void;
  onAggiungi: (form: {
    tipo: TipoPreferenza;
    giorno: number;
    classId: number;
    nota: string;
  }) => void;
  onCambiaStato: (id: number, stato: StatoPreferenza) => void;
  onElimina: (id: number) => void;
}) {
  const [form, setForm] = useState({
    tipo: "giorno_libero" as TipoPreferenza,
    giorno: giorni[0]?.valore ?? 1,
    classId: 0,
    nota: "",
  });

  function descriviPreferenza(p: Preferenza) {
    if (p.tipo === "giorno_libero" && p.dettaglio) {
      const g = giorni.find((x) => x.valore === (p.dettaglio as { giorno: number }).giorno);
      return `${TIPO_LABEL[p.tipo]}: ${g?.label ?? "?"}`;
    }
    if (p.tipo === "no_prima_ora" || p.tipo === "no_ultima_ora") {
      if (p.dettaglio) {
        const g = giorni.find((x) => x.valore === (p.dettaglio as { giorno: number }).giorno);
        return `${TIPO_LABEL[p.tipo]}: ${g?.label ?? "?"}`;
      }
      return `${TIPO_LABEL[p.tipo]}: sempre`;
    }
    if (p.tipo === "continuita_classe" && p.dettaglio) {
      const classId = (p.dettaglio as { class_id: number }).class_id;
      const c = classi.find((x) => x.id === classId);
      return `${TIPO_LABEL[p.tipo]}: ${c?.nome ?? "?"}`;
    }
    return TIPO_LABEL[p.tipo];
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-medium text-gray-900">
          {docente.cognome} {docente.nome}
        </span>
        <span className="text-sm text-gray-500">
          {preferenze.length} preferenz{preferenze.length === 1 ? "a" : "e"}
        </span>
      </button>

      {aperto && (
        <div className="space-y-3 border-t border-gray-100 px-4 py-3">
          <ul className="space-y-2 text-sm text-gray-700">
            {preferenze.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <div>
                  <span>{descriviPreferenza(p)}</span>
                  {p.nota && (
                    <span className="ml-2 text-gray-400">— {p.nota}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className={`rounded px-2 py-0.5 text-xs ${STATO_COLORE[p.stato]}`}
                    value={p.stato}
                    onChange={(e) =>
                      onCambiaStato(p.id, e.target.value as StatoPreferenza)
                    }
                  >
                    {(Object.keys(STATO_LABEL) as StatoPreferenza[]).map((s) => (
                      <option key={s} value={s}>
                        {STATO_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => onElimina(p.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    rimuovi
                  </button>
                </div>
              </li>
            ))}
            {preferenze.length === 0 && (
              <li className="text-gray-400">Nessuna preferenza registrata</li>
            )}
          </ul>

          <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
            <div>
              <label className="block text-xs text-gray-500">Tipo</label>
              <select
                className="rounded border border-gray-300 px-2 py-1 text-sm"
                value={form.tipo}
                onChange={(e) => {
                  const nuovoTipo = e.target.value as TipoPreferenza;
                  setForm((p) => ({
                    ...p,
                    tipo: nuovoTipo,
                    giorno:
                      nuovoTipo === "no_prima_ora" || nuovoTipo === "no_ultima_ora"
                        ? 0
                        : p.giorno,
                  }));
                }}
              >
                {(Object.keys(TIPO_LABEL) as TipoPreferenza[]).map((t) => (
                  <option key={t} value={t}>
                    {TIPO_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>

            {form.tipo === "giorno_libero" && (
              <div>
                <label className="block text-xs text-gray-500">Giorno</label>
                <select
                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                  value={form.giorno}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, giorno: Number(e.target.value) }))
                  }
                >
                  {giorni.map((g) => (
                    <option key={g.valore} value={g.valore}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {(form.tipo === "no_prima_ora" || form.tipo === "no_ultima_ora") && (
              <div>
                <label className="block text-xs text-gray-500">Giorno</label>
                <select
                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                  value={form.giorno}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, giorno: Number(e.target.value) }))
                  }
                >
                  <option value={0}>Sempre</option>
                  {giorni.map((g) => (
                    <option key={g.valore} value={g.valore}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {form.tipo === "continuita_classe" && (
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
            )}

            <div className="flex-1 min-w-[10rem]">
              <label className="block text-xs text-gray-500">Nota (opzionale)</label>
              <input
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                value={form.nota}
                onChange={(e) => setForm((p) => ({ ...p, nota: e.target.value }))}
                placeholder="es. motivo, dettagli..."
              />
            </div>

            <button
              onClick={() => {
                onAggiungi(form);
                setForm((p) => ({ ...p, nota: "" }));
              }}
              className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white"
            >
              Aggiungi
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
