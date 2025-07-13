// supabaseClient.ts
//import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getAuth, signOut } from 'firebase/auth';



const supabaseUrl = 'https://aztgdhcvucvpvsmusfpz.supabase.co' 
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6dGdkaGN2dWN2cHZzbXVzZnB6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIxMzI4NDIsImV4cCI6MjA2NzcwODg0Mn0.NRhi2ZJq4I0TSVI91Epf_aQT6UUYpcE7Mm1GMPSrC8s'


export let supabase: SupabaseClient | null = null;

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


export async function getCurrentUserData(): Promise<any> {
  const auth = getAuth();
  const currentUser = auth.currentUser;

  if (!currentUser) {
    console.warn('משתמש לא מחובר');
    return null;
  }

  const uid = currentUser.uid;
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('users') // או 'parents' / 'instructors'
    .select('*')
    .eq('uid', uid)
    .single();

  if (error) {
    console.error('שגיאה בשליפת פרטי משתמש מ־Supabase:', error);
    return null;
  }

  return data;
}

export async function logout(): Promise<void> {
  const auth = getAuth();
  await signOut(auth);
}


export async function getFarmNameById(farmId: string): Promise<string> {
  if (!supabase) {
    throw new Error('Supabase client is not initialized.');
  }

  const { data, error } = await supabase
    .from('farms')
    .select('name')
    .eq('id', farmId)
    .single();

  if (error) {
    console.error('שגיאה בשליפת שם החווה:', error);
    return '';
  }

  return data?.name || '';
}
