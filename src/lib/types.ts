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
  | "evita_buchi"
  | "continuita_classe"
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
