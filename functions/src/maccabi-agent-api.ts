import { createDecipheriv, createHash } from 'node:crypto';

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

const SUPABASE_URL = defineSecret('SUPABASE_URL');

const SUPABASE_SERVICE_KEY = defineSecret(
  'SUPABASE_SERVICE_KEY'
);

const INTEGRATIONS_MASTER_KEY = defineSecret(
  'INTEGRATIONS_MASTER_KEY'
);

const JOB_LEASE_MINUTES = 10;
const MAX_JOB_ATTEMPTS = 5;

interface AgentInstallation {
  id: string;
  schema_name: string;
  provider: string;
  is_active: boolean;
}

interface EncryptedSecretRow {
  key_name: string;
  enc_iv: string;
  enc_tag: string;
  enc_data: string;
}

interface MaccabiCredentials {
  username: string;
  password: string;
  serviceProviderType: string;
  serviceProviderCode: string;
  endpoint: string;
}

function getBearerToken(
  authorizationHeader: string | undefined
): string {
  const match = /^Bearer\s+(.+)$/i.exec(
    authorizationHeader ?? ''
  );

  const token = match?.[1]?.trim();

  if (!token) {
    throw new Error(
      'Missing agent authorization token'
    );
  }

  return token;
}

function hashAgentToken(token: string): string {
  return createHash('sha256')
    .update(token, 'utf8')
    .digest('hex');
}

function byteaToBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  const normalized = String(value ?? '')
    .replace(/^\\x/, '')
    .replace(/^\\\\x/, '');

  return Buffer.from(normalized, 'hex');
}

function decryptIntegrationSecret(
  row: EncryptedSecretRow
): string {
  const masterKey = Buffer.from(
    INTEGRATIONS_MASTER_KEY.value(),
    'base64'
  );

  if (masterKey.length !== 32) {
    throw new Error(
      'INTEGRATIONS_MASTER_KEY must be a 32-byte base64 value'
    );
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    masterKey,
    byteaToBuffer(row.enc_iv)
  );

  decipher.setAuthTag(
    byteaToBuffer(row.enc_tag)
  );

  return Buffer.concat([
    decipher.update(
      byteaToBuffer(row.enc_data)
    ),
    decipher.final(),
  ]).toString('utf8');
}

function getRequiredSecret(
  values: Record<string, string>,
  key: string
): string {
  const value = values[key]?.trim();

  if (!value) {
    throw new Error(
      `Missing MACCABI ${key}`
    );
  }

  return value;
}

function addMinutes(
  date: Date,
  minutes: number
): string {
  return new Date(
    date.getTime() + minutes * 60_000
  ).toISOString();
}

export const maccabiAgentApi = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '512MiB',

    secrets: [
      SUPABASE_URL,
      SUPABASE_SERVICE_KEY,
      INTEGRATIONS_MASTER_KEY,
    ],

    /*
     * ה־Agent הוא תוכנת Node ולא דפדפן,
     * ולכן אין צורך ב־CORS בפונקציה הזאת.
     */
    cors: false,
  },

  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({
        ok: false,
        message: 'Method not allowed',
      });

      return;
    }

    try {
      const { createClient } = await import(
        '@supabase/supabase-js'
      );

      /*
       * מזהים את התקנת ה־Agent לפי הטוקן.
       * במסד שמור רק SHA-256 של הטוקן.
       */
      const rawToken = getBearerToken(
        req.headers.authorization
      );

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
        error: installationError,
      } = await publicSupabase
        .from('automation_agent_installations')
        .select(`
          id,
          schema_name,
          provider,
          is_active
        `)
        .eq(
          'token_hash',
          hashAgentToken(rawToken)
        )
        .eq('provider', 'MACCABI')
        .eq('is_active', true)
        .maybeSingle();

      if (installationError) {
        throw new Error(
          `Could not validate agent: ${installationError.message}`
        );
      }

      if (!installation) {
        res.status(401).json({
          ok: false,
          message:
            'Invalid or inactive agent token',
        });

        return;
      }

      const agentInstallation =
        installation as AgentInstallation;

      /*
       * שם הסכמה נלקח מההתקנה המאומתת,
       * ולא מגוף הבקשה שה־Agent שולח.
       */
      const tenantSupabase = createClient(
        SUPABASE_URL.value(),
        SUPABASE_SERVICE_KEY.value(),
        {
          db: {
            schema:
              agentInstallation.schema_name,
          },
          auth: {
            persistSession: false,
          },
        }
      );

      const action = String(
        req.body?.action ?? ''
      )
        .trim()
        .toLowerCase();

      const agentId =
        String(req.body?.agentId ?? '')
          .trim() || null;

      const agentVersion =
        String(req.body?.version ?? '')
          .trim() || null;

      const now = new Date();
      const nowIso = now.toISOString();

      // =====================================================
      // HEARTBEAT
      // =====================================================

      if (action === 'heartbeat') {
        const status =
          String(
            req.body?.status ?? 'idle'
          ).trim() || 'idle';

        const currentJobId =
          req.body?.currentJobId || null;

        const { error: heartbeatError } =
          await publicSupabase
            .from(
              'automation_agent_installations'
            )
            .update({
              agent_id: agentId,
              version: agentVersion,
              last_status: status,
              current_job_id: currentJobId,
              last_seen_at: nowIso,
              updated_at: nowIso,
            })
            .eq(
              'id',
              agentInstallation.id
            );

        if (heartbeatError) {
          throw new Error(
            `Could not update heartbeat: ${heartbeatError.message}`
          );
        }

        /*
         * אם ה־Agent עובד על משימה,
         * מאריכים את תוקף התפיסה שלה.
         */
        if (currentJobId) {
          const { error: leaseError } =
            await tenantSupabase
              .from('automation_jobs')
              .update({
                lease_expires_at: addMinutes(
                  now,
                  JOB_LEASE_MINUTES
                ),
              })
              .eq('id', currentJobId)
              .eq('status', 'running')
              .eq(
                'agent_installation_id',
                agentInstallation.id
              );

          if (leaseError) {
            console.error(
              'Could not extend job lease:',
              leaseError
            );
          }
        }

        res.status(200).json({
          ok: true,
          serverTime: nowIso,
        });

        return;
      }

      // =====================================================
      // CLAIM — קבלת המשימה הבאה
      // =====================================================

      if (action === 'claim') {
        /*
         * מחזירים לתור משימות שהמחשב תפס
         * אבל הפסיק לשלוח heartbeat.
         */
        const {
          error: releaseExpiredError,
        } = await tenantSupabase
          .from('automation_jobs')
          .update({
            status: 'pending',
            agent_installation_id: null,
            agent_id: null,
            claimed_at: null,
            lease_expires_at: null,
          })
          .eq('provider', 'MACCABI')
          .eq('status', 'running')
          .lt(
            'lease_expires_at',
            nowIso
          )
          .lt(
            'attempt_count',
            MAX_JOB_ATTEMPTS
          );

        if (releaseExpiredError) {
          throw new Error(
            `Could not release expired jobs: ${releaseExpiredError.message}`
          );
        }

        /*
         * מאתרים את המשימה הממתינה הישנה ביותר.
         */
        const {
          data: pendingJobs,
          error: searchError,
        } = await tenantSupabase
          .from('automation_jobs')
          .select('*')
          .eq('provider', 'MACCABI')
          .eq('status', 'pending')
          .order('created_at', {
            ascending: true,
          })
          .limit(1);

        if (searchError) {
          throw new Error(
            `Could not search pending jobs: ${searchError.message}`
          );
        }

        const candidate =
          pendingJobs?.[0];

        if (!candidate) {
          res.status(200).json({
            ok: true,
            job: null,
          });

          return;
        }

        /*
         * תפיסה אטומית:
         * מעדכנים רק אם המשימה עדיין pending.
         *
         * אם Agent אחר הספיק לתפוס אותה,
         * לא תוחזר אף שורה.
         */
        const {
          data: claimedRows,
          error: claimError,
        } = await tenantSupabase
          .from('automation_jobs')
          .update({
            status: 'running',
            started_at: nowIso,
            finished_at: null,
            result: null,
            error: null,

            agent_installation_id:
              agentInstallation.id,

            agent_id: agentId,
            claimed_at: nowIso,

            lease_expires_at: addMinutes(
              now,
              JOB_LEASE_MINUTES
            ),

            attempt_count:
              Number(
                candidate.attempt_count ?? 0
              ) + 1,
          })
          .eq('id', candidate.id)
          .eq('status', 'pending')
          .select('*');

        if (claimError) {
          throw new Error(
            `Could not claim job: ${claimError.message}`
          );
        }

        const claimedJob =
          claimedRows?.[0];

        /*
         * Agent אחר הספיק לתפוס אותה.
         */
        if (!claimedJob) {
          res.status(200).json({
            ok: true,
            job: null,
          });

          return;
        }

        /*
         * שולפים את פרטי מכבי המוצפנים
         * מתוך הסכמה של החווה.
         */
        const {
          data: encryptedRows,
          error: credentialsError,
        } = await tenantSupabase
          .from('integration_secrets')
          .select(`
            key_name,
            enc_iv,
            enc_tag,
            enc_data
          `)
          .eq('provider', 'MACCABI');

        if (credentialsError) {
          throw new Error(
            `Could not load Maccabi credentials: ${credentialsError.message}`
          );
        }

        if (!encryptedRows?.length) {
          throw new Error(
            'No Maccabi credentials found'
          );
        }

        const decryptedSecrets =
          Object.fromEntries(
            (
              encryptedRows as EncryptedSecretRow[]
            ).map((row) => [
              row.key_name,
              decryptIntegrationSecret(row),
            ])
          );

        const credentials: MaccabiCredentials = {
          username: getRequiredSecret(
            decryptedSecrets,
            'USERNAME'
          ),

          password: getRequiredSecret(
            decryptedSecrets,
            'PASSWORD'
          ),

          serviceProviderType:
            getRequiredSecret(
              decryptedSecrets,
              'SERVICE_PROVIDER_TYPE'
            ),

          serviceProviderCode:
            getRequiredSecret(
              decryptedSecrets,
              'SERVICE_PROVIDER_CODE'
            ),

          endpoint:
            decryptedSecrets.ENDPOINT ||
            'https://wmsup.mac.org.il',
        };

        res.status(200).json({
          ok: true,
          job: claimedJob,
          credentials,
        });

        return;
      }

      // =====================================================
      // הפעולות מכאן דורשות jobId
      // =====================================================

      const jobId = String(
        req.body?.jobId ?? ''
      ).trim();

      if (!jobId) {
        res.status(400).json({
          ok: false,
          message: 'Missing jobId',
        });

        return;
      }

      // =====================================================
      // COMPLETE
      // =====================================================

      if (action === 'complete') {
        const {
          data: completedRows,
          error: completeError,
        } = await tenantSupabase
          .from('automation_jobs')
          .update({
            status: 'done',
            finished_at: nowIso,
            lease_expires_at: null,

            result: {
              success: true,
              ...(req.body?.result ?? {}),
            },

            error: null,
          })
          .eq('id', jobId)
          .eq('status', 'running')
          .eq(
            'agent_installation_id',
            agentInstallation.id
          )
          .select('id');

        if (completeError) {
          throw new Error(
            `Could not complete job: ${completeError.message}`
          );
        }

        if (!completedRows?.length) {
          res.status(409).json({
            ok: false,
            message:
              'Job is not running or does not belong to this Agent',
          });

          return;
        }

        res.status(200).json({
          ok: true,
          jobId,
          status: 'done',
        });

        return;
      }

      // =====================================================
      // FAIL
      // =====================================================

      if (action === 'fail') {
        const errorMessage = String(
          req.body?.error?.message ??
            req.body?.error ??
            'Unknown agent error'
        );

        const errorStack =
          req.body?.error?.stack
            ? String(
                req.body.error.stack
              )
            : null;

        const {
          data: failedRows,
          error: failError,
        } = await tenantSupabase
          .from('automation_jobs')
          .update({
            status: 'failed',
            finished_at: nowIso,
            lease_expires_at: null,

            /*
             * אצלך error הוא text.
             */
            error: errorMessage,

            result: {
              success: false,
              message: errorMessage,
              stack: errorStack,
            },
          })
          .eq('id', jobId)
          .eq('status', 'running')
          .eq(
            'agent_installation_id',
            agentInstallation.id
          )
          .select('id');

        if (failError) {
          throw new Error(
            `Could not fail job: ${failError.message}`
          );
        }

        if (!failedRows?.length) {
          res.status(409).json({
            ok: false,
            message:
              'Job is not running or does not belong to this Agent',
          });

          return;
        }

        res.status(200).json({
          ok: true,
          jobId,
          status: 'failed',
        });

        return;
      }

      res.status(400).json({
        ok: false,
        message:
          `Unsupported action: ${action}`,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      console.error(
        'maccabiAgentApi failed:',
        error
      );

      res.status(500).json({
        ok: false,
        message,
      });
    }
  }
);