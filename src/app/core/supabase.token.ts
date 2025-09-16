// src/app/core/supabase.token.ts
import { InjectionToken } from '@angular/core';
import type { SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE = new InjectionToken<SupabaseClient>('SUPABASE');
