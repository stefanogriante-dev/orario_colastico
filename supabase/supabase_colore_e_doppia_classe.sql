-- ============================================================
-- Aggiornamento: colore docente + eccezione "doppia classe" manuale
-- Da eseguire nell'SQL Editor di Supabase sul progetto già esistente
-- (lo schema base in supabase_schema.sql è già aggiornato per i
-- progetti nuovi; su un database già creato vanno applicate queste
-- modifiche esplicitamente).
-- ============================================================

-- 1) Colore del docente, usato per lo sfondo delle celle nell'orario.
alter table teachers
  add column if not exists colore text;

-- 2) Eccezione manuale: permette allo stesso docente di comparire in due
--    classi nello stesso slot orario (es. Scienze motorie con due classi
--    unite). Si applica solo alle ore inserite a mano dall'app, mai a
--    quelle generate automaticamente.
alter table schedule_entries
  add column if not exists permette_doppia_classe boolean not null default false;

-- Il vincolo unique(teacher_id, time_slot_id) creato dallo schema originale
-- va sostituito con un indice unico parziale che esclude le righe con
-- l'eccezione attiva. Il nome del vincolo generato automaticamente da
-- Postgres per "unique (teacher_id, time_slot_id)" è quello sotto; se il
-- comando "drop constraint" desse errore, controllare il nome esatto in
-- Database > Tables > schedule_entries > Constraints e sostituirlo qui.
alter table schedule_entries
  drop constraint if exists schedule_entries_teacher_id_time_slot_id_key;

drop index if exists schedule_entries_teacher_id_time_slot_id_key;

create unique index schedule_entries_teacher_id_time_slot_id_key
  on schedule_entries (teacher_id, time_slot_id)
  where not permette_doppia_classe;
