import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = defineSecret('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = defineSecret('SUPABASE_SERVICE_KEY');

function supabaseForSchema(schema: string) {
  return createClient(SUPABASE_URL.value(), SUPABASE_SERVICE_KEY.value(), {
    db: { schema },
    auth: { persistSession: false },
  });
}

export const createMaccabiAutomationJob = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '512MiB',
    secrets: [SUPABASE_URL, SUPABASE_SERVICE_KEY],
  },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({
        ok: false,
        message: 'Method not allowed',
      });
      return;
    }

    try {
      const schema = String(req.body?.schema || '').trim();
      const lessons = req.body?.lessons ?? [];

      if (!schema) {
        res.status(400).json({
          ok: false,
          message: 'Missing schema',
        });
        return;
      }

      if (!Array.isArray(lessons) || lessons.length === 0) {
        res.status(400).json({
          ok: false,
          message: 'No lessons selected',
        });
        return;
      }

      const sb = supabaseForSchema(schema);

      const { data, error } = await sb
        .from('automation_jobs')
        .insert({
          provider: 'MACCABI',
          schema_name: schema,
          status: 'pending',
          payload: {
            lessons,
            createdFrom: 'claims-page',
          },
        })
        .select('id, status, created_at')
        .single();

      if (error) {
        throw new Error(error.message);
      }

      res.status(200).json({
        ok: true,
        jobId: data.id,
        status: data.status,
        message: 'Maccabi automation job created',
      });
    } catch (error: any) {
      res.status(500).json({
        ok: false,
        message: error?.message ?? 'Unknown error',
      });
    }
  }
);