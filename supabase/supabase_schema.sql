-- ============================================================
-- Schema Supabase — Gestione Orario Scolastico
-- Progetto: orario_scolastico
-- Utente unico: vicepreside (Federica De Pascalis), via Supabase Auth
--
-- Come usarlo: incollare in Supabase Dashboard > SQL Editor > New query
-- e lanciare (su un progetto vuoto). Va eseguito tutto insieme, in ordine.
-- ============================================================

-- ---------- ENUM ----------

create type modalita_ore as enum ('coppie', 'separate', 'indifferente');

create type tipo_preferenza as enum (
  'giorno_libero',
  'no_prima_ora',
  'no_ultima_ora',
  'evita_buchi',
  'altro'
);

create type stato_preferenza as enum ('non_valutata', 'soddisfatta', 'non_soddisfatta');

create type esito_generazione as enum ('successo', 'fallito_timeout', 'fallito_vincoli', 'interrotto');


-- ---------- CONFIGURAZIONE SCUOLA ----------

-- Riga singola di configurazione generale (giorni di lezione nella settimana)
create table school_config (
  id smallint primary key default 1 check (id = 1),
  giorni_settimana smallint not null default 6, -- es. lun-sab = 6
  updated_at timestamptz not null default now()
);

insert into school_config (id, giorni_settimana) values (1, 6);

-- Griglia oraria: ogni riga è uno slot valido della settimana.
-- Permette di avere un numero di ore diverso da un giorno all'altro.
create table time_slots (
  id bigint generated always as identity primary key,
  giorno smallint not null check (giorno between 1 and 7), -- 1 = lunedì ... 7 = domenica
  ora smallint not null check (ora >= 1),
  ora_inizio time,
  ora_fine time,
  unique (giorno, ora)
);


-- ---------- ANAGRAFICHE ----------

create table subjects (
  id bigint generated always as identity primary key,
  nome text not null unique
);

-- Classi generate a partire da anno + sezione (es. 3 prime -> 1A, 1B, 1C)
create table classes (
  id bigint generated always as identity primary key,
  anno smallint not null check (anno between 1 and 5),
  sezione text not null,
  nome text generated always as (anno::text || sezione) stored,
  unique (anno, sezione)
);

create table teachers (
  id bigint generated always as identity primary key,
  nome text not null,
  cognome text not null,
  email text,
  created_at timestamptz not null default now()
);


-- ---------- ASSEGNAZIONE DOCENTE -> CLASSE -> MATERIA ----------

-- Un docente può comparire più volte (una riga per ogni classe/materia che insegna)
create table teacher_classes (
  id bigint generated always as identity primary key,
  teacher_id bigint not null references teachers(id) on delete cascade,
  class_id bigint not null references classes(id) on delete cascade,
  subject_id bigint not null references subjects(id) on delete restrict,
  ore_settimanali smallint not null check (ore_settimanali > 0),
  modalita modalita_ore not null default 'indifferente',
  unique (teacher_id, class_id, subject_id)
);


-- ---------- PREFERENZE DEL DOCENTE (vincoli "soft") ----------

create table preferences (
  id bigint generated always as identity primary key,
  teacher_id bigint not null references teachers(id) on delete cascade,
  tipo tipo_preferenza not null,
  dettaglio jsonb,  -- es. {"giorno": 3} per giorno_libero, {"nota": "..."} per altro
  nota text,
  stato stato_preferenza not null default 'non_valutata',
  created_at timestamptz not null default now()
);


-- ---------- ORARIO ----------

create table schedule_entries (
  id bigint generated always as identity primary key,
  class_id bigint not null references classes(id) on delete cascade,
  teacher_id bigint not null references teachers(id) on delete cascade,
  subject_id bigint not null references subjects(id) on delete restrict,
  time_slot_id bigint not null references time_slots(id) on delete restrict,
  manual boolean not null default false, -- true = inserita a mano da Federica, il motore automatico non la tocca
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- vincolo rigido: una classe non può avere due lezioni nello stesso slot
  unique (class_id, time_slot_id),
  -- vincolo rigido: un docente non può essere in due classi diverse nello stesso slot
  unique (teacher_id, time_slot_id)
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_schedule_entries_updated_at
before update on schedule_entries
for each row execute function set_updated_at();


-- ---------- LOG GENERAZIONI AUTOMATICHE ----------

create table generation_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  esito esito_generazione,
  slot_totali int,
  slot_riempiti int,
  preferenze_violate int,
  note text
);


-- ============================================================
-- ROW LEVEL SECURITY
-- Utente unico autenticato via Supabase Auth: politica semplice,
-- chiunque sia autenticato ha accesso completo a tutte le tabelle.
-- ============================================================

alter table school_config    enable row level security;
alter table time_slots       enable row level security;
alter table subjects         enable row level security;
alter table classes          enable row level security;
alter table teachers         enable row level security;
alter table teacher_classes  enable row level security;
alter table preferences      enable row level security;
alter table schedule_entries enable row level security;
alter table generation_runs  enable row level security;

create policy "utente autenticato" on school_config    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "utente autenticato" on time_slots       for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "utente autenticato" on subjects         for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "utente autenticato" on classes          for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "utente autenticato" on teachers         for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "utente autenticato" on teacher_classes  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "utente autenticato" on preferences      for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "utente autenticato" on schedule_entries for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "utente autenticato" on generation_runs  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');


-- ---------- INDICI UTILI ----------

create index idx_teacher_classes_teacher on teacher_classes(teacher_id);
create index idx_teacher_classes_class   on teacher_classes(class_id);
create index idx_preferences_teacher     on preferences(teacher_id);
create index idx_schedule_entries_class  on schedule_entries(class_id);
create index idx_schedule_entries_teacher on schedule_entries(teacher_id);
create index idx_schedule_entries_manual on schedule_entries(manual);
