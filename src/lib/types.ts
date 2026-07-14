export type Modalita = "coppie" | "separate" | "indifferente";

export interface Classe {
  id: number;
  anno: number;
  sezione: string;
  nome: string;
}

export interface Materia {
  id: number;
  nome: string;
}

export interface Docente {
  id: number;
  nome: string;
  cognome: string;
  email: string | null;
  colore: string | null;
}

export interface Assegnazione {
  id: number;
  teacher_id: number;
  ore_settimanali: number;
  modalita: Modalita;
  classes: { id: number; nome: string } | null;
  subjects: { id: number; nome: string } | null;
}

export type TipoPreferenza =
  | "giorno_libero"
  | "no_prima_ora"
  | "no_ultima_ora"
  | "no_ora_specifica"
  | "evita_buchi"
  | "altro";

export type StatoPreferenza = "non_valutata" | "soddisfatta" | "non_soddisfatta";

export interface Preferenza {
  id: number;
  teacher_id: number;
  tipo: TipoPreferenza;
  dettaglio: Record<string, unknown> | null;
  nota: string | null;
  stato: StatoPreferenza;
}

export interface TimeSlot {
  id: number;
  giorno: number;
  ora: number;
}

export interface ScheduleEntry {
  id: number;
  class_id: number;
  teacher_id: number;
  subject_id: number;
  time_slot_id: number;
  manual: boolean;
  permette_doppia_classe: boolean;
}

// Configurazione generale della scuola: giorni di lezione, quali vincoli
// rigidi opzionali sono attivi per la generazione automatica e per quanti
// minuti la ricerca prova a completare l'orario prima di fermarsi.
export interface ConfigurazioneScuola {
  giorni_settimana: number;
  vincolo_max_ore_classe_giorno: boolean;
  vincolo_adiacenza_materia: boolean;
  vincolo_max_ore_giorno_docente: boolean;
  limite_ore_giorno_normale: number;
  limite_ore_giorno_eccezione: number;
  vincolo_motoria_arte_tecnologia: boolean;
  durata_generazione_minuti: number;
}
