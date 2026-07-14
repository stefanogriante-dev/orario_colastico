import ExcelJS from "exceljs";
import type { Classe, Docente, Materia, TimeSlot } from "./types";

// ============================================================
// Esportazione dell'orario in Excel (.xlsx), lato browser, con lo
// stesso "look" della pagina: celle con lo sfondo colorato del
// docente (testo sempre nero) e bordo pieno/tratteggiato per le ore
// manuali/automatiche. Tutte le tabelle (una per classe o una per
// giorno) vengono impilate in un UNICO foglio, cosi' come sono
// impilate una sotto l'altra nella pagina.
//
// Nota: la libreria "xlsx" (SheetJS Community Edition) non supporta
// la scrittura di stili/colori nei file generati (solo la versione
// Pro a pagamento lo consente): per questo l'export usa "exceljs",
// che permette di colorare le celle.
// ============================================================

export interface EntrataExport {
  class_id: number;
  teacher_id: number;
  subject_id: number;
  time_slot_id: number;
  manual: boolean;
}

interface ContestoExport {
  giorni: { valore: number; label: string }[];
  oreMax: number;
  timeSlots: TimeSlot[];
  entrate: EntrataExport[];
  docenteById: Map<number, Docente>;
  materiaById: Map<number, Materia>;
}

// Colore di sfondo di default per le celle piene senza un colore
// docente impostato: lo stesso grigio chiaro usato nella pagina.
const COLORE_VUOTO = "f3f4f6";

const BORDO_GRIGIO: ExcelJS.Border = { style: "thin", color: { argb: "FFD1D5DB" } };

function hexToArgb(hex: string): string {
  return `FF${hex.replace("#", "").toUpperCase()}`;
}

// Testo della cella su due righe (materia + docente), come nella
// pagina: la seconda riga viene mostrata andando a capo (wrapText).
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
  return `${materia}\n${nomeDocente}`;
}

// Colore di sfondo della cella: nessuno (bianco) se la cella e' vuota,
// altrimenti il colore del docente (o il grigio di default), esattamente
// come nella griglia mostrata a schermo.
function coloreCella(
  entrata: EntrataExport | undefined,
  docenteById: Map<number, Docente>
): string | undefined {
  if (!entrata) return undefined;
  const docente = docenteById.get(entrata.teacher_id);
  return docente?.colore ?? `#${COLORE_VUOTO}`;
}

interface DatiCella {
  testo: string;
  colore?: string;
  manuale?: boolean;
}

// Scrive una singola tabella (titolo + intestazione colonne + righe ore)
// nel foglio passato, a partire dalla riga corrente, e lascia un paio di
// righe vuote di separazione prima della tabella successiva.
function scriviTabella(
  ws: ExcelJS.Worksheet,
  titolo: string,
  intestazioneColonne: string[],
  oreMax: number,
  celle: (ora: number, indiceColonna: number) => DatiCella
) {
  const numColonne = intestazioneColonne.length;

  const rigaTitolo = ws.addRow([titolo]);
  ws.mergeCells(rigaTitolo.number, 1, rigaTitolo.number, numColonne);
  rigaTitolo.getCell(1).font = { bold: true, size: 13, color: { argb: "FF111827" } };
  rigaTitolo.height = 22;

  const rigaHeader = ws.addRow(intestazioneColonne);
  rigaHeader.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: "FF6B7280" } };
    cell.border = { bottom: BORDO_GRIGIO };
  });

  for (let ora = 1; ora <= oreMax; ora++) {
    const riga = ws.addRow([ora]);
    riga.getCell(1).font = { color: { argb: "FF9CA3AF" } };
    riga.getCell(1).alignment = { vertical: "top" };
    riga.height = 32;

    for (let indiceColonna = 0; indiceColonna < numColonne - 1; indiceColonna++) {
      const dati = celle(ora, indiceColonna);
      const cell = riga.getCell(indiceColonna + 2);
      cell.value = dati.testo;
      cell.alignment = { vertical: "top", wrapText: true };
      cell.font = { color: { argb: "FF000000" } };
      if (dati.colore) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: hexToArgb(dati.colore) } };
        const bordo: ExcelJS.Border = {
          style: dati.manuale ? "thin" : "dashed",
          color: { argb: "FF9CA3AF" },
        };
        cell.border = { top: bordo, left: bordo, right: bordo, bottom: bordo };
      }
    }
  }

  ws.addRow([]);
  ws.addRow([]);
}

async function scaricaWorkbook(wb: ExcelJS.Workbook, nomeFile: string) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeFile;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Un unico foglio con tutte le classi impilate: righe = ore, colonne =
// giorni della settimana (stessa struttura della pagina Orario).
export async function esportaOrarioPerClassi(classi: Classe[], ctx: ContestoExport) {
  const { giorni, oreMax, timeSlots, entrate, docenteById, materiaById } = ctx;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Orario");
  ws.columns = [{ width: 6 }, ...giorni.map(() => ({ width: 26 }))];

  for (const classe of classi) {
    const entrateClasse = entrate.filter((e) => e.class_id === classe.id);
    scriviTabella(ws, classe.nome, ["Ora", ...giorni.map((g) => g.label)], oreMax, (ora, indiceColonna) => {
      const g = giorni[indiceColonna];
      const slot = timeSlots.find((s) => s.giorno === g.valore && s.ora === ora);
      const entrata = slot ? entrateClasse.find((e) => e.time_slot_id === slot.id) : undefined;
      return {
        testo: testoCella(entrata, docenteById, materiaById),
        colore: coloreCella(entrata, docenteById),
        manuale: entrata?.manual,
      };
    });
  }

  await scaricaWorkbook(wb, "orario_per_classi.xlsx");
}

// Un unico foglio con tutti i giorni impilati: righe = ore, colonne =
// classi (stessa struttura della pagina Orario per giorni).
export async function esportaOrarioPerGiorni(classi: Classe[], ctx: ContestoExport) {
  const { giorni, oreMax, timeSlots, entrate, docenteById, materiaById } = ctx;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Orario per giorni");
  ws.columns = [{ width: 6 }, ...classi.map(() => ({ width: 22 }))];

  for (const g of giorni) {
    scriviTabella(ws, g.label, ["Ora", ...classi.map((c) => c.nome)], oreMax, (ora, indiceColonna) => {
      const classe = classi[indiceColonna];
      const slot = timeSlots.find((s) => s.giorno === g.valore && s.ora === ora);
      const entrata = slot
        ? entrate.find((e) => e.time_slot_id === slot.id && e.class_id === classe.id)
        : undefined;
      return {
        testo: testoCella(entrata, docenteById, materiaById),
        colore: coloreCella(entrata, docenteById),
        manuale: entrata?.manual,
      };
    });
  }

  await scaricaWorkbook(wb, "orario_per_giorni.xlsx");
}
