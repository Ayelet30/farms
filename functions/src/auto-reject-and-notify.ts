import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { createClient } from '@supabase/supabase-js';
import { notifyUserInternal } from './notify-user-client';

const SUPABASE_URL_S = defineSecret('SUPABASE_URL');
const SUPABASE_KEY_S = defineSecret('SUPABASE_SERVICE_KEY');
const INTERNAL_CALL_SECRET_S = defineSecret('INTERNAL_CALL_SECRET'); // ✅ חובה אם notifyUserInternal משתמש בו
const ALLOWED_ORIGINS = new Set<string>([
  'https://smart-farm.org',
  'https://bereshit-ac5d8.web.app',
  'https://bereshit-ac5d8.firebaseapp.com',
  'http://localhost:4200',     
  'https://localhost:4200',   
]);

function applyCors(req: any, res: any): boolean {
  const origin = String(req.headers.origin || '');

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  // אם את שולחת Authorization (ואת כן) חובה לאשר אותו
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Internal-Call-Secret');
  res.setHeader('Access-Control-Max-Age', '3600');

  // ✅ preflight
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }

  // אם origin לא מורשה – עדיף לחסום ברור (אופציונלי)
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    res.status(403).send('CORS blocked');
    return true;
  }

  return false;
}
export const autoRejectRequestAndNotify = onRequest(
  { secrets: [SUPABASE_URL_S, SUPABASE_KEY_S, INTERNAL_CALL_SECRET_S] },
  async (req, res): Promise<void> => {
      if (applyCors(req, res)) return;

    try {
      if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

      const { tenantSchema, requestId, reason, decidedByUid } = req.body as {
        tenantSchema: string;
        requestId: string;
        reason: string;
        decidedByUid?: string | null;
      };

      if (!tenantSchema || !requestId || !reason) {
        res.status(400).json({ ok: false, error: 'missing tenantSchema/requestId/reason' });
        return;
      }

      const sb = createClient(SUPABASE_URL_S.value(), SUPABASE_KEY_S.value(), {
        db: { schema: tenantSchema },
      });

      const { data: reqRow, error: rErr } = await sb
        .from('secretarial_requests')
        .select('id,status,requested_by_uid,requested_by_role,payload')
        .eq('id', requestId)
        .maybeSingle();

      if (rErr) throw rErr;
      if (!reqRow) { res.status(404).json({ ok: false, error: 'request not found' }); return; }

      if (reqRow.status !== 'PENDING') {
        res.json({ ok: true, skipped: true, status: reqRow.status });
        return;
      }

      const { error: uErr } = await sb
        .from('secretarial_requests')
        .update({
          status: 'REJECTED_BY_SYSTEM',
          decision_note: String(reason).trim(),
          decided_by_uid: decidedByUid ?? null,
          decided_at: new Date().toISOString(),
        })
        .eq('id', requestId)
        .eq('status', 'PENDING');

      if (uErr) throw uErr;

      const requesterUid = reqRow.requested_by_uid as string | null;
      const requesterRole = (reqRow.requested_by_role as 'parent' | 'instructor' | null) ?? null;

      if (requesterUid && requesterUid !== 'PUBLIC' && (requesterRole === 'parent' || requesterRole === 'instructor')) {
        await notifyUserInternal({
          tenantSchema,
          userType: requesterRole,
          uid: requesterUid,
          subject: 'הבקשה נדחתה אוטומטית',
          html: `<div dir="rtl">
                  <p>שלום,</p>
                  <p>הבקשה שלך נדחתה אוטומטית על ידי המערכת.</p>
                  <p><b>סיבה:</b> ${escapeHtml(String(reason))}</p>
                </div>`,
          category: 'SYSTEM_REJECT',
          forceEmail: true,
        });
      }

      if (requesterRole === 'instructor') {
        const parentUid = await resolveParentUid(sb, (reqRow as any).payload);
        if (parentUid) {
          await notifyUserInternal({
            tenantSchema,
            userType: 'parent',
            uid: parentUid,
            subject: 'בקשה נדחתה אוטומטית (מידע להורה)',
            html: `<div dir="rtl">
                    <p>שלום,</p>
                    <p>בקשה שהוגשה ע"י מדריך נדחתה אוטומטית על ידי המערכת.</p>
                    <p><b>סיבה:</b> ${escapeHtml(String(reason))}</p>
                  </div>`,
            category: 'SYSTEM_REJECT',
            forceEmail: true,
          });
        }
      }

      res.json({ ok: true });
      return;

    } catch (e: any) {
      console.error('[autoRejectRequestAndNotify] error:', e);
    applyCors(req, res); // ✅ כדי שהדפדפן יקבל CORS גם בשגיאה
      res.status(500).json({ ok: false, error: e?.message ?? 'internal error' });
      return;
    }
  }
);
function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// נסיון לזהות parentUid מתוך ה-payload (תומך בכמה צורות נפוצות)
async function resolveParentUid(sb: any, payload: any): Promise<string | null> {
  const p = payload ?? {};

  // אם כבר יש parent_uid בפיילוד
  const direct =
    p.parent_uid ?? p.parentUid ?? p.parent?.uid ?? p.parent?.parent_uid ?? null;
  if (direct) return String(direct);

  // אם יש child_id / child_uuid — ננסה להביא parent_uid מהילד
  const childId = p.child_id ?? p.childId ?? p.child_uuid ?? null;
  if (childId) {
    const { data } = await sb
      .from('children')
      .select('parent_uid')
      .eq('child_uuid', childId)
      .maybeSingle();
    const pu = (data as any)?.parent_uid ?? null;
    if (pu) return String(pu);
  }

  return null;
}