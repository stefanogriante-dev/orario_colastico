import * as XLSX from "xlsx";
import type { Classe, Docente, Materia, TimeSlot } from "./types";

// ============================================================
// Esportazione dell'orario in Excel (.xlsx), lato browser.
// Due viste: una cartella con un foglio per classe (righe=ore,
// colonne=giorni) e una con un foglio per giorno (righe=ore,
// colonne=classi). I nomi dei fogli Excel non possono superare 31
// caratteri e non possono contenere alcuni caratteri speciali:
// vengono quindi "puliti" e resi univoci.
// ============================================================

export interface EntrataExport {
  class_id: number;
  teacher_id: number;
  subject_id: number;
  time_slot_id: number;
}

interface ContestoExport {
  giorni: { valore: number; label: string }[];
  oreMax: number;
  timeSlots: TimeSlot[];
  entrate: EntrataExport[];
  docenteById: Map<number, Docente>;
  materiaById: Map<number, Materia>;
}

function testoCella(
  entrata: EntrataExport | undefined,
  docenteById: Map<number, Docente>,
  materiaById: Map<number, Materia>
): string {
  if (!entrata) return "";
  const materia = materiaById.get(entrata.subject_id)?.nome ?? "";
  const docente = docenteById.get(entrata.teacher_id);
  const nomeDocente = docente ? `${docente.cognome} ${docente.nome}` : "";
  if (!materia && !nomeDocente) return "";
  return `${materia} - ${nomeDocente}`;
}

function nomeFoglioSicuro(nome: string, usati: Set<string>): string {
  // Excel: max 31 caratteri, niente : \ / ? * [ ]
  let pulito = nome.replace(/[:\\/?*[\]]/g, "").slice(0, 31) || "Foglio";
  let finale = pulito;
  let contatore = 2;
  while (usati.has(finale)) {
    const suffisso = `_${contatore}`;
    finale = pulito.slice(0, 31 - suffisso.length) + suffisso;
    contatore++;
  }
  usati.add(finale);
  return finale;
}

function scaricaWorkbook(wb: XLSX.WorkBook, nomeFile: string) {
  XLSX.writeFile(wb, nomeFile);
}

// Un foglio per classe: righe = ore, colonne = giorni della settimana.
export function esportaOrarioPerClassi(classi: Classe[], ctx: ContestoExport) {
  const { giorni, oreMax, timeSlots, entrate, docenteById, materiaById } = ctx;
  const wb = XLSX.utils.book_new();
  const nomiUsati = new Set<string>();

  for (const classe of classi) {
    const entrateClasse = entrate.filter((e) => e.class_id === classe.id);
    const intestazione = ["Ora", ...giorni.map((g) => g.label)];
    const righe: string[][] = [intestazione];

    for (let ora = 1; ora <= oreMax; ora++) {
      const riga = [String(ora)];
      for (const g of giorni) {
        const slot = timeSlots.find((s) => s.giorno === g.valore && s.ora === ora);
        const entrata = slot ? entrateClasse.find((e) => e.time_slot_id === slot.id) : undefined;
        riga.push(testoCella(entrata, docenteById, materiaById));
      }
      righe.push(riga);
    }

    const ws = XLSX.utils.aoa_to_sheet(righe);
    ws["!cols"] = [{ wch: 5 }, ...giorni.map(() => ({ wch: 26 }))];
    XLSX.utils.book_append_sheet(wb, ws, nomeFoglioSicuro(classe.nome, nomiUsati));
  }

  scaricaWorkbook(wb, "orario_per_classi.xlsx");
}

// Un foglio per giorno: righe = ore, colonne = classi.
export function esportaOrarioPerGiorni(classi: Classe[], ctx: ContestoExport) {
  const { giorni, oreMax, timeSlots, entrate, docenteById, materiaById } = ctx;
  const wb = XLSX.utils.book_new();
  const nomiUsati = new Set<string>();

  for (const g of giorni) {
    const intestazione = ["Ora", ...classi.map((c) => c.nome)];
    const righe: string[][] = [intestazione];

    for (let ora = 1; ora <= oreMax; ora++) {
      const riga = [String(ora)];
      const slot = timeSlots.find((s) => s.giorno === g.valore && s.ora === ora);
      for (const classe of classi) {
        const entrata = slot
          ? entrate.find((e) => e.time_slot_id === slot.id && e.class_id === classe.id)
          : undefined;
        riga.push(testoCella(entrata, docenteById, materiaById));
      }
      righe.push(riga);
    }

    const ws = XLSX.utils.aoa_to_sheet(righe);
    ws["!cols"] = [{ wch: 5 }, ...classi.map(() => ({ wch: 26 }))];
    XLSX.utils.book_append_sheet(wb, ws, nomeFoglioSicuro(g.label, nomiUsati));
  }

  scaricaWorkbook(wb, "orario_per_giorni.xlsx");
}
