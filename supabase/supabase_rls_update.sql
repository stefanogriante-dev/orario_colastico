-- ============================================================
-- Aggiornamento RLS — rimozione autenticazione
-- Da eseguire DOPO supabase_schema.sql, nell'SQL Editor di Supabase
-- ============================================================

drop policy if exists "utente autenticato" on school_config;
drop policy if exists "utente autenticato" on time_slots;
drop policy if exists "utente autenticato" on subjects;
drop policy if exists "utente autenticato" on classes;
drop policy if exists "utente autenticato" on teachers;
drop policy if exists "utente autenticato" on teacher_classes;
drop policy if exists "utente autenticato" on preferences;
drop policy if exists "utente autenticato" on schedule_entries;
drop policy if exists "utente autenticato" on generation_runs;

-- Policy aperte: accesso completo con la chiave pubblica (anon), nessun login richiesto.
-- RLS resta abilitata (buona pratica), ma non filtra nulla: se in futuro si aggiunge
-- un login basta sostituire "true" con una condizione su auth.uid()/auth.role().

create policy "accesso pubblico" on school_config    for all using (true) with check (true);
create policy "accesso pubblico" on time_slots       for all using (true) with check (true);
create policy "accesso pubblico" on subjects         for all using (true) with check (true);
create policy "accesso pubblico" on classes          for all using (true) with check (true);
create policy "accesso pubblico" on teachers         for all using (true) with check (true);
create policy "accesso pubblico" on teacher_classes  for all using (true) with check (true);
create policy "accesso pubblico" on preferences      for all using (true) with check (true);
create policy "accesso pubblico" on schedule_entries for all using (true) with check (true);
create policy "accesso pubblico" on generation_runs  for all using (true) with check (true);
