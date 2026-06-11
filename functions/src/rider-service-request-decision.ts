import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

import { SUPABASE_URL_S, SUPABASE_KEY_S } from './gmail/email-core';
import { notifyUserInternal } from './notify-user-client';
import { buildRiderServiceDecisionEmail } from './email-builders/send-rider-service-decision-email';

const INTERNAL_CALL_SECRET_S = defineSecret('INTERNAL_CALL_SECRET');

const ALLOWED_ORIGINS = new Set<string>([
    'https://smart-farm.org',
    'https://bereshit-ac5d8.web.app',
    'https://bereshit-ac5d8.firebaseapp.com',
    'http://localhost:4200',
    'https://localhost:4200',
]);

if (!admin.apps.length) admin.initializeApp();

function applyCors(req: any, res: any): boolean {
    const origin = String(req.headers.origin || '');
    if (origin && ALLOWED_ORIGINS.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    } else {
        res.setHeader('Vary', 'Origin');
    }

    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With, X-Internal-Secret');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return true;
    }

    return false;
}

function envOrSecret(s: ReturnType<typeof defineSecret>, name: string) {
    return s.value() || process.env[name];
}

function timingSafeEq(a: string, b: string) {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function isInternalCall(req: any): boolean {
    const secret = envOrSecret(INTERNAL_CALL_SECRET_S, 'INTERNAL_CALL_SECRET');
    const got = String(req.headers['x-internal-secret'] || req.headers['X-Internal-Secret'] || '');
    return !!(secret && got && timingSafeEq(got, secret));
}

async function requireAuth(req: any) {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer (.+)$/);
    if (!m) throw new Error('Missing Bearer token');
    return admin.auth().verifyIdToken(m[1]);
}

function parsePayload(p: any) {
    try {
        if (!p) return {};
        if (typeof p === 'string') return JSON.parse(p);
        return p;
    } catch {
        return {};
    }
}

function fullName(f?: string | null, l?: string | null) {
    return `${(f ?? '').trim()} ${(l ?? '').trim()}`.trim() || null;
}

function serviceModeLabel(mode: any) {
    switch (String(mode ?? '')) {
        case 'once': return 'חד־פעמי';
        case 'recurring_range': return 'מחזורי לתקופה';
        case 'permanent': return 'קבוע';
        default: return 'שירות';
    }
}

async function handleRiderServiceDecision(req: any, res: any, status: 'APPROVED' | 'REJECTED') {
    try {
        if (applyCors(req, res)) return;
        if (req.method !== 'POST') {
            return void res.status(405).json({ error: 'Method not allowed' });
        }

        let decidedByUid: string | null = null;

        if (!isInternalCall(req)) {
            const decoded = await requireAuth(req);
            decidedByUid = decoded?.uid ?? null;
        }

        const body = req.body || {};
        const tenantSchema = String(body.tenantSchema || '').trim();
        const tenantId = String(body.tenantId || '').trim();
        const decisionNote = body.decisionNote == null ? null : String(body.decisionNote).trim();
        const source = String(body.source || 'request_approval').trim();
        const requestId = String(body.requestId || '').trim();

        const isSecretaryCreated = source === 'secretary_created';

        if (!isSecretaryCreated && !requestId) {
            return void res.status(400).json({ error: 'Missing requestId' });
        }
        if (!tenantSchema) return void res.status(400).json({ error: 'Missing tenantSchema' });
        if (!tenantId) return void res.status(400).json({ error: 'Missing tenantId' });

        const url = envOrSecret(SUPABASE_URL_S, 'SUPABASE_URL')!;
        const key = envOrSecret(SUPABASE_KEY_S, 'SUPABASE_SERVICE_KEY')!;

        const sbTenant = createClient(url, key, { db: { schema: tenantSchema } });
        const sbPublic = createClient(url, key, { db: { schema: 'public' } });
        let reqRow: any = null;
        let payload: any = {};

        if (!isSecretaryCreated) {
            const { data, error: reqErr } = await sbTenant
                .from('secretarial_requests')
                .select('id,status,request_type,requested_by_uid,from_date,to_date,payload')
                .eq('id', requestId)
                .maybeSingle();

            if (reqErr) throw reqErr;
            if (!data) return void res.status(404).json({ ok: false, message: 'request not found' });

            reqRow = data;

            if (reqRow.request_type !== 'RIDER_SERVICE_REQUEST') {
                return void res.status(400).json({ ok: false, message: 'Not a RIDER_SERVICE_REQUEST' });
            }

            if (reqRow.status !== 'PENDING') {
                return void res.status(409).json({
                    ok: false,
                    message: 'הבקשה כבר לא במצב ממתין.',
                });
            }

            payload = parsePayload(reqRow.payload);

            const { data: upd, error: updErr } = await sbTenant
                .from('secretarial_requests')
                .update({
                    status,
                    decided_by_uid: decidedByUid,
                    decided_at: new Date().toISOString(),
                    decision_note: decisionNote,
                })
                .eq('id', requestId)
                .eq('status', 'PENDING')
                .select('id,status')
                .maybeSingle();

            if (updErr) throw updErr;

            if (!upd) {
                return void res.status(409).json({
                    ok: false,
                    message: 'הבקשה כבר לא במצב ממתין.',
                });
            }
        } else {
            payload = body;
        }
        if (status === 'APPROVED') {
            const serviceMode = String(payload?.service_mode ?? 'once').trim();

            const riderUid =
                String(payload?.rider_uid || reqRow?.requested_by_uid || '').trim();

            const horseUid =
                String(payload?.horse_uid || '').trim();

            const serviceTypeId =
                String(payload?.service_type_id || '').trim();

            const serviceName =
                String(
                    payload?.service_name ||
                    payload?.service_settings?.name ||
                    'שירות'
                ).trim();

            const startDate =
                String(
                    reqRow?.from_date ||
                    payload?.requested_start_date ||
                    payload?.start_date ||
                    ''
                ).slice(0, 10);

            const endDate =
                serviceMode === 'recurring_range'
                    ? String(
                        reqRow?.to_date ||
                        payload?.requested_end_date ||
                        payload?.end_date ||
                        ''
                    ).slice(0, 10)
                    : null;

            const recurrenceUnit =
                serviceMode === 'once'
                    ? null
                    : payload?.recurrence_unit ?? null;

            const recurrenceInterval =
                serviceMode === 'once'
                    ? null
                    : Number(payload?.recurrence_interval ?? 1);

            const priceAgorot =
                Number(
                    payload?.default_price_agorot ??
                    payload?.service_settings?.default_price_agorot ??
                    0
                ) || 0;

            if (!riderUid) throw new Error('Missing rider_uid');
            if (!horseUid) throw new Error('Missing horse_uid');
            if (!serviceTypeId) throw new Error('Missing service_type_id');
            if (!startDate) throw new Error('Missing start_date');
            const { data: insertedService, error: serviceInsertErr } = await sbTenant
                .from('rider_services')
                .insert({
                    rider_uid: riderUid,
                    horse_uid: horseUid,
                    service_type_id: serviceTypeId,
                    source_request_id: isSecretaryCreated ? null : requestId,
                    service_name: serviceName,
                    start_date: startDate,
                    end_date: endDate,
                    status: 'active',
                    price_agorot: priceAgorot,
                    next_billing_date: startDate,
                    last_billed_date: null,
                    notes: payload?.notes ?? null,
                    service_mode: serviceMode,
                    recurrence_unit: recurrenceUnit,
                    recurrence_interval: recurrenceInterval,
                })
                .select('id')
                .single();

            if (serviceInsertErr) throw serviceInsertErr;

            if (insertedService?.id) {

                const { error: taskGenErr } = await sbTenant.rpc(
                    'generate_rider_service_tasks_for_service',
                    {
                        p_service_id: insertedService.id,
                    }
                );

                if (taskGenErr) throw taskGenErr;
            }
        }

        const { data: farmRow } = await sbPublic
            .from('farms')
            .select('name')
            .eq('id', tenantId)
            .maybeSingle();

        const farmName = String(farmRow?.name ?? 'החווה').trim() || 'החווה';

        const riderUid =
            String(payload?.rider_uid || reqRow?.requested_by_uid || '').trim();

        let riderName =
            String(payload?.rider_name || '').trim() ||
            'רוכב/ת';

        if (riderUid && riderName === 'רוכב/ת') {
            const { data: rider } = await sbTenant
                .from('independent_riders')
                .select('first_name,last_name')
                .eq('uid', riderUid)
                .maybeSingle();

            riderName = fullName((rider as any)?.first_name, (rider as any)?.last_name) ?? riderName;
        }

        const serviceName =
            String(
                payload?.service_name ||
                payload?.service_settings?.name ||
                'שירות'
            ).trim();

        const horseName =
            payload?.horse_name == null ? null : String(payload.horse_name).trim();

        let mailOk = true;
        let warning: string | null = null;
        let mailResult: any = null;
        let mailError: any = null;

        try {
            if (riderUid) {
                const serviceMode = String(payload?.service_mode ?? '');

                const { subject, html, text } = buildRiderServiceDecisionEmail({
                    kind: isSecretaryCreated
                        ? 'created_by_secretary'
                        : status === 'APPROVED'
                            ? 'approved'
                            : 'rejected', farmName,
                    riderName,
                    horseName,
                    serviceName,
                    serviceModeLabel: serviceModeLabel(serviceMode),
                    fromDate: reqRow?.from_date ?? payload?.from_date ?? payload?.start_date ?? null,
                    toDate: serviceMode === 'permanent'
                        ? null
                        : (reqRow?.to_date ?? payload?.to_date ?? null),
                    decisionNote,
                });

                mailResult = await notifyUserInternal({
                    tenantSchema,
                    userType: 'independent',
                    uid: riderUid,
                    subject,
                    html,
                    text,
                    category: 'rider_service_request',
                    forceEmail: true,
                });
            } else {
                mailOk = false;
                warning = 'הבקשה עודכנה, אך לא נמצא uid של הרוכב ולכן לא נשלח מייל.';
            }
        } catch (e: any) {
            mailOk = false;
            warning = 'הבקשה עודכנה, אך שליחת המייל נכשלה.';
            mailError = { message: e?.message || String(e) };
        }

        return void res.status(200).json({
            ok: true,
            status,
            mailOk,
            warning,
            mailResult,
            mailError,
        });
    } catch (e: any) {
        console.error('rider service decision error', e);
        return void res.status(500).json({
            error: 'Internal error',
            message: e?.message || String(e),
        });
    }
}
export const createRiderServiceBySecretaryAndNotify = onRequest(
    {
        region: 'us-central1',
        secrets: [SUPABASE_URL_S, SUPABASE_KEY_S, INTERNAL_CALL_SECRET_S],
    },
    async (req, res) => handleRiderServiceDecision(req, res, 'APPROVED')
);
export const approveRiderServiceRequestAndNotify = onRequest(
    {
        region: 'us-central1',
        secrets: [SUPABASE_URL_S, SUPABASE_KEY_S, INTERNAL_CALL_SECRET_S],
    },
    async (req, res) => handleRiderServiceDecision(req, res, 'APPROVED')
);

export const rejectRiderServiceRequestAndNotify = onRequest(
    {
        region: 'us-central1',
        secrets: [SUPABASE_URL_S, SUPABASE_KEY_S, INTERNAL_CALL_SECRET_S],
    },
    async (req, res) => handleRiderServiceDecision(req, res, 'REJECTED')
);