import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Nessuna autenticazione: si usa direttamente la chiave pubblica (anon).
// Le policy RLS su Supabase sono aperte (vedi supabase_rls_update.sql).
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
