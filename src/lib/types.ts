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
