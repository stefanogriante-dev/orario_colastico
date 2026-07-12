-- ============================================================
-- Rimozione del tipo di preferenza "continuita_classe"
-- Da eseguire nell'SQL Editor di Supabase sul progetto già esistente
-- (lo schema base in supabase_schema.sql è già stato aggiornato per i
-- progetti nuovi, ma l'enum su un database già creato va modificato
-- esplicitamente: Postgres non permette di rimuovere un valore da un
-- enum esistente senza ricrearlo).
-- ============================================================

-- 1) Elimina eventuali preferenze già salvate con questo tipo, altrimenti
--    la ricreazione dell'enum fallirebbe (righe che referenziano un valore
--    che sta per non esistere più).
delete from preferences where tipo = 'continuita_classe';

-- 2) Ricrea l'enum senza 'continuita_classe'.
alter type tipo_preferenza rename to tipo_preferenza_old;

create type tipo_preferenza as enum (
  'giorno_libero',
  'no_prima_ora',
  'no_ultima_ora',
  'evita_buchi',
  'altro'
);

alter table preferences
  alter column tipo type tipo_preferenza using tipo::text::tipo_preferenza;

drop type tipo_preferenza_old;
