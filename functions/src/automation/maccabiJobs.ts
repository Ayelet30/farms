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
      const action = String(
  req.body?.action ?? 'create'
)
  .trim()
  .toLowerCase();
      const groups = req.body?.groups ?? [];

      if (!schema) {
        res.status(400).json({
          ok: false,
          message: 'Missing schema',
        });
        return;
      }
const { createClient } = await import(
  '@supabase/supabase-js'
);
if (action === 'status') {
  const publicSupabase = createClient(
    SUPABASE_URL.value(),
    SUPABASE_SERVICE_KEY.value(),
    {
      db: {
        schema: 'public',
      },
      auth: {
        persistSession: false,
      },
    }
  );

  const {
    data: installation,
    error: statusError,
  } = await publicSupabase
    .from('automation_agent_installations')
    .select(`
      agent_id,
      version,
      last_status,
      current_job_id,
      last_seen_at
    `)
    .eq('schema_name', schema)
    .eq('provider', 'MACCABI')
    .eq('is_active', true)
    .order('last_seen_at', {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (statusError) {
    throw new Error(
      `Could not load agent status: ${statusError.message}`
    );
  }

  const lastSeenAt =
    installation?.last_seen_at ?? null;

  const millisecondsSinceLastSeen =
    lastSeenAt
      ? Date.now() -
        new Date(lastSeenAt).getTime()
      : Number.POSITIVE_INFINITY;

  /*
   * ה־Agent שולח heartbeat כל 30 שניות.
   * נותנים מרווח של 90 שניות.
   */
  const online =
    Number.isFinite(millisecondsSinceLastSeen) &&
    millisecondsSinceLastSeen <= 90_000;

  res.status(200).json({
    ok: true,
    online,
    app: 'moach-maccabi-agent',
    agentId:
      installation?.agent_id ?? null,
    version:
      installation?.version ?? null,
    status:
      installation?.last_status ?? null,
    currentJobId:
      installation?.current_job_id ?? null,
    lastSeenAt,
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

      const jobsToInsert = groups.map((group) => ({
  provider: 'MACCABI',
  schema_name: schema,
  status: 'pending',
  payload: {
    groups: [group],
    createdFrom: 'claims-page',
  },
}));

const { data, error } = await supabase
  .from('automation_jobs')
  .insert(jobsToInsert)
  .select('id, status, created_at');

if (error) {
  throw new Error(error.message);
}

res.status(200).json({
  ok: true,
  jobId: data?.[0]?.id ?? null,
  jobIds: data?.map((job) => job.id) ?? [],
  jobsCreated: data?.length ?? 0,
  message: `${data?.length ?? 0} Maccabi automation jobs created`,
});

return;

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