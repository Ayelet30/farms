
import { onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fetch from 'node-fetch'; // ✅ חדש

if (!admin.apps.length) admin.initializeApp();

// ===== Secrets =====
const SUPABASE_URL_S = defineSecret('SUPABASE_URL');
const SUPABASE_KEY_S = defineSecret('SUPABASE_SERVICE_KEY');
const SMTP_HOST_S = defineSecret('SMTP_HOST');
const SMTP_PORT_S = defineSecret('SMTP_PORT');
const SMTP_USER_S = defineSecret('SMTP_USER');
const SMTP_PASS_S = defineSecret('SMTP_PASS');
const MAIL_FROM_S = defineSecret('MAIL_FROM');
const INTERNAL_CALL_SECRET_S = defineSecret('INTERNAL_CALL_SECRET');

// ===== CORS allowlist (האפליקציה שלך) =====
const ALLOWED_ORIGINS = new Set<string>([
  'https://smart-farm.org',
  'https://bereshit-ac5d8.web.app',
  'http://localhost:4200',
]);

function cors(req: any, res: any) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  // ✅ חשוב: להוסיף X-Internal-Secret כדי שנוכל לקרוא ל-notifyUser
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Internal-Secret');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

function normStr(x: any, max = 300) {
  const s = String(x ?? '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export const publicCreateParentSignupRequest = onRequest(
  {
    region: 'us-central1',
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S],
  },
  async (req, res): Promise<void> => {
    try {
      if (cors(req, res)) return;

      if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }

      const body = req.body || {};

      // --- חובה ---
      const farmCode = normStr(body.farmCode, 50).toLowerCase(); // "bereshit"
      const first_name = normStr(body.first_name, 15);
      const last_name = normStr(body.last_name, 20);
      const email = normStr(body.email, 60).toLowerCase();
      const phone = normStr(body.phone, 10);
      const id_number = normStr(body.id_number, 9);
      const address = normStr(body.address, 60);

      // --- אופציונלי ---
      const extra_notes = normStr(body.extra_notes, 300);
      const message_preferences = Array.isArray(body.message_preferences)
        ? body.message_preferences.map((x: any) => String(x)).slice(0, 10)
        : ['inapp'];

      // ולידציות בסיסיות
      const missing = [];
      if (!farmCode) missing.push('farmCode');
      if (!first_name) missing.push('first_name');
      if (!last_name) missing.push('last_name');
      if (!email) missing.push('email');
      if (!phone) missing.push('phone');
      if (!id_number) missing.push('id_number');
      if (!address) missing.push('address');

      if (missing.length) {
        res.status(400).json({ error: 'Missing fields', missing });
        return;
      }
      if (!isEmail(email)) {
        res.status(400).json({ error: 'Invalid email' });
        return;
      }
      if (!/^05\d{8}$/.test(phone)) {
        res.status(400).json({ error: 'Invalid phone' });
        return;
      }
      if (!/^\d{9}$/.test(id_number)) {
        res.status(400).json({ error: 'Invalid id_number' });
        return;
      }

      const schema =
        farmCode === 'bereshit'
          ? 'bereshit_farm'
          : farmCode === 'bereshitfarm'
          ? 'bereshit_farm'
          : farmCode === 'bereshit_farm'
          ? 'bereshit_farm'
          : farmCode === 'raanana'
          ? 'raanana_farm'
          : farmCode === 'moach'
          ? 'moacha_atarim_app'
          : '';

      if (!schema) {
        res.status(400).json({ error: 'Unknown farmCode' });
        return;
      }

      const sb = createClient(SUPABASE_URL_S.value(), SUPABASE_KEY_S.value(), {
        auth: { persistSession: false },
      });

      const payload = {
        first_name,
        last_name,
        email,
        phone,
        id_number,
        address,
        extra_notes: extra_notes || null,
        message_preferences,
        referral_url: normStr(body.referral_url, 400) || null,
        public_meta: {
          origin: req.headers.origin || null,
          user_agent: req.headers['user-agent'] || null,
          ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
        },
      };
  

      const { data, error } = await sb
        .schema(schema)
        .from('secretarial_requests')
        .insert({
          request_type: 'PARENT_SIGNUP',
          status: 'PENDING',
          requested_by_uid: 'PUBLIC',
          requested_by_role: 'parent',
          child_id: null,
          instructor_id: null,
          lesson_occ_id: null,
          from_date: null,
          to_date: null,
          payload,
        })
        .select('id')
        .single();

      if (error) {
        console.error('supabase insert error', error);
        res.status(500).json({
          error: 'DB insert failed',
          message: error.message,
          details: (error as any).details,
          hint: (error as any).hint,
          code: (error as any).code,
        });
        return;
      }

      res.status(200).json({ ok: true, id: data?.id });
      return;
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e?.message || 'Unknown error' });
      return;
    }
  }
);
const SEND_EMAIL_GMAIL_URL = 'https://us-central1-bereshit-ac5d8.cloudfunctions.net/sendEmailGmail';

async function callSendEmailGmailInternal(args: {
  tenantSchema: string;
  to: string[];          // אפשר גם string, אבל נשלח array כמו notifyUser
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
}) {
  const internalSecret = envOrSecret(INTERNAL_CALL_SECRET_S, 'INTERNAL_CALL_SECRET');
  if (!internalSecret) throw new Error('Missing INTERNAL_CALL_SECRET');

  const payload = {
    tenantSchema: args.tenantSchema,
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
    replyTo: args.replyTo,
  };

  const r = await fetch(SEND_EMAIL_GMAIL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': internalSecret,
    },
    body: JSON.stringify(payload),
  });

  const json: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`sendEmailGmail failed: ${r.status} ${JSON.stringify(json)}`);
  return json;
}

function genTempPassword(len = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function requireSecretary(req: any, sb: any, tenant_id: string | null) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) throw new HttpsError('unauthenticated', 'Missing Bearer token');

  const decoded = await admin.auth().verifyIdToken(m[1]);
  const uid = decoded.uid;

  if (!tenant_id) throw new HttpsError('invalid-argument', 'Missing tenant_id');

  const { data, error } = await sb
    .from('tenant_users')
    .select('role_in_tenant,is_active')
    .eq('tenant_id', tenant_id)
    .eq('uid', uid)
    .in('role_in_tenant', ['secretary', 'admin'])
    .maybeSingle();

  if (error) throw new Error(`tenant_users lookup failed: ${error.message}`);
  if (!data?.is_active) throw new HttpsError('permission-denied', 'Forbidden');

  return decoded;
}

async function sendMail(to: string, subject: string, html: string, text?: string) {
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST_S.value(),
    port: Number(SMTP_PORT_S.value() || '587'),
    secure: false,
    auth: { user: SMTP_USER_S.value(), pass: SMTP_PASS_S.value() },
  });

  return transporter.sendMail({
    from: MAIL_FROM_S.value(),
    to,
    subject,
    text: text || undefined,
    html,
  });
}

const envOrSecret = (s: ReturnType<typeof defineSecret>, name: string) => s.value() || process.env[name];

async function callNotifyUser(args: {
  tenantSchema: string;
  userType: 'parent' | 'instructor';
  uid: string;

  subject: string;
  html: string;

  category?: string | null;
  forceEmail?: boolean;
}) {
  const internalSecret = envOrSecret(INTERNAL_CALL_SECRET_S, 'INTERNAL_CALL_SECRET');
  if (!internalSecret) throw new Error('Missing INTERNAL_CALL_SECRET');

  const url = 'https://us-central1-bereshit-ac5d8.cloudfunctions.net/notifyUser';

  const body = {
    tenantSchema: args.tenantSchema,
    userType: args.userType,
    uid: args.uid,
    category: args.category ?? null,
    subject: args.subject,
    html: args.html,
    forceEmail: args.forceEmail === true,
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // ✅ חשוב: תואם ל-notifyUser ול-sendEmailGmail (X-Internal-Secret)
      'X-Internal-Secret': internalSecret,
    },
    body: JSON.stringify(body),
  });

  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`notifyUser failed: ${r.status} ${JSON.stringify(json)}`);
  }
  return json;
}

export const approveParentSignupRequest = onRequest(
  {
    region: 'us-central1',
    secrets: [
      SUPABASE_URL_S,
      SUPABASE_KEY_S,
      SMTP_HOST_S,
      SMTP_PORT_S,
      SMTP_USER_S,
      SMTP_PASS_S,
      MAIL_FROM_S,
      INTERNAL_CALL_SECRET_S,
    ],
  },
  async (req, res) => {
    try {
      if (cors(req, res)) return;
      if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }

      const sb = createClient(SUPABASE_URL_S.value(), SUPABASE_KEY_S.value(), {
        auth: { persistSession: false },
      });

      const tenant_id = normStr(req.body?.tenant_id, 80) || null;
      const decidedBy = await requireSecretary(req, sb, tenant_id);

      const schema = normStr(req.body?.schema, 60);
      const requestId = normStr(req.body?.requestId, 80);
      if (!schema || !requestId) {
        res.status(400).json({ error: 'Missing schema/requestId' });
        return;
      }

      const { data: reqRow, error: reqErr } = await sb
        .schema(schema)
        .from('secretarial_requests')
        .select('id, status, payload')
        .eq('id', requestId)
        .single();

      if (reqErr || !reqRow) {
        res.status(404).json({ error: 'Request not found', message: reqErr?.message });
        return;
      }

      if (reqRow.status !== 'PENDING') {
        res.status(400).json({ error: 'Request is not PENDING', status: reqRow.status });
        return;
      }

      const p = reqRow.payload || {};
      const email = String(p.email || '').toLowerCase().trim();
      const first_name = normStr(p.first_name, 40);
      const last_name = normStr(p.last_name, 60);
      const phone = normStr(p.phone, 20);
      const id_number = normStr(p.id_number, 20);
      const address = normStr(p.address, 120);
      const extra_notes = p.extra_notes ?? null;
      const message_preferences = Array.isArray(p.message_preferences) && p.message_preferences.length
        ? p.message_preferences
        : ['inapp'];

      if (!email || !isEmail(email)) {
        res.status(400).json({ error: 'Invalid email in payload' });
        return;
      }

      let uid = '';
      let tempPassword = '';

      try {
        const user = await admin.auth().getUserByEmail(email);
        uid = user.uid;
        tempPassword = '';
      } catch (e: any) {
        tempPassword = genTempPassword(8);
        const created = await admin.auth().createUser({
          email,
          password: tempPassword,
          displayName: `${first_name} ${last_name}`.trim(),
        });
        uid = created.uid;
      }

      const { error: upUsersErr } = await sb
        .from('users')
        .upsert({ uid, email, role: 'parent', phone: phone || null }, { onConflict: 'uid' });
      if (upUsersErr) throw new Error(`public.users upsert failed: ${upUsersErr.message}`);

      if (tenant_id) {
        let parentRoleId: number | null = null;
        const roleRes = await sb.schema(schema).from('role').select('id').eq('table', 'parents').maybeSingle();
        parentRoleId = (roleRes.data?.id as any) ?? null;

        const { error: tuErr } = await sb
          .from('tenant_users')
          .upsert(
            { tenant_id, uid, role_in_tenant: 'parent', role_id: parentRoleId, is_active: true },
            { onConflict: 'tenant_id,uid,role_in_tenant' }
          );
        if (tuErr) throw new Error(`public.tenant_users upsert failed: ${tuErr.message}`);
      }

      const { error: parentErr } = await sb
        .schema(schema)
        .from('parents')
        .upsert(
          {
            uid,
            first_name,
            last_name,
            email,
            phone: phone || null,
            id_number: id_number || null,
            address: address || null,
            extra_notes,
            message_preferences,
            is_active: true,
          },
          { onConflict: 'uid' }
        );
      if (parentErr) throw new Error(`parents upsert failed: ${parentErr.message}`);

      const { error: updErr } = await sb
        .schema(schema)
        .from('secretarial_requests')
        .update({
          status: 'APPROVED',
          decided_by_uid: String(decidedBy.uid),
          decided_at: new Date().toISOString(),
          decision_note: null,
          payload: {
            ...p,
            approved_meta: {
              uid,
              temp_password_sent: !!tempPassword,
              approved_at: new Date().toISOString(),
            },
          },
        })
        .eq('id', requestId);
      if (updErr) throw new Error(`request update failed: ${updErr.message}`);

      const subject = 'פרטי התחברות למערכת';
      const html = tempPassword
        ? `
          <div dir="rtl" style="font-family:Arial">
            <h2>הבקשה אושרה 🎉</h2>
            <p>נוצר עבורך משתמש למערכת.</p>
            <b/>כתובת האתר<p> <b>https://smart-farm.org/login</b></p>
            <b/>פרטי התחברות:</b>
            <p><b>שם משתמש:</b> ${email}</p>
            <p><b>סיסמה זמנית:</b> ${tempPassword}</p>
            <p>לאחר התחברות מומלץ לשנות סיסמה.</p>
          </div>
        `
        : `
          <div dir="rtl" style="font-family:Arial">
            <h2>הבקשה אושרה 🎉</h2>
            <p>נמצא עבורך משתמש קיים במערכת.</p>
            <b/>כתובת האתר<p> <b>https://smart-farm.org/login</b></p>
            <b/>פרטי התחברות:</b>
            <p><b>שם משתמש:</b> ${email}</p>
            <p>התחברי עם הסיסמה הקיימת. אם שכחת – בצעי "שכחתי סיסמה".</p>
          </div>
        `;

         let emailOk = true;
      let emailError: string | null = null;
      let mail: any = null;

      try {
        mail = await callNotifyUser({
          tenantSchema: schema,
          userType: 'parent',
          uid,
          subject,
          html,
          category: 'signupApproved',
          forceEmail: true,
        });

        // אם notifyUser מחזיר ok=false בלי לזרוק
        if (mail && (mail.ok === false || mail.emailOk === false)) {
          emailOk = false;
          emailError = String(mail.message ?? mail.error ?? mail.emailError ?? 'שליחת מייל נכשלה').slice(0, 300);
        }
      } catch (err: any) {
        emailOk = false;
        emailError = String(err?.message ?? err ?? 'שליחת מייל נכשלה').slice(0, 300);
        console.warn('approveParentSignupRequest: email failed but approval OK', err);
      }

      res.status(200).json({
        ok: true,
        uid,
        tempPasswordSent: !!tempPassword,
        emailOk,
        emailError,
        mail,
      });

    } catch (e: any) {
      console.error('approveParentSignupRequest error', e);

      const code = e?.code;
      const msg = e?.message || String(e);

      if (code === 'unauthenticated') return void res.status(401).json({ error: 'unauthenticated', message: msg });
      if (code === 'permission-denied') return void res.status(403).json({ error: 'forbidden', message: msg });
      if (code === 'invalid-argument') return void res.status(400).json({ error: 'invalid_argument', message: msg });
      if (code === 'not-found') return void res.status(404).json({ error: 'not_found', message: msg });

      res.status(500).json({ error: 'Internal error', message: msg });
      return;
    }
  }
);
export const rejectParentSignupRequest = onRequest(
  {
    region: 'us-central1',
    secrets: [
      SUPABASE_URL_S,
      SUPABASE_KEY_S,
      INTERNAL_CALL_SECRET_S, // ✅ חייב כדי לקרוא ל-sendEmailGmail פנימית
    ],
  },
  async (req, res) => {
    try {
      if (cors(req, res)) return;
      if (req.method !== 'POST') {
        return void res.status(405).json({ error: 'Method not allowed' });
      }

      const sb = createClient(SUPABASE_URL_S.value(), SUPABASE_KEY_S.value(), {
        auth: { persistSession: false },
      });

      const tenant_id = normStr(req.body?.tenant_id, 80) || null;
      const decidedBy = await requireSecretary(req, sb, tenant_id);

      const schema = normStr(req.body?.schema, 60);
      const requestId = normStr(req.body?.requestId, 80);
      const decisionNote = normStr(req.body?.decisionNote, 300) || null;

      if (!schema || !requestId) {
        return void res.status(400).json({ error: 'Missing schema/requestId' });
      }

      const { data: reqRow, error: reqErr } = await sb
        .schema(schema)
        .from('secretarial_requests')
        .select('id,status,payload')
        .eq('id', requestId)
        .single();

      if (reqErr || !reqRow) {
        return void res.status(404).json({ error: 'Request not found', message: reqErr?.message });
      }

      if (reqRow.status !== 'PENDING') {
        return void res.status(400).json({ error: 'Request is not PENDING', status: reqRow.status });
      }

      const p = reqRow.payload || {};
      const email = String(p.email || '').toLowerCase().trim();
      const first_name = normStr(p.first_name, 40);
      const last_name = normStr(p.last_name, 60);

      if (!email || !isEmail(email)) {
        return void res.status(400).json({ error: 'Invalid email in payload' });
      }

      // 1) update status to REJECTED
      const { error: updErr } = await sb
        .schema(schema)
        .from('secretarial_requests')
        .update({
          status: 'REJECTED',
          decided_by_uid: String(decidedBy.uid),
          decided_at: new Date().toISOString(),
          decision_note: decisionNote,
          payload: {
            ...p,
            rejected_meta: {
              rejected_at: new Date().toISOString(),
              rejected_by_uid: String(decidedBy.uid),
              decision_note: decisionNote,
            },
          },
        })
        .eq('id', requestId);

      if (updErr) throw new Error(`request update failed: ${updErr.message}`);

      // 2) send email via sendEmailGmail (internal secret)
      const subject = 'בקשת ההצטרפות נדחתה';
      const reasonLine = decisionNote ? `<p><b>סיבה:</b> ${decisionNote}</p>` : '';

      const html = `
        <div dir="rtl" style="font-family:Arial">
          <h2>היי ${first_name || ''} ${last_name || ''},</h2>
          <p>בקשת ההצטרפות שלך למערכת נדחתה.</p>
          ${reasonLine}
          <p>אם זו טעות או שתרצי להשלים פרטים — אפשר לפנות למשרד החווה.</p>
        </div>
      `;

      let emailOk = true;
      let emailError: string | null = null;
      let mail: any = null;

      try {
        mail = await callSendEmailGmailInternal({
          tenantSchema: schema,
          to: [email],
          subject,
          html,
        });
      } catch (err: any) {
        emailOk = false;
        emailError = String(err?.message ?? err ?? 'שליחת מייל נכשלה').slice(0, 300);
        console.warn('rejectParentSignupRequest: email failed but rejection OK', err);
      }

      return void res.status(200).json({ ok: true, emailOk, emailError, mail });
    } catch (e: any) {
      const code = e?.code;
      const msg = e?.message || String(e);

      if (code === 'unauthenticated') return void res.status(401).json({ error: 'unauthenticated', message: msg });
      if (code === 'permission-denied') return void res.status(403).json({ error: 'forbidden', message: msg });
      if (code === 'invalid-argument') return void res.status(400).json({ error: 'invalid_argument', message: msg });

      console.error('rejectParentSignupRequest error', e);
      return void res.status(500).json({ error: 'Internal error', message: msg });
    }
  }
);
