import { createHash } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = defineSecret('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = defineSecret('SUPABASE_SERVICE_KEY');
const MAX_PDF_BYTES = 5_000_000;
const MAX_LESSONS = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type SelectedLesson = { lesson_id: string; occur_date: string; child_id: string };
type InvoiceRef = { child_id: string; charged_at: string; payment_id: string; charge_id: string; bucket: string; path: string };
type RequestBody = { schema: string; lessons: SelectedLesson[] };
type BillingItem = { child_id: string; occur_date: string; charge_id: string | null };
type StoredInvoice = { child_id: string; charge_id: string; payment_id: string | null;
  invoice_storage_bucket: string | null; invoice_storage_path: string | null; status: string };
type PaymentRow = { id: string; charge_id: string | null; date: string | null };

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

function keyOf(x: SelectedLesson): string {
  return `${x.lesson_id}__${x.occur_date}__${x.child_id}`;
}

function normalizeId(value: unknown): string {
  return String(value ?? '').trim();
}

function isReportable(row: any, occurrence: any): boolean {
  const attendance = String(row.attendance_status ?? '').toLowerCase();
  const cancelled = Boolean(occurrence?.is_cancellation) || occurrence?.status === 'בוטל';
  const parentCancellation = cancelled && occurrence?.is_billable === true &&
    (occurrence?.canceller_role === 'parent' || occurrence?.canceller_role == null);
  return Boolean(row.chargeable) && !row.claim_submitted &&
    row.claim_status !== 'APPROVED' && row.claim_status !== 'PENDING' &&
    (!cancelled || parentCancellation) &&
    (attendance === 'present' || (attendance === 'absent' && !cancelled) || parentCancellation);
}

async function verifiedInvoice(db: any, invoice: InvoiceRef): Promise<void> {
  const { data, error } = await db.storage.from(invoice.bucket).download(invoice.path);
  if (error || !data) fail(400, 'Invoice PDF not found in Storage');
  if (data.size > MAX_PDF_BYTES || data.size === 0) {
    fail(400, 'Invoice exceeds 5,000KB or is empty');
  }
  const signature = Buffer.from(await data.slice(0, 5).arrayBuffer()).toString('ascii');
  if (signature !== '%PDF-') fail(400, 'Stored invoice is not a PDF');
}

// Match the billed occurrence to its charge, then to the child-specific invoice.
// Payment month can differ from lesson month, so never infer the invoice from
// the selected lesson's month or a guessed Storage path.
async function resolveInvoices(db: any, schema: string,
  selections: SelectedLesson[]): Promise<Map<string, InvoiceRef>> {
  const children = [...new Set(selections.map(x => x.child_id))];
  const dates = [...new Set(selections.map(x => x.occur_date))].sort();
  const { data: items, error: billingError } = await db.from('lesson_billing_items')
    .select('child_id,occur_date,charge_id').in('child_id', children)
    .in('occur_date', dates);
  if (billingError) throw billingError;

  const requested = new Set(selections.map(x => `${x.child_id}__${x.occur_date}`));
  const chargesByLesson = new Map<string, Set<string>>();
  for (const item of (items ?? []) as BillingItem[]) {
    const key = `${item.child_id}__${item.occur_date}`;
    if (!requested.has(key) || !item.charge_id) continue;
    if (!chargesByLesson.has(key)) chargesByLesson.set(key, new Set());
    chargesByLesson.get(key)!.add(String(item.charge_id));
  }
  for (const key of requested) {
    if (chargesByLesson.get(key)?.size !== 1) {
      fail(400, `Expected one billing charge for the selected child/date: ${key}`);
    }
  }

  const chargeIds = [...new Set([...chargesByLesson.values()].flatMap(x => [...x]))];
  const { data: invoices, error: invoiceError } = await db.from('payment_invoices')
    .select('child_id,charge_id,payment_id,invoice_storage_bucket,invoice_storage_path,status')
    .in('charge_id', chargeIds).in('child_id', children).eq('status', 'ready');
  if (invoiceError) throw invoiceError;
  const invoiceRows = (invoices ?? []) as StoredInvoice[];
  const paymentIds = [...new Set(invoiceRows.filter(x => x.payment_id).map(x => String(x.payment_id)))];
  if (!paymentIds.length) fail(400, 'No ready PDF invoice was found for the selected lessons');
  const { data: payments, error: paymentError } = await db.from('payments')
    .select('id,charge_id,date').in('id', paymentIds);
  if (paymentError) throw paymentError;
  const paymentById = new Map(((payments ?? []) as PaymentRow[]).map(x => [String(x.id), x] as const));
  const byChildCharge = new Map<string, InvoiceRef[]>();
  for (const invoice of invoiceRows) {
    const payment = paymentById.get(String(invoice.payment_id));
    const chargedAt = String(payment?.date ?? '').slice(0, 10);
    if (!DATE.test(chargedAt) || String(payment?.charge_id) !== String(invoice.charge_id)) {
      fail(400, 'Invoice payment record does not match its billing charge');
    }
    const monthYear = `${chargedAt.slice(5, 7)}-${chargedAt.slice(0, 4)}`;
    const expectedPath = `${schema}/invoices/${monthYear}/${invoice.payment_id}/${invoice.child_id}.pdf`;
    if (invoice.invoice_storage_bucket !== 'payments-invoices' ||
        invoice.invoice_storage_path !== expectedPath) {
      fail(400, 'Invoice Storage path does not match its payment and child');
    }
    const key = `${invoice.child_id}__${invoice.charge_id}`;
    const ref: InvoiceRef = {
      child_id: String(invoice.child_id), charge_id: String(invoice.charge_id),
      payment_id: String(invoice.payment_id), charged_at: chargedAt,
      bucket: invoice.invoice_storage_bucket, path: invoice.invoice_storage_path,
    };
    if (!byChildCharge.has(key)) byChildCharge.set(key, []);
    byChildCharge.get(key)!.push(ref);
  }
  const resolved = new Map<string, InvoiceRef>();
  for (const key of requested) {
    const [childId] = key.split('__');
    const chargeId = [...chargesByLesson.get(key)!][0];
    const matches = byChildCharge.get(`${childId}__${chargeId}`) ?? [];
    if (matches.length !== 1) {
      fail(400, `Expected one ready invoice for the selected child/date: ${key}`);
    }
    resolved.set(key, matches[0]);
  }
  for (const invoice of new Map([...resolved.values()].map(x => [x.path, x])).values()) {
    await verifiedInvoice(db, invoice);
  }
  return resolved;
}

if (!getApps().length) initializeApp();

export const createClalitAutomationJob = onRequest({
  region: 'us-central1', timeoutSeconds: 120, memory: '512MiB',
  cors: false, secrets: [SUPABASE_URL, SUPABASE_SERVICE_KEY],
}, async (req, res) => {
  try {
    if (req.method !== 'POST') fail(405, 'Method not allowed');
    const token = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1];
    if (!token) fail(401, 'Firebase authentication required');
    const user = await getAuth().verifyIdToken(token);
    const body = req.body as RequestBody;
    if (!body?.schema || !/^[a-z][a-z0-9_]{1,62}$/.test(body.schema)) {
      fail(400, 'Invalid farm schema');
    }
    // loginBootstrap stores authorization in public.tenant_users, not Firebase claims.
    const publicDb = createClient(SUPABASE_URL.value(), SUPABASE_SERVICE_KEY.value(), {
      db: { schema: 'public' }, auth: { persistSession: false },
    });
    const { data: memberships, error: membershipError } = await publicDb
      .from('tenant_users').select('tenant_id,role_in_tenant')
      .eq('uid', user.uid).eq('is_active', true);
    if (membershipError) throw membershipError;
    const allowedTenantIds = [...new Set((memberships ?? [])
      .filter((membership: any) => ['secretary', 'manager', 'admin']
        .includes(String(membership.role_in_tenant ?? '').toLowerCase()))
      .map((membership: any) => String(membership.tenant_id)))];
    if (!allowedTenantIds.length) fail(403, 'Not authorized for this farm');
    const { data: farms, error: farmError } = await publicDb
      .from('farms').select('id,schema_name')
      .in('id', allowedTenantIds).eq('schema_name', body.schema);
    if (farmError) throw farmError;
    if (!farms?.length) fail(403, 'Not authorized for this farm');
    if (!Array.isArray(body.lessons) || !body.lessons.length ||
        body.lessons.length > MAX_LESSONS) {
      fail(400, 'Select 1–100 lessons');
    }
    const selections = body.lessons.map((x) => ({
      lesson_id: normalizeId(x.lesson_id), occur_date: normalizeId(x.occur_date),
      child_id: normalizeId(x.child_id),
    }));
    if (selections.some((x) => !UUID.test(x.lesson_id) || !UUID.test(x.child_id) ||
        !DATE.test(x.occur_date)) || new Set(selections.map(keyOf)).size !== selections.length) {
      fail(400, 'Invalid or duplicate lesson selection');
    }

    const db = createClient(SUPABASE_URL.value(), SUPABASE_SERVICE_KEY.value(), {
      db: { schema: body.schema }, auth: { persistSession: false },
    });
    const childIds = [...new Set(selections.map((x) => x.child_id))];
    const dates = [...new Set(selections.map((x) => x.occur_date))];
    const lessonIds = [...new Set(selections.map((x) => x.lesson_id))];

    const lastDate = dates.slice().sort()[dates.length - 1];
    const [view, children, occurrences, workingDays, mappings] = await Promise.all([
      db.from('claims_lessons_clalit_v').select('*').in('lesson_id', lessonIds)
        .gte('occur_date', dates.slice().sort()[0]).lte('occur_date', lastDate),
      db.from('children').select('child_uuid,first_name,last_name,gov_id').in('child_uuid', childIds),
      db.from('lessons_occurrences')
        .select('*')
        .in('lesson_id', lessonIds).gte('occur_date', dates.slice().sort()[0])
        .lte('occur_date', lastDate),
      db.from('claims_lessons_clalit_v')
        .select('occur_date,instructor_id,attendance_status')
        .in('occur_date', dates),
      db.from('hmo_instructor_name_map')
        .select('instructor_id,provider_name,provider_code,is_active')
        .eq('provider', 'CLALIT').eq('is_active', true),
    ]);
    for (const result of [view, children, occurrences, workingDays, mappings]) {
      if (result.error) throw result.error;
    }
    const rows = new Map((view.data ?? []).map((x: any) =>
      [keyOf(x), x]));
    const occurrenceMap = new Map((occurrences.data ?? []).map((x: any) =>
      [keyOf(x), x]));
    const childMap = new Map((children.data ?? []).map((x: any) =>
      [String(x.child_uuid), x]));
    const teacherMap = new Map((mappings.data ?? []).map((x: any) =>
      [String(x.instructor_id), x]));
    const invoiceMap = await resolveInvoices(db, body.schema, selections);

    const tasks = selections.map((selection) => {
      const key = keyOf(selection);
      const row: any = rows.get(key);
      const occurrence: any = occurrenceMap.get(key);
      const child: any = childMap.get(selection.child_id);
      if (!row || !occurrence || !child || !child.gov_id ||
          !isReportable(row, occurrence)) {
        fail(400, `Lesson is missing, already reported, or not eligible: ${key}`);
      }
      const actualInstructorId = String(row.instructor_id ?? '');
      // If no matching site name exists, choose a mapped instructor working
      // on the same date. The real instructor remains in the audit payload.
      const alternative = (workingDays.data ?? []).find((x: any) =>
        x.occur_date === selection.occur_date &&
        String(x.attendance_status ?? '').toLowerCase() === 'present' &&
        teacherMap.has(String(x.instructor_id)));
      const reportedInstructorId = teacherMap.has(actualInstructorId)
        ? actualInstructorId : String(alternative?.instructor_id ?? '');
      if (!teacherMap.has(reportedInstructorId)) {
        fail(400, `No mapped Clalit instructor worked on ${selection.occur_date}`);
      }
      return {
        ...selection, child_id_number: String(child.gov_id),
        child_first_name: String(child.first_name ?? ''),
        child_last_name: String(child.last_name ?? ''),
        actual_instructor_id: actualInstructorId,
        reported_instructor_id: reportedInstructorId,
        reported_instructor_name: (teacherMap.get(reportedInstructorId) as any).provider_name,
        reported_instructor_code: (teacherMap.get(reportedInstructorId) as any).provider_code,
        invoice: invoiceMap.get(`${selection.child_id}__${selection.occur_date}`),
        claim_number: null, claim_phase: 'not_started', payment_phase: 'not_started',
      };
    });

    const requestKey = createHash('sha256').update(JSON.stringify({
      schema: body.schema, lessons: selections.slice().sort((a, b) => keyOf(a).localeCompare(keyOf(b))),
    })).digest('hex');
    const payload = {
      version: 1, workflow: ['open_all_claims', 'submit_all_payment_requests'],
      lessons: tasks, created_by_uid: user.uid,
    };
    const { data: job, error } = await db.from('automation_jobs').insert({
      provider: 'CLALIT', status: 'pending', request_key: requestKey, payload,
    }).select('id').single();
    if (error) {
      if (error.code === '23505') fail(409, 'This exact batch already has a job');
      throw error;
    }
    res.status(201).json({ ok: true, jobId: job.id, lessonCount: tasks.length });
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error('createClalitAutomationJob:', error);
    res.status(status).json({ ok: false, message: status >= 500 ? 'Could not create Clalit job' : error.message });
  }
});
