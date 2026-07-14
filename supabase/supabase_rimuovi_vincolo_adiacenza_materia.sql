-- ============================================================
-- Il vincolo "materia ripetuta nello stesso giorno deve essere adiacente"
-- non è più disattivabile dall'interfaccia: è ora un vincolo STRUTTURALE,
-- sempre attivo (come le doppie prenotazioni o le ore manuali fisse).
--
-- Questa migrazione è OPZIONALE: rimuove semplicemente la colonna
-- vincolo_adiacenza_materia da school_config, ormai inutilizzata
-- dall'applicazione. Se non la esegui, la colonna resta nel database ma
-- viene ignorata: non causa nessun problema.
-- ============================================================

alter table school_config
  drop column if exists vincolo_adiacenza_materia;
