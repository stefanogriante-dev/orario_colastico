// Esegue piu' istanze indipendenti della ricerca automatica dell'orario in
// parallelo, una per Web Worker, e restituisce la migliore combinazione
// trovata tra tutte. Vedi il commento in scheduler.worker.ts per il perche'.
//
// Se i Web Worker non sono disponibili (ambiente senza browser, o browser
// molto datato), ripiega sulla ricerca seriale in-thread esistente: nessun
// guadagno di parallelismo, ma la generazione funziona comunque.
import {
  generaOrarioProgressivo,
  type GeneraOrarioInput,
  type GeneraOrarioOutput,
  type ProgressoGenerazione,
} from "./scheduler";
import type { MessaggioAvvio, MessaggioWorker } from "./scheduler.worker";

export interface ProgressoParallelo extends ProgressoGenerazione {
  // Quanti worker (ricerche indipendenti) sono effettivamente in esecuzione
  // in questo momento: utile per mostrare all'utente che la ricerca sta
  // sfruttando piu' processi in parallelo, non solo uno.
  workerAttivi: number;
}

// Numero di ricerche indipendenti da eseguire in parallelo: un core lasciato
// libero per non bloccare completamente il dispositivo (interfaccia, altre
// schede, ecc.), con un tetto massimo ragionevole anche su macchine con
// moltissimi core, e un minimo di 2 quando il numero di core non e'
// rilevabile dal browser.
function numeroWorkerConsigliato(): number {
  const core = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined;
  if (!core || core <= 1) return 2;
  return Math.max(1, Math.min(core - 1, 6));
}

export async function generaOrarioParallelo(
  input: Omit<GeneraOrarioInput, "scadenza"> & { scadenzaTotale: number },
  onProgress?: (p: ProgressoParallelo) => void
): Promise<GeneraOrarioOutput> {
  if (typeof Worker === "undefined") {
    // Ambiente senza Web Worker (es. server, o browser molto datato):
    // ricerca seriale in-thread, come prima di questa funzionalita'.
    return generaOrarioProgressivo(input, (p) => onProgress?.({ ...p, workerAttivi: 1 }));
  }

  const numWorker = numeroWorkerConsigliato();
  const progressoPerWorker: ProgressoGenerazione[] = Array.from({ length: numWorker }, () => ({
    tentativiTotali: 0,
    tempoTrascorsoMs: 0,
    migliorViolazioni: null,
  }));

  function notificaProgresso() {
    if (!onProgress) return;
    const tentativiTotali = progressoPerWorker.reduce((somma, p) => somma + p.tentativiTotali, 0);
    const tempoTrascorsoMs = Math.max(0, ...progressoPerWorker.map((p) => p.tempoTrascorsoMs));
    const violazioniValide = progressoPerWorker
      .map((p) => p.migliorViolazioni)
      .filter((v): v is number => v !== null);
    const migliorViolazioni = violazioniValide.length > 0 ? Math.min(...violazioniValide) : null;
    onProgress({ tentativiTotali, tempoTrascorsoMs, migliorViolazioni, workerAttivi: numWorker });
  }

  const risultati = await Promise.all(
    progressoPerWorker.map((_, indice) =>
      eseguiRicercaSuWorker(input, (progresso) => {
        progressoPerWorker[indice] = progresso;
        notificaProgresso();
      })
    )
  );

  return scegliMigliore(risultati);
}

function eseguiRicercaSuWorker(
  input: Omit<GeneraOrarioInput, "scadenza"> & { scadenzaTotale: number },
  onProgress: (p: ProgressoGenerazione) => void
): Promise<GeneraOrarioOutput> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./scheduler.worker.ts", import.meta.url), { type: "module" });

    worker.onmessage = (e: MessageEvent<MessaggioWorker>) => {
      const messaggio = e.data;
      if (messaggio.tipo === "progresso") {
        onProgress(messaggio.progresso);
      } else if (messaggio.tipo === "risultato") {
        worker.terminate();
        resolve(messaggio.risultato);
      }
    };

    worker.onerror = (errore) => {
      worker.terminate();
      reject(errore);
    };

    const avvio: MessaggioAvvio = { tipo: "avvia", input };
    worker.postMessage(avvio);
  });
}

// Tra tutti i risultati ottenuti dai worker paralleli, sceglie il migliore:
// prima le combinazioni COMPLETE (riuscito=true), tra queste quella con meno
// preferenze violate; se nessun worker e' riuscito a completare l'orario
// entro il tempo disponibile, sceglie la migliore combinazione PARZIALE (piu'
// ore assegnate, a parita' di ore quella con meno preferenze violate).
function scegliMigliore(risultati: GeneraOrarioOutput[]): GeneraOrarioOutput {
  const completi = risultati.filter((r) => r.riuscito);
  if (completi.length > 0) {
    return completi.reduce((migliore, r) => (r.preferenzeViolate < migliore.preferenzeViolate ? r : migliore));
  }
  return risultati.reduce((migliore, r) => {
    if (r.oreAssegnate > migliore.oreAssegnate) return r;
    if (r.oreAssegnate === migliore.oreAssegnate && r.preferenzeViolate < migliore.preferenzeViolate) return r;
    return migliore;
  });
}
