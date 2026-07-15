// Client per la funzione serverless Python in /api/genera-orario.py, che
// genera l'orario con Google OR-Tools CP-SAT invece dell'euristica
// random-restart in scheduler.ts. A differenza dell'euristica, CP-SAT
// trova sempre la combinazione OTTIMA (o dimostra che non ne esiste una
// migliore) entro il tempo a disposizione.
//
// Se la funzione non risponde (backend non distribuito, errore di rete,
// timeout) il chiamante (vedi orario/page.tsx) ripiega automaticamente
// sulla ricerca euristica client-side in schedulerParallelo.ts: questo
// file si limita a lanciare un errore in quel caso, senza gestire da solo
// il fallback.
import type {
  AssegnazioneInput,
  EntrataFissa,
  EntrataGenerata,
  VincoliOpzionali,
} from "./scheduler";
import type { Preferenza, TimeSlot } from "./types";

export interface GeneraOrarioCpSatInput {
  timeSlots: TimeSlot[];
  assegnazioni: AssegnazioneInput[];
  entrateManuali: EntrataFissa[];
  preferenze: Preferenza[];
  materieMotoria?: number[];
  materieEscluseConMotoria?: number[];
  vincoliOpzionali?: VincoliOpzionali;
}

export interface RisultatoCpSat {
  riuscito: boolean;
  entries: EntrataGenerata[];
  preferenzeViolate: number;
  preferenzeValutabili: number;
  oreAssegnate: number;
  oreTotali: number;
  stato?: string;
}

export async function generaOrarioCpSat(
  input: GeneraOrarioCpSatInput,
  maxSecondiSolver: number
): Promise<RisultatoCpSat> {
  const risposta = await fetch("/api/genera-orario", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timeSlots: input.timeSlots,
      assegnazioni: input.assegnazioni,
      entrateManuali: input.entrateManuali,
      preferenze: input.preferenze,
      materieMotoria: input.materieMotoria ?? [],
      materieEscluseConMotoria: input.materieEscluseConMotoria ?? [],
      vincoliOpzionali: input.vincoliOpzionali,
      maxSecondiSolver,
    }),
  });

  if (!risposta.ok) {
    let messaggio = `Il motore CP-SAT ha risposto con errore ${risposta.status}`;
    try {
      const corpo = await risposta.json();
      if (corpo?.errore) messaggio = corpo.errore;
    } catch {
      // corpo non json: teniamo il messaggio generico sopra
    }
    throw new Error(messaggio);
  }

  const dati = await risposta.json();
  if (dati?.errore) throw new Error(dati.errore);
  return dati as RisultatoCpSat;
}
