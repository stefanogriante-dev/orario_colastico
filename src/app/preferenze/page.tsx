"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  Docente,
  Preferenza,
  TipoPreferenza,
  StatoPreferenza,
} from "@/lib/types";

const TIPO_LABEL: Record<TipoPreferenza, string> = {
  giorno_libero: "Giorno libero",
  no_prima_ora: "Evita la prima ora",
  no_ultima_ora: "Evita l'ultima ora",
  no_ora_specifica: "Evita un'ora specifica",
  evita_buchi: "Evita ore buche",
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
  const [preferenze, setPreferenze] = useState<Preferenza[]>([]);
  const [giorniSettimana, setGiorniSettimana] = useState(6);
  const [oreMax, setOreMax] = useState(6);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);
  const [docenteAperto, setDocenteAperto] = useState<number | null>(null);

  async function caricaTutto() {
    setLoading(true);
    const [d, p, sc, ts] = await Promise.all([
      supabase.from("teachers").select("id, nome, cognome, email").order("cognome"),
      supabase
        .from("preferences")
        .select("id, teacher_id, tipo, dettaglio, nota, stato"),
      supabase.from("school_config").select("giorni_settimana").eq("id", 1).single(),
      supabase.from("time_slots").select("ora"),
    ]);
    const errori = [d.error, p.error].filter(Boolean);
    if (errori.length > 0) {
      setErrore(errori.map((e) => e!.message).join(" / "));
    } else {
      setDocenti((d.data as Docente[]) ?? []);
      setPreferenze((p.data as Preferenza[]) ?? []);
      if (sc.data) setGiorniSettimana((sc.data as { giorni_settimana: number }).giorni_settimana);
      const ore = ((ts.data as { ora: number }[]) ?? []).map((s) => s.ora);
      if (ore.length > 0) setOreMax(Math.max(...ore));
      setErrore(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    caricaTutto();
  }, []);

  async function aggiungiPreferenza(
    teacherId: number,
    form: {
      tipo: TipoPreferenza;
      giorniMultipli: number[];
      oraSpecifica: number;
      nota: string;
    }
  ) {
    let dettaglio: Record<string, unknown> | null = null;
    if (form.tipo === "giorno_libero") {
      dettaglio = { giorni: [...form.giorniMultipli].sort((a, b) => a - b) };
    }
    if (form.tipo === "no_prima_ora" || form.tipo === "no_ultima_ora") {
      // tutti i giorni selezionati (checkbox) = "Sempre": nessun dettaglio
      const tuttiSelezionati = giorni.every((g) => form.giorniMultipli.includes(g.valore));
      dettaglio = tuttiSelezionati ? null : { giorni: [...form.giorniMultipli].sort((a, b) => a - b) };
    }
    if (form.tipo === "no_ora_specifica") {
      // tutti i giorni selezionati (checkbox) = "Sempre": solo l'ora nel dettaglio
      const tuttiSelezionati = giorni.every((g) => form.giorniMultipli.includes(g.valore));
      dettaglio = tuttiSelezionati
        ? { ora: form.oraSpecifica }
        : { ora: form.oraSpecifica, giorni: [...form.giorniMultipli].sort((a, b) => a - b) };
    }

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
          ora o una qualsiasi altra ora specifica, evitare buchi, ore
          consecutive o separate (queste ultime si impostano nella pagina
          Docenti).
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
            giorni={giorni}
            oreMax={oreMax}
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
  giorni,
  oreMax,
  preferenze,
  aperto,
  onToggle,
  onAggiungi,
  onCambiaStato,
  onElimina,
}: {
  docente: Docente;
  giorni: { valore: number; label: string }[];
  oreMax: number;
  preferenze: Preferenza[];
  aperto: boolean;
  onToggle: () => void;
  onAggiungi: (form: {
    tipo: TipoPreferenza;
    giorniMultipli: number[];
    oraSpecifica: number;
    nota: string;
  }) => void;
  onCambiaStato: (id: number, stato: StatoPreferenza) => void;
  onElimina: (id: number) => void;
}) {
  const [form, setForm] = useState({
    tipo: "giorno_libero" as TipoPreferenza,
    giorniMultipli: giorni[0] ? [giorni[0].valore] : [],
    oraSpecifica: 1,
    nota: "",
  });

  function elencoGiorni(dettaglio: Preferenza["dettaglio"]): string | null {
    if (dettaglio && Array.isArray((dettaglio as { giorni?: number[] }).giorni)) {
      return (dettaglio as { giorni: number[] }).giorni
        .map((v) => giorni.find((x) => x.valore === v)?.label ?? "?")
        .join(", ");
    }
    if (dettaglio && (dettaglio as { giorno?: number }).giorno !== undefined) {
      // formato legacy: un solo giorno
      const g = giorni.find((x) => x.valore === (dettaglio as { giorno: number }).giorno);
      return g?.label ?? "?";
    }
    return null;
  }

  function descriviPreferenza(p: Preferenza) {
    if (p.tipo === "giorno_libero") {
      return `${TIPO_LABEL[p.tipo]}: ${elencoGiorni(p.dettaglio) ?? "?"}`;
    }
    if (p.tipo === "no_prima_ora" || p.tipo === "no_ultima_ora") {
      const elenco = elencoGiorni(p.dettaglio);
      return `${TIPO_LABEL[p.tipo]}: ${elenco ?? "sempre"}`;
    }
    if (p.tipo === "no_ora_specifica") {
      const ora = (p.dettaglio as { ora?: number } | null)?.ora;
      const elenco = elencoGiorni(p.dettaglio);
      return `${TIPO_LABEL[p.tipo]} (ora ${ora ?? "?"}): ${elenco ?? "sempre"}`;
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
                    giorniMultipli:
                      nuovoTipo === "no_prima_ora" ||
                      nuovoTipo === "no_ultima_ora" ||
                      nuovoTipo === "no_ora_specifica"
                        ? giorni.map((g) => g.valore)
                        : nuovoTipo === "giorno_libero"
                        ? giorni[0]
                          ? [giorni[0].valore]
                          : []
                        : p.giorniMultipli,
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

            {form.tipo === "no_ora_specifica" && (
              <div>
                <label className="block text-xs text-gray-500">Ora da evitare</label>
                <select
                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                  value={form.oraSpecifica}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, oraSpecifica: Number(e.target.value) }))
                  }
                >
                  {Array.from({ length: oreMax }, (_, i) => i + 1).map((ora) => (
                    <option key={ora} value={ora}>
                      {ora}ª ora
                    </option>
                  ))}
                </select>
              </div>
            )}

            {(form.tipo === "giorno_libero" ||
              form.tipo === "no_prima_ora" ||
              form.tipo === "no_ultima_ora" ||
              form.tipo === "no_ora_specifica") && (
              <div>
                <label className="block text-xs text-gray-500">
                  {form.tipo === "giorno_libero" ? "Giorni liberi" : "Giorni (tutti = sempre)"}
                </label>
                <div className="flex flex-wrap gap-2 rounded border border-gray-300 px-2 py-1.5">
                  {giorni.map((g) => (
                    <label
                      key={g.valore}
                      className="flex items-center gap-1 text-sm text-gray-700"
                    >
                      <input
                        type="checkbox"
                        checked={form.giorniMultipli.includes(g.valore)}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            giorniMultipli: e.target.checked
                              ? [...p.giorniMultipli, g.valore]
                              : p.giorniMultipli.filter((v) => v !== g.valore),
                          }))
                        }
                      />
                      {g.label}
                    </label>
                  ))}
                </div>
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
              disabled={
                (form.tipo === "giorno_libero" ||
                  form.tipo === "no_prima_ora" ||
                  form.tipo === "no_ultima_ora" ||
                  form.tipo === "no_ora_specifica") &&
                form.giorniMultipli.length === 0
              }
              className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Aggiungi
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
