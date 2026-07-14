-- ============================================================
-- Aggiunta del tipo di preferenza "no_ora_specifica" (evitare una
-- qualsiasi ora della giornata, non solo prima/ultima)
-- Da eseguire nell'SQL Editor di Supabase sul progetto già esistente
-- (lo schema base in supabase_schema.sql è già aggiornato per i progetti
-- nuovi, ma l'enum su un database già creato va esteso esplicitamente).
--
-- A differenza della rimozione di un valore da un enum, l'aggiunta è
-- una singola istruzione: Postgres permette di aggiungere nuovi valori
-- senza dover ricreare il tipo.
-- ============================================================

alter type tipo_preferenza add value 'no_ora_specifica';
