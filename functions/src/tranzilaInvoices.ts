import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as crypto from "crypto";
import fetch from "node-fetch";
import nodemailer from "nodemailer";


// ===== Secrets =====
const SUPABASE_URL_S = defineSecret("SUPABASE_URL");
const SUPABASE_KEY_S = defineSecret("SUPABASE_SERVICE_KEY");
const TRANZILA_APP_KEY_S = defineSecret("TRANZILA_APP_KEY");
const TRANZILA_SECRET_S = defineSecret("TRANZILA_SECRET");


function vatPercentByDate(docDate: string) {
  return docDate >= "2025-01-01" ? 18 : 17;
}






// ===== Types =====
type BillingTerminalRow = {
  terminal_name: string;
  mode: string;
  active: boolean;
  is_default: boolean;
  provider?: string;
};

type PaymentRow = {
  id: string;
  amount: number | null; // ILS in DB (your existing field)
  date: string | null; // YYYY-MM-DD
  parent_uid: string | null;
  charge_id: string | null; // uuid or null
  tranzila_retrieval_key: string | null;
  tranzila_document_id: number | null;
  tranzila_document_number: string | null;
  payment_profile_id?: string | null; 

};
type PaymentProfileRow = {
  id: string;
  brand: string | null;
  last4: string | null;
};

type ParentRow = {
  uid: string;
  first_name: string | null;
  last_name: string | null;
  id_number: string | null;
  email: string | null;
};

type LessonBillingItemRow = {
  occur_date: string;
  child_id: string;          // uuid as string
  unit_price_agorot: number;
  quantity: number;
  amount_agorot: number;
};

type ParentCreditRow = {
  id: string;
  amount_agorot: number;
  reason: string;
  related_charge_id: string | null;
  created_at: string | null;
};

// ===== Helpers =====
async function getFarmNameBySchema(tenantSchema: string): Promise<string> {
  const sbPublic = getSupabaseForTenant("public");

  const { data, error } = await sbPublic
    .from("farms")
    .select("name")
    .eq("schema_name", tenantSchema)
    .maybeSingle();

  if (error) throw new Error(`farms query failed: ${error.message}`);
  return (data?.name as string) || "החווה";
}

function envOrSecret(s: ReturnType<typeof defineSecret>, name: string) {
  return s.value() || process.env[name];
}

function getSupabaseForTenant(schema?: string | null): SupabaseClient {
  const url = envOrSecret(SUPABASE_URL_S, "SUPABASE_URL");
  const key = envOrSecret(SUPABASE_KEY_S, "SUPABASE_SERVICE_KEY");
  if (!url || !key) throw new Error("Missing Supabase credentials");
  return createClient(url, key, { db: { schema: schema || "public" } }) as SupabaseClient;
}

function handleCors(req: any, res: any): boolean {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.status(204).send("");
    return true;
  }
  res.set("Access-Control-Allow-Origin", "*");
  return false;
}

function buildTranzilaAuth() {
  const appKey = envOrSecret(TRANZILA_APP_KEY_S, "TRANZILA_APP_KEY");
  const secret = envOrSecret(TRANZILA_SECRET_S, "TRANZILA_SECRET");
  if (!appKey || !secret) throw new Error("Missing Tranzila API keys (APP_KEY/SECRET)");

  const requestTime = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(20).toString("hex"); // 40 chars
  const key = `${secret}${requestTime}${nonce}`;
  const accessToken = crypto.createHmac("sha256", key).update(appKey).digest("hex");

  return { appKey, requestTime, nonce, accessToken };
}

async function loadDefaultBillingTerminal(sbTenant: SupabaseClient): Promise<BillingTerminalRow> {
  const { data, error } = await sbTenant
    .from("billing_terminals")
    .select("terminal_name,mode,active,is_default")
    .eq("provider", "tranzila")
    .eq("mode", "prod")
    .eq("active", true)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`billing_terminals query failed: ${error.message}`);
  if (!data?.terminal_name) throw new Error("No active billing terminal configured (terminal_name missing)");
  return data as BillingTerminalRow;
}

function safeFullName(first?: string | null, last?: string | null) {
  const s = [first, last].filter(Boolean).join(" ").trim();
  return s || "הורה";
}
function buildClientCompanyBlock(fullName: string, idNumber?: string | null) {
  const lines = [fullName];
  if (idNumber) lines.push(idNumber); // או `ת"ז: ${idNumber}` אם את רוצה שיופיע טקסט
  return lines.join("\n");
}
function monthYearFolder(yyyy_mm_dd: string) {
  const m = yyyy_mm_dd.slice(5, 7); // "04"
  const y = yyyy_mm_dd.slice(0, 4); // "2025"
  return `${m}-${y}`;               // "04-2025"
}

async function saveInvoicePdfToSupabase(params: {
  sb: SupabaseClient;
  tenantSchema: string;
  paymentId: string;
  invoiceUrl: string;   // Tranzila PDF endpoint
  paymentDate: string;  // YYYY-MM-DD (payments.date)
}) {
  const { sb, tenantSchema, paymentId, invoiceUrl, paymentDate } = params;

  // 1) download PDF from Tranzila
  const pdfResp = await fetch(invoiceUrl);
  if (!pdfResp.ok) throw new Error(`failed to fetch invoice pdf: HTTP ${pdfResp.status}`);

  const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());

  // 2) build path לפי חודש-שנה של תאריך תשלום
  const bucket = "payments-invoices";
  const monthYear = monthYearFolder(paymentDate);
  const path = `${tenantSchema}/invoices/${monthYear}/${paymentId}.pdf`;

  // 3) upload to Supabase Storage
  const { error: uploadErr } = await sb.storage
    .from(bucket)
    .upload(path, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true, // אם מפיקים שוב – ידרוס ולא ייכשל
    });

  if (uploadErr) throw new Error(`supabase storage upload failed: ${uploadErr.message}`);

  return { bucket, path };
}
const mailTransport = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: "ayelethury@gmail.com",
    pass: "jlmb ezch pkrs ifce",
  },
});
async function sendInvoiceEmail(params: {
  sb: SupabaseClient;
  bucket: string;
  path: string;
  to: string;
  parentName: string;
  farmName: string;
  documentNumber?: string | null;
}) {
const { sb, bucket, path, to, parentName, farmName, documentNumber } = params;

  // 1) הורדת ה-PDF מה-Storage
  const { data, error } = await sb.storage.from(bucket).download(path);
  if (error) throw new Error(`Failed to download invoice PDF: ${error.message}`);
  if (!data) throw new Error("Invoice PDF is empty");

  const buffer = Buffer.from(await data.arrayBuffer());

  // 2) שליחת מייל
  await mailTransport.sendMail({
    from: `<ayelethury@gmail.com>`,
    to,
    subject: `חשבונית ${documentNumber ?? ""}`.trim(),
    html: `
      <div dir="rtl" style="font-family: Arial, sans-serif">
        <p>שלום ${parentName},</p>
        <p>מצורפת החשבונית עבור התשלום שבוצע.</p>
    <p>תודה,<br/>חוות ${farmName}</p>
      </div>
    `,
    attachments: [
      {
        filename: `invoice-${documentNumber ?? "payment"}.pdf`,
        content: buffer,
        contentType: "application/pdf",
      },
    ],
  });
}
export const ensureTranzilaInvoiceForPayment = onRequest(
  {
    invoker: "public",
    secrets: [SUPABASE_URL_S, SUPABASE_KEY_S, TRANZILA_APP_KEY_S, TRANZILA_SECRET_S],
  },
  async (req, res) => {
    try {
      if (handleCors(req, res)) return;
      if (req.method !== "POST") { res.status(405).send("Method Not Allowed"); return; }

      const { tenantSchema, paymentId } = req.body as any;
      if (!tenantSchema || !paymentId) {
        res.status(400).json({ ok: false, error: "missing tenantSchema/paymentId" });
        return;
      }

      const out = await ensureTranzilaInvoiceForPaymentInternal({ tenantSchema, paymentId });
      res.json(out);
    } catch (e: any) {
      console.error("[ensureTranzilaInvoiceForPayment] error:", e);
      res.status(500).json({ ok: false, error: e?.message ?? "internal error" });
    }
  }
);



export async function ensureTranzilaInvoiceForPaymentInternal(args: {
  tenantSchema: string;
  paymentId: string;
  extraLineText?: string | null; // ✅ חדש

}): Promise<{
  ok: boolean;
  from_cache: boolean;
  document_id: string | number | null;
  document_number: string | null;
  retrieval_key: string;
  tranzila_pdf_url: string;
  public_invoice_url: string | null;
}> {
  const { tenantSchema, paymentId } = args;
const extra = (args.extraLineText ?? '').trim();

  const sb = getSupabaseForTenant(tenantSchema);
  const rid = crypto.randomBytes(6).toString("hex");

  // ===== 1) Load payment =====
  const { data: pay, error: pErr } = await sb
    .from("payments")
    .select("id, amount, date, parent_uid, charge_id, tranzila_retrieval_key, tranzila_document_id, tranzila_document_number , invoice_status, payment_profile_id, invoice_url, invoice_storage_bucket, invoice_storage_path")
    .eq("id", paymentId)
    .maybeSingle();

  if (pErr) throw new Error(`payments select failed: ${pErr.message}`);
  if (!pay) throw new Error("payment not found");

  const payment = pay as PaymentRow;

  // Cache hit
  if (payment.tranzila_retrieval_key) {
    const url = `https://my.tranzila.com/api/get_financial_document/${payment.tranzila_retrieval_key}`;
    return {
      ok: true,
      from_cache: true,
      document_id: payment.tranzila_document_id ?? null,
      document_number: payment.tranzila_document_number ?? null,
      retrieval_key: payment.tranzila_retrieval_key,
      tranzila_pdf_url: url,
      public_invoice_url: (payment as any).invoice_url ?? null,
    };
  }

  // מניעת כפילויות
  if ((payment as any).invoice_status === "generating") {
    throw new Error("invoice is generating, try again in a moment");
  }

  const { data: lockRow, error: lockErr } = await sb
    .from("payments")
    .update({ invoice_status: "generating", invoice_updated_at: new Date().toISOString() })
    .eq("id", paymentId)
    .is("tranzila_retrieval_key", null)
    .select("id")
    .maybeSingle();

  if (lockErr) throw new Error(`lock update failed: ${lockErr.message}`);
  if (!lockRow) {
    const { data: pay2 } = await sb
      .from("payments")
      .select("tranzila_retrieval_key, tranzila_document_id, tranzila_document_number, invoice_url")
      .eq("id", paymentId)
      .maybeSingle();

    if (pay2?.tranzila_retrieval_key) {
      const url = `https://my.tranzila.com/api/get_financial_document/${pay2.tranzila_retrieval_key}`;
      return {
        ok: true,
        from_cache: true,
        document_id: pay2.tranzila_document_id ?? null,
        document_number: pay2.tranzila_document_number ?? null,
        retrieval_key: pay2.tranzila_retrieval_key,
        tranzila_pdf_url: url,
        public_invoice_url: (pay2 as any).invoice_url ?? null,
      };
    }

    throw new Error("invoice request already in progress");
  }

  if (!payment.charge_id) {
    await sb.from("payments").update({
      invoice_status: "failed",
      invoice_updated_at: new Date().toISOString(),
    }).eq("id", paymentId);
    throw new Error("payment has no charge_id - cannot build invoice details");
  }

  // ===== payment_profile -> last4 =====
  let ccLast4: string | undefined;
  if (payment.payment_profile_id) {
    const { data: prof, error: profErr } = await sb
      .from("payment_profiles")
      .select("id, brand, last4")
      .eq("id", payment.payment_profile_id)
      .maybeSingle();
    if (profErr) throw new Error(`payment_profiles query failed: ${profErr.message}`);
    ccLast4 = (prof?.last4 ?? "").trim().slice(-4) || undefined;
  }

  // ===== 2) Load parent =====
  let parentFullName = "הורה";
  let parentIdNumber: string | null = null;
  let parentEmail: string | null = null;

  if (payment.parent_uid) {
    const { data: parent, error: parentErr } = await sb
      .from("parents")
      .select("uid, first_name, last_name, id_number, email")
      .eq("uid", payment.parent_uid)
      .maybeSingle();
    if (parentErr) throw new Error(`parents query failed: ${parentErr.message}`);

    const pr = parent as ParentRow | null;
    parentFullName = safeFullName(pr?.first_name, pr?.last_name);
    parentIdNumber = pr?.id_number ?? null;
    parentEmail = pr?.email ?? null;
  }

  // ===== 3) lesson items =====
  const { data: lbiRows, error: lbiErr } = await sb
    .from("lesson_billing_items")
    .select("occur_date, child_id, unit_price_agorot, quantity, amount_agorot")
    .eq("charge_id", payment.charge_id)
    .order("occur_date", { ascending: true });

  if (lbiErr) throw new Error(`lesson_billing_items query failed: ${lbiErr.message}`);
  const lessons = (lbiRows ?? []) as LessonBillingItemRow[];

  if (!lessons.length) {
    await sb.from("payments").update({
      invoice_status: "failed",
      invoice_updated_at: new Date().toISOString(),
    }).eq("id", paymentId);
    throw new Error("no lesson_billing_items found for this charge_id");
  }

  // children names
  const childIds = Array.from(new Set(lessons.map((r) => r.child_id).filter(Boolean)));
  const childNameById = new Map<string, string>();

  if (childIds.length) {
    const { data: childRows, error: chErr } = await sb
      .from("children")
      .select("child_uuid, first_name, last_name, gov_id")
      .in("child_uuid", childIds);

    if (chErr) throw new Error(`children query failed: ${chErr.message}`);

    for (const c of childRows ?? []) {
      const full = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
      const govId = (c.gov_id ?? "").trim();
      const label = govId ? `${full} (${govId})` : full;
      childNameById.set(c.child_uuid, label || "ילד/ה");
    }
  }

  // credits
  const { data: creditRows, error: cErr } = await sb
    .from("parent_credits")
    .select("id, amount_agorot, reason, related_charge_id, created_at")
    .eq("related_charge_id", payment.charge_id);

  if (cErr) throw new Error(`parent_credits query failed: ${cErr.message}`);
  const credits = (creditRows ?? []) as ParentCreditRow[];

  const lessonItems = lessons.map((r) => {
    const lineILS = Number((Number(r.amount_agorot) / 100).toFixed(2));
    const childName = childNameById.get(r.child_id) ?? "ילד/ה";
    return { name: `שיעור - ${childName} - ${r.occur_date}`, unit_price: lineILS, units_number: 1, unit_type: 1, currency_code: "ILS" };
  });

  const creditItems = credits.map((c) => {
    const lineILS = Number((-Math.abs(Number(c.amount_agorot)) / 100).toFixed(2));
    return { name: `זיכוי: ${c.reason}`, unit_price: lineILS, units_number: 1, unit_type: 1, currency_code: "ILS" };
  });

  const items = [...lessonItems, ...creditItems];
if (extra) {
  items.push({
    name: extra.slice(0, 60),
    unit_price: 0,
    units_number: 1,
    unit_type: 1,
    currency_code: "ILS",
  });
}

  const lessonsAg = lessons.reduce((s, r) => s + Number(r.amount_agorot || 0), 0);
  const creditsAg = credits.reduce((s, c) => s + Math.abs(Number(c.amount_agorot || 0)), 0);
  const netAg = lessonsAg - creditsAg;
  const netILS = Number((netAg / 100).toFixed(2));

  if (!Number.isFinite(netILS) || netILS <= 0) throw new Error("invalid net amount");

  // ===== 4) terminal =====
  const terminal = await loadDefaultBillingTerminal(sb);

  // ===== 5) Tranzila create_document =====
  const auth = buildTranzilaAuth();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-tranzila-api-app-key": auth.appKey,
    "X-tranzila-api-request-time": auth.requestTime,
    "X-tranzila-api-nonce": auth.nonce,
    "X-tranzila-api-access-token": auth.accessToken,
  };

  const documentDate = new Date().toISOString().slice(0, 10);
  const paymentDate = payment.date ?? documentDate;
  const vatPercent = vatPercentByDate(documentDate);

  const payload: any = {
    terminal_name: terminal.terminal_name,
    document_date: documentDate,
    document_type: "IR",
    document_language: "heb",
    document_currency_code: "ILS",
    action: 1,
    vat_percent: vatPercent,
    client_company: buildClientCompanyBlock(parentFullName, parentIdNumber),
    client_email: parentEmail ?? undefined,
    items,
    payments: [
      {
        payment_method: 1,
        payment_date: paymentDate,
        amount: netILS,
        currency_code: "ILS",
        cc_last_4_digits: ccLast4 || undefined,
        cc_credit_term: 1,
      },
    ],
    response_language: "eng",
  };

  const resp = await fetch("https://billing5.tranzila.com/api/documents_db/create_document", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const rawText = await resp.text();
  let json: any = null;
  try { json = JSON.parse(rawText); } catch {}

  if (!resp.ok || !json || String(json.status_code) !== "0") {
    await sb.from("payments").update({
      invoice_status: "failed",
      invoice_updated_at: new Date().toISOString(),
    }).eq("id", paymentId);

    throw new Error(`tranzila create_document failed: ${json?.status_msg ?? rawText}`);
  }

  const documentId = json?.document?.id ?? null;
  const documentNumber = json?.document?.number ?? null;

  const retrievalKey =
    json?.retrieval_key ??
    json?.document?.retrieval_key ??
    json?.retrievalKey ??
    null;

  if (!retrievalKey) throw new Error("missing retrieval_key from tranzila");

  const tranzilaPdfUrl = `https://my.tranzila.com/api/get_financial_document/${retrievalKey}`;

  // ===== Save PDF to storage =====
  const stored = await saveInvoicePdfToSupabase({
    sb,
    tenantSchema,
    paymentId,
    invoiceUrl: tranzilaPdfUrl,
    paymentDate,
  });

  // ===== public url =====
  const { data: pub } = sb.storage.from(stored.bucket).getPublicUrl(stored.path);
  const publicInvoiceUrl = (pub as any).publicUrl + "?v=" + Date.now();

  // ===== update payments =====
  const { error: uErr } = await sb
    .from("payments")
    .update({
      invoice_url: publicInvoiceUrl,
      invoice_status: "ready",
      invoice_updated_at: new Date().toISOString(),
      tranzila_document_id: documentId,
      tranzila_document_number: documentNumber,
      tranzila_retrieval_key: retrievalKey,
      tranzila_invoice_url: tranzilaPdfUrl,
      invoice_storage_bucket: stored.bucket,
      invoice_storage_path: stored.path,
    })
    .eq("id", paymentId);

  if (uErr) throw new Error(`payments update failed: ${uErr.message}`);

  // ===== send email =====
  try {
    if (parentEmail) {
      const farmName = await getFarmNameBySchema(tenantSchema);
      await sendInvoiceEmail({
        sb,
        bucket: stored.bucket,
        path: stored.path,
        to: parentEmail,
        parentName: parentFullName,
        farmName,
        documentNumber,
      });
    }
  } catch (err: any) {
    console.error(`[ensureInvoiceInternal][${rid}] mail failed`, err?.message || err);
  }

  return {
    ok: true,
    from_cache: false,
    document_id: documentId,
    document_number: documentNumber ? String(documentNumber) : null,
    retrieval_key: String(retrievalKey),
    tranzila_pdf_url: tranzilaPdfUrl,
    public_invoice_url: publicInvoiceUrl,
  };
}
