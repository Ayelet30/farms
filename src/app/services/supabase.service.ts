// supabaseClient.ts
//import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { createClient, SupabaseClient } from '@supabase/supabase-js';


const supabaseUrl = 'https://aztgdhcvucvpvsmusfpz.supabase.co' 
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6dGdkaGN2dWN2cHZzbXVzZnB6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIxMzI4NDIsImV4cCI6MjA2NzcwODg0Mn0.NRhi2ZJq4I0TSVI91Epf_aQT6UUYpcE7Mm1GMPSrC8s'


let supabase: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { //"אל תתערב לי בניהול session או ב־auth – אני משתמשת ב־Firebase"

        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }
  return supabase;
}