import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

const SUPABASE_URL = defineSecret('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = defineSecret('SUPABASE_SERVICE_KEY');

export const createMaccabiAutomationJob = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '512MiB',
    secrets: [SUPABASE_URL, SUPABASE_SERVICE_KEY],
    cors: true,
  },
  async (req, res) => {
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
      const schema = String(req.body?.schema ?? '').trim();
      const groups = req.body?.groups ?? [];

      if (!schema) {
        res.status(400).json({
          ok: false,
          message: 'Missing schema',
        });
        return;
      }

      if (!Array.isArray(groups) || groups.length === 0) {
        res.status(400).json({
          ok: false,
          message: 'No groups selected',
        });
        return;
      }

      /*
       * הייבוא מתבצע רק כאשר הפונקציה באמת מופעלת,
       * ולא בזמן Firebase function discovery.
       */
      const { createClient } = await import('@supabase/supabase-js');

      const supabase = createClient(
        SUPABASE_URL.value(),
        SUPABASE_SERVICE_KEY.value(),
        {
          db: {
            schema,
          },
          auth: {
            persistSession: false,
          },
        }
      );

      const { data, error } = await supabase
        .from('automation_jobs')
        .insert({
          provider: 'MACCABI',
          schema_name: schema,
          status: 'pending',
          payload: {
            groups,
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
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      console.error(
        'createMaccabiAutomationJob failed:',
        error
      );

      res.status(500).json({
        ok: false,
        message,
      });
    }
  }
);