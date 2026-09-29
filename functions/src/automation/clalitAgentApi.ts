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
// An ASP.NET submit can succeed even if the connection drops before a receipt.
// Never replay a claim-creation job automatically after a lost lease.
const MAX_JOB_ATTEMPTS = 1;

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

interface ClalitCredentials {
  username: string;
  password: string;
  identificationCode: string;
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
      `Missing CLALIT ${key}`
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

export const clalitAgentApi = onRequest(
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
        .eq('provider', 'CLALIT')
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
        const { error: orphanError } = await tenantSupabase
          .from('automation_jobs')
          .update({
            status: 'failed',
            error: 'ה־Agent התנתק. יש לבדוק באתר כללית לפני ניסיון חוזר.',
            finished_at: nowIso,
            lease_expires_at: null,
          })
          .eq('provider', 'CLALIT').eq('status', 'running')
          .lt('lease_expires_at', nowIso)
          .gte('attempt_count', MAX_JOB_ATTEMPTS);
        if (orphanError) throw orphanError;
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
          .eq('provider', 'CLALIT')
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
          .eq('provider', 'CLALIT')
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

        // Validate and decrypt all required credentials before claiming the job.
        // A configuration error must not leave a job running without an agent.
        /*
         * שולפים את פרטי כללית המוצפנים
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
          .eq('provider', 'CLALIT');

        if (credentialsError) {
          throw new Error(
            `Could not load Clalit credentials: ${credentialsError.message}`
          );
        }

        if (!encryptedRows?.length) {
          throw new Error(
            'No Clalit credentials found'
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

        const credentials: ClalitCredentials = {
          username: getRequiredSecret(
            decryptedSecrets,
            'USERNAME'
          ),

          password: getRequiredSecret(
            decryptedSecrets,
            'PASSWORD'
          ),
          identificationCode: '123',

          endpoint:
  decryptedSecrets.PORTAL_URL?.trim() ||
  'https://portalsapakim.mushlam.clalit.co.il/Mushlam/Login.aspx',
        };


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

      if (action === 'checkpoint' || action === 'invoice') {
        const { data: job, error: jobError } = await tenantSupabase
          .from('automation_jobs')
          .select('id,payload,result')
          .eq('id', jobId)
          .eq('provider', 'CLALIT')
          .eq('status', 'running')
          .eq('agent_installation_id', agentInstallation.id)
          .maybeSingle();
        if (jobError) throw jobError;
        if (!job) {
          res.status(409).json({ ok: false, message: 'Job is not owned by this Agent' });
          return;
        }
        const lessonKey = String(req.body?.lessonKey ?? '');
        const lesson = (job.payload?.lessons ?? []).find((item: any) =>
          `${item.lesson_id}__${item.occur_date}__${item.child_id}` === lessonKey);
        if (!lesson) {
          res.status(400).json({ ok: false, message: 'Lesson does not belong to job' });
          return;
        }

        if (action === 'invoice') {
          const invoice = lesson.invoice;
          if (!invoice?.bucket || !invoice?.path) {
            res.status(400).json({ ok: false, message: 'Invoice reference is missing' });
            return;
          }
          const { data: pdf, error: pdfError } = await tenantSupabase.storage
            .from(invoice.bucket).download(invoice.path);
          if (pdfError || !pdf || pdf.size > 5_000_000 || pdf.size === 0) {
            res.status(400).json({ ok: false, message: 'Invoice PDF unavailable or too large' });
            return;
          }
          const bytes = Buffer.from(await pdf.arrayBuffer());
          if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
            res.status(400).json({ ok: false, message: 'Invoice is not a PDF' });
            return;
          }
          res.status(200).json({
            ok: true, mimeType: 'application/pdf',
            filename: `invoice-${lesson.child_id}-${invoice.report_month}.pdf`,
            dataBase64: bytes.toString('base64'),
          });
          return;
        }

        const phase = String(req.body?.phase ?? '');
        if (!['claim_opened', 'payment_sent', 'failed', 'uncertain'].includes(phase)) {
          res.status(400).json({ ok: false, message: 'Invalid checkpoint phase' });
          return;
        }
        const previous = job.result?.checkpoints?.[lessonKey] ?? null;
        const claimNumber = String(req.body?.claimNumber ?? previous?.claimNumber ?? '').trim();
        if ((phase === 'claim_opened' || phase === 'payment_sent') && !claimNumber) {
          res.status(400).json({ ok: false, message: 'Claim number is required' });
          return;
        }
        if (previous?.claimNumber && claimNumber && previous.claimNumber !== claimNumber) {
          res.status(409).json({ ok: false, message: 'Claim number changed' });
          return;
        }
        if (previous?.phase === 'payment_sent' && phase !== 'payment_sent') {
          res.status(409).json({ ok: false, message: 'Cannot downgrade a sent payment' });
          return;
        }
        const checkpoints = {
          ...(job.result?.checkpoints ?? {}),
          [lessonKey]: {
            phase, claimNumber: claimNumber || null,
            error: req.body?.error ? String(req.body.error).slice(0, 500) : null,
            updatedAt: nowIso,
          },
        };
        const { data: updated, error: updateError } = await tenantSupabase
          .from('automation_jobs')
          .update({ result: { ...(job.result ?? {}), checkpoints } })
          .eq('id', jobId).eq('status', 'running')
          .eq('agent_installation_id', agentInstallation.id).select('id');
        if (updateError) throw updateError;
        if (!updated?.length) {
          res.status(409).json({ ok: false, message: 'Job lease was lost' });
          return;
        }
        res.status(200).json({ ok: true, lessonKey, checkpoint: checkpoints[lessonKey] });
        return;
      }

      // =====================================================
      // COMPLETE
      // =====================================================

      if (action === 'complete') {
  const rawResult =
    req.body?.result;

  if (
    !rawResult ||
    typeof rawResult !== 'object' ||
    Array.isArray(rawResult)
  ) {
    res.status(400).json({
      ok: false,
      message:
        'Missing or invalid job result',
    });

    return;
  }

  const jobResult =
    rawResult as Record<string, any>;

  const lessonResults =
    Array.isArray(
      jobResult.lessonResults
    )
      ? jobResult.lessonResults
      : [];

  const successCount =
    lessonResults.filter(
      (item: any) =>
        item?.status === 'success'
    ).length;

  const failedCount =
    lessonResults.filter(
      (item: any) =>
        item?.status === 'failed'
    ).length;

  const unknownCount =
    lessonResults.filter(
      (item: any) =>
        item?.status === 'unknown'
    ).length;

  /*
   * משתמשים בסיכום שהגיע מה־Agent,
   * אבל מחשבים מחדש אם הוא אינו קיים.
   */
  const normalizedSummary = {
    successCount:
      Number(
        jobResult.summary
          ?.successCount
      ) || successCount,

    failedCount:
      Number(
        jobResult.summary
          ?.failedCount
      ) || failedCount,

    unknownCount:
      Number(
        jobResult.summary
          ?.unknownCount
      ) || unknownCount,
  };

  const hasResults =
    lessonResults.length > 0;

  const allSucceeded =
    hasResults &&
    normalizedSummary.failedCount === 0 &&
    normalizedSummary.unknownCount === 0;

  const allFailed =
    hasResults &&
    normalizedSummary.successCount === 0 &&
    normalizedSummary.failedCount > 0 &&
    normalizedSummary.unknownCount === 0;

  const partial =
    normalizedSummary.successCount > 0 &&
    (
      normalizedSummary.failedCount > 0 ||
      normalizedSummary.unknownCount > 0
    );

  /*
   * מוצאים שגיאה אמיתית ראשונה,
   * לצורך Job שכולו נכשל.
   */
  const firstFailure =
    lessonResults.find(
      (item: any) =>
        item?.status === 'failed'
    );

  const firstFailureMessage =
    firstFailure?.error
      ? String(firstFailure.error)
      : null;

  /*
   * Job מעורב נשמר כ־done משום שהוא הסתיים,
   * אבל success נשאר false וכל שיעור מוצג
   * לפי lessonResults.
   *
   * רק כאשר כל השיעורים נכשלו,
   * סטטוס ה־Job יהיה failed.
   */
  const databaseStatus = allSucceeded ? 'done' : 'failed';

  const { data: previousJob, error: previousError } = await tenantSupabase
    .from('automation_jobs').select('result').eq('id', jobId)
    .eq('status', 'running').eq('agent_installation_id', agentInstallation.id)
    .maybeSingle();
  if (previousError) throw previousError;
  const normalizedResult = {
    checkpoints: previousJob?.result?.checkpoints ?? {},
    ...jobResult,

    /*
     * חשוב: לא להכריח success:true.
     */
    success: allSucceeded,
    partial,

    summary:
      normalizedSummary,

    lessonResults,
  };

  const {
    data: completedRows,
    error: completeError,
  } = await tenantSupabase
    .from('automation_jobs')
    .update({
      status:
        databaseStatus,

      finished_at:
        nowIso,

      lease_expires_at:
        null,

      result:
        normalizedResult,

      error:
        allFailed
          ? (
              firstFailureMessage ??
              'כל השיעורים במשימה נכשלו'
            )
          : null,
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
    status:
      databaseStatus,

    success:
      allSucceeded,

    partial,

    summary:
      normalizedSummary,
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

        const { data: previousJob, error: previousError } = await tenantSupabase
          .from('automation_jobs').select('result').eq('id', jobId)
          .eq('status', 'running').eq('agent_installation_id', agentInstallation.id)
          .maybeSingle();
        if (previousError) throw previousError;

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
              checkpoints: previousJob?.result?.checkpoints ?? {},
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
        'clalitAgentApi failed:',
        error
      );

      res.status(500).json({
        ok: false,
        message,
      });
    }
  }
);
