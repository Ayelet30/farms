// functions/src/initFirebase.ts
import * as path from 'path';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ path: path.resolve(__dirname, '../.env.local') });
dotenvConfig({ path: path.resolve(__dirname, '../.env') });

// לוג עדין שלא חושף ערכים:
console.info('[initFirebase] dotenv loaded', {
  has_SUPABASE_URL: !!process.env.SUPABASE_URL,
  has_SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
  has_SUPABASE_JWT_SECRET: !!process.env.SUPABASE_JWT_SECRET,
});
