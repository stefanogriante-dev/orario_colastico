// Web Worker che esegue un'istanza indipendente della ricerca automatica
// dell'orario (generaOrarioProgressivo) su un thread separato dalla pagina.
//
// Perche' serve: generaOrarioProgressivo di per se' non e' "parallelo", e'
// solo suddiviso in blocchi di tempo (chunk) per non bloccare l'interfaccia,
// ma esegue comunque un'unica sequenza di tentativi random-restart sullo
// stesso thread. Eseguendo PIU' istanze di questa ricerca contemporaneamente,
// una per Web Worker (vedi schedulerParallelo.ts), si moltiplica il numero di
// combinazioni diverse esplorate entro lo stesso tempo reale a disposizione,
// sfruttando i core della CPU invece di uno solo. Ogni worker ha la propria
// sequenza di numeri casuali (indipendente dagli altri, sono thread/processi
// separati), quindi esplora naturalmente percorsi diversi pur partendo dagli
// stessi dati in ingresso.
//
// Nota tipi: il tsconfig del progetto non include la lib "webworker" (usa
// "dom", condivisa col resto dell'app), quindi self/postMessage/onmessage
// sono tipizzati qui secondo le API di Window. Usiamo solo il sottoinsieme
// di API compatibile sia con Window sia con l'ambito globale di un worker
// (postMessage di un solo argomento, onmessage con MessageEvent), quindi il
// codice e' corretto a runtime in un vero worker anche se i tipi "raccontano"
// un contesto Window.
import {
  generaOrarioProgressivo,
  type GeneraOrarioInput,
  type GeneraOrarioOutput,
  type ProgressoGenerazione,
} from "./scheduler";

export interface MessaggioAvvio {
  tipo: "avvia";
  input: Omit<GeneraOrarioInput, "scadenza"> & { scadenzaTotale: number };
}

export type MessaggioWorker =
  | { tipo: "progresso"; progresso: ProgressoGenerazione }
  | { tipo: "risultato"; risultato: GeneraOrarioOutput };

self.onmessage = async (e: MessageEvent<MessaggioAvvio>) => {
  if (e.data.tipo !== "avvia") return;

  const risultato = await generaOrarioProgressivo(e.data.input, (progresso) => {
    const messaggio: MessaggioWorker = { tipo: "progresso", progresso };
    postMessage(messaggio);
  });

  const messaggio: MessaggioWorker = { tipo: "risultato", risultato };
  postMessage(messaggio);
};
