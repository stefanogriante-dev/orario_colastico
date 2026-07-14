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

  return new Promise<GeneraOrarioOutput>((resolve) => {
    const workers: Worker[] = [];
    const risultatiParziali: GeneraOrarioOutput[] = [];
    let concluso = false;
    let workerTerminati = 0;

    // Non appena un worker trova una combinazione che riempie tutte le
    // celle, fermiamo SUBITO l'intero processo di ricerca: terminiamo tutti
    // gli altri worker invece di lasciarli girare fino al loro tempo
    // massimo, e restituiamo direttamente questo risultato. Non ha senso
    // continuare a cercare una combinazione con meno preferenze violate una
    // volta che l'orario e' gia' completo.
    function fermaTuttiERisolvi(risultato: GeneraOrarioOutput) {
      if (concluso) return;
      concluso = true;
      for (const w of workers) w.terminate();
      resolve(risultato);
    }

    // Un worker ha finito senza trovare una combinazione completa (tempo
    // scaduto) oppure e' fallito con un errore: se e' l'ultimo rimasto,
    // concludiamo con la migliore combinazione PARZIALE tra quelle raccolte
    // (o un risultato vuoto se nessun worker ha prodotto nulla). Un singolo
    // worker fallito non deve far fallire l'intera ricerca finche' altri
    // worker sono ancora al lavoro.
    function workerConclusoSenzaSuccesso() {
      workerTerminati++;
      if (workerTerminati === numWorker && !concluso) {
        concluso = true;
        resolve(
          risultatiParziali.length > 0
            ? scegliMigliore(risultatiParziali)
            : {
                riuscito: false,
                entries: [],
                preferenzeViolate: 0,
                preferenzeValutabili: input.preferenze.length,
                tentativi: 0,
                docentiViolati: new Set(),
                dettagliViolazioni: [],
                oreAssegnate: 0,
                oreTotali: 0,
              }
        );
      }
    }

    for (let indice = 0; indice < numWorker; indice++) {
      const worker = new Worker(new URL("./scheduler.worker.ts", import.meta.url), { type: "module" });
      workers.push(worker);

      worker.onmessage = (e: MessageEvent<MessaggioWorker>) => {
        if (concluso) return;
        const messaggio = e.data;
        if (messaggio.tipo === "progresso") {
          progressoPerWorker[indice] = messaggio.progresso;
          notificaProgresso();
        } else if (messaggio.tipo === "risultato") {
          worker.terminate();
          if (messaggio.risultato.riuscito) {
            fermaTuttiERisolvi(messaggio.risultato);
            return;
          }
          risultatiParziali.push(messaggio.risultato);
          workerConclusoSenzaSuccesso();
        }
      };

      worker.onerror = () => {
        if (concluso) return;
        worker.terminate();
        workerConclusoSenzaSuccesso();
      };

      const avvio: MessaggioAvvio = { tipo: "avvia", input };
      worker.postMessage(avvio);
    }
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
