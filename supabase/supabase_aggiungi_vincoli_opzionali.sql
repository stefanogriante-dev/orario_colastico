-- ============================================================
-- Aggiunta delle impostazioni per i vincoli rigidi opzionali e per la
-- durata della generazione automatica.
-- Da eseguire nell'SQL Editor di Supabase sul progetto già esistente
-- (lo schema base in supabase_schema.sql è già aggiornato per i progetti
-- nuovi, ma la tabella school_config su un database già creato va estesa
-- esplicitamente).
--
-- Le nuove colonne hanno un default coerente con il comportamento attuale
-- dell'app (tutti i vincoli attivi, soglie 5/6, generazione da 5 minuti),
-- quindi l'unica riga esistente in school_config viene aggiornata
-- automaticamente senza cambiare nulla nel comportamento fino a quando non
-- si modificano le nuove impostazioni dalla pagina Orario.
-- ============================================================

alter table school_config
  add column if not exists vincolo_max_ore_classe_giorno boolean not null default true,
  add column if not exists vincolo_adiacenza_materia boolean not null default true,
  add column if not exists vincolo_max_ore_giorno_docente boolean not null default true,
  add column if not exists limite_ore_giorno_normale smallint not null default 5,
  add column if not exists limite_ore_giorno_eccezione smallint not null default 6,
  add column if not exists vincolo_motoria_arte_tecnologia boolean not null default true,
  add column if not exists durata_generazione_minuti smallint not null default 5;
