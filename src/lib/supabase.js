import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const isSupabaseConfigured = Boolean(url && key);
export const supabase = isSupabaseConfigured ? createClient(url, key) : null;
export const SUPABASE_CONFIG_ERROR = "Το Supabase δεν έχει ρυθμιστεί ακόμη.";
