import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { defineSecret } from 'firebase-functions/params';
import * as functions from 'firebase-functions/v2/https';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { logger } from 'firebase-functions';

/** ===== Secrets (Firebase only) ===== */
const SUPABASE_URL = defineSecret('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = defineSecret('SUPABASE_SERVICE_KEY');
const INTEGRATIONS_MASTER_KEY = defineSecret('INTEGRATIONS_MASTER_KEY');

/** ===== Types ===== */
type Item = {
  lesson_id: string;
  occur_date: string; // YYYY-MM-DD

  insuredId: string;
  insuredFirstName: string;
  insuredLastName: string;

  sectionCode: number;
  careCode: number;
  careDate: string;   // DDMMYYYY (8 digits)
  doctorId: number;

  clinicId?: number;
  onlineServiceType?: number;
};

type ClalitConfig = {
  username: string;
  password: string;
  supplierId: string;
  endpoint: string;
};

/** ===== Supabase ===== */
function supabaseForSchema(schema: string) {
  return createClient(SUPABASE_URL.value(), SUPABASE_SERVICE_KEY.value(), {
    db: { schema },
    auth: { persistSession: false },
  });
}

/** ===== Crypto (AES-256-GCM) ===== */
function getMasterKey(): Buffer {
  const b64 = INTEGRATIONS_MASTER_KEY.value();
  const b = Buffer.from(b64, 'base64');
  if (b.length !== 32) throw new Error('INTEGRATIONS_MASTER_KEY must be 32 bytes (base64)');
  return b;
}

function decryptSecret(iv: Buffer, tag: Buffer, data: Buffer) {
  const key = getMasterKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

// Supabase bytea לפעמים מגיע כ- base64 ולפעמים כ-hex עם prefix \x
function byteaToBuffer(v: any): Buffer {
  if (!v) throw new Error('Missing bytea value');
  if (Buffer.isBuffer(v)) return v;

  const s = String(v);

  // Postgres hex style: \xDEADBEEF
  if (s.startsWith('\\x')) return Buffer.from(s.slice(2), 'hex');

  // sometimes 0x...
  if (s.startsWith('0x')) return Buffer.from(s.slice(2), 'hex');

  // assume base64
  return Buffer.from(s, 'base64');
}

/** ===== Load CLALIT secrets from DB ===== */
async function loadClalitConfig(sb: ReturnType<typeof supabaseForSchema>): Promise<ClalitConfig> {
  const { data, error } = await sb
    .from('integration_secrets')
    .select('provider, key_name, enc_iv, enc_tag, enc_data')
    .eq('provider', 'CLALIT')
    .in('key_name', ['USERNAME', 'PASSWORD', 'SUPPLIER_ID', 'ENDPOINT']);

  if (error) throw new Error(`integration_secrets query failed: ${error.message}`);

  const rows = (data ?? []) as any[];

  const map = new Map<string, string>();
  for (const r of rows) {
    const keyName = String(r.key_name);
    const iv = byteaToBuffer(r.enc_iv);
    const tag = byteaToBuffer(r.enc_tag);
    const enc = byteaToBuffer(r.enc_data);

    const plain = decryptSecret(iv, tag, enc);
    map.set(keyName, plain);
  }

  const missing = ['USERNAME', 'PASSWORD', 'SUPPLIER_ID', 'ENDPOINT'].filter(k => !map.get(k));
  if (missing.length) {
    throw new Error(`Missing CLALIT secrets in DB: ${missing.join(', ')}`);
  }

  return {
    username: map.get('USERNAME')!,
    password: map.get('PASSWORD')!,
    supplierId: map.get('SUPPLIER_ID')!,
    endpoint: map.get('ENDPOINT')!,
  };
}

/** ===== XML helpers ===== */
function xmlEscape(s: any) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function assertItemValid(i: Item) {
  const needStr = (k: keyof Item) => {
    const v = (i as any)[k];
    if (!String(v || '').trim()) throw new Error(`Missing item.${String(k)}`);
  };
  const needNum = (k: keyof Item) => {
    const v = Number((i as any)[k]);
    if (!Number.isFinite(v) || v <= 0) throw new Error(`Invalid item.${String(k)}`);
  };

  needStr('lesson_id');
  needStr('occur_date');

  needStr('insuredId');
  needStr('insuredFirstName');
  needStr('insuredLastName');

  needNum('sectionCode');
  needNum('careCode');
  needStr('careDate');
  needNum('doctorId');

  // CareDate חייב להיות 8 ספרות לפי הסכמה
  if (!/^\d{8}$/.test(String(i.careDate))) throw new Error('Invalid item.careDate (must be DDMMYYYY 8 digits)');
}

function buildXmlInput(i: Item, cfg: ClalitConfig) {
  const clinicId = (i.clinicId ?? 0).toString();
  const online = (i.onlineServiceType ?? 0).toString();

  return `<?xml version="1.0" encoding="utf-8"?>
<XMLInput>
  <ActionCode>11</ActionCode>
  <UserName>${xmlEscape(cfg.username)}</UserName>
  <Password>${xmlEscape(cfg.password)}</Password>
  <SupplierID>${xmlEscape(cfg.supplierId)}</SupplierID>
  <ClinicID>${xmlEscape(clinicId)}</ClinicID>

  <InsuredID>${xmlEscape(i.insuredId)}</InsuredID>
  <InsuredFirstName>${xmlEscape(i.insuredFirstName)}</InsuredFirstName>
  <InsuredLastName>${xmlEscape(i.insuredLastName)}</InsuredLastName>

  <SectionCode>${xmlEscape(i.sectionCode)}</SectionCode>
  <CareCode>${xmlEscape(i.careCode)}</CareCode>
  <CareDate>${xmlEscape(i.careDate)}</CareDate>
  <DoctorID>${xmlEscape(i.doctorId)}</DoctorID>

  <OnlineServiceType>${xmlEscape(online)}</OnlineServiceType>
</XMLInput>`;
}

/** ===== SOAP ===== */
function buildSoapEnvelope(xmlInput: string) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <SendXML xmlns="http://www.comtec.co.il/">
      <XMLInput><![CDATA[${xmlInput}]]></XMLInput>
    </SendXML>
  </soap:Body>
</soap:Envelope>`;
}


const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
});

function htmlDecode(s: string) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractXmlOutputFromSoap(soapXml: string): string | null {
  // 1) חילוץ SendXMLResult עם regex (הכי יציב)
  const m = soapXml.match(/<SendXMLResult[^>]*>([\s\S]*?)<\/SendXMLResult>/i);
  if (!m) return null;

  const inner = m[1].trim();

  // 2) לפעמים זה כבר XML, לפעמים מקודד
  const decoded = inner.includes('&lt;') ? htmlDecode(inner) : inner;

  return decoded.includes('<XMLOutput') ? decoded : null;
}


function parseXmlOutput(xmlOutput: string) {
  const obj = parser.parse(xmlOutput);
  const out = obj?.XMLOutput ?? obj;
  const resultCode = Number(out?.Result ?? NaN);

  return {
    resultCode,
    claimNumber: out?.ClaimNumber ? String(out.ClaimNumber) : undefined,
    answerDetails: out?.AnswerDetails ? String(out.AnswerDetails) : undefined,
    errorDescription: out?.ErrorDescription ? String(out.ErrorDescription) : undefined,
  };
}

async function callClalitSendXml(xmlInput: string, endpoint: string) {
  const soap = buildSoapEnvelope(xmlInput);

  // קורלציה ללוגים של אותו ניסיון
  const rid = `clalit_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  // לא להדפיס סיסמאות, רק meta
  const endpointHost = (() => {
    try { return new URL(endpoint).host; } catch { return endpoint; }
  })();

  let resp;
  try {
    resp = await axios.post(endpoint, soap, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'http://www.comtec.co.il/SendXML',
        'Accept': 'text/xml',
        'User-Agent': 'Smart-Farm/1.0',
      },
      timeout: 30_000,
      responseType: 'text',
      validateStatus: () => true,
      // חשוב ל-SOAP: לא לתת ל-axios לנסות parse
      transformResponse: [(d) => d],
    });
  } catch (e: any) {
    logger.error('clalit soap request failed', {
      rid,
      endpointHost,
      message: e?.message,
      code: e?.code,
    });
    throw e;
  }

  const status = resp.status;
  const ct = String(resp.headers?.['content-type'] || '');
  const body = String(resp.data ?? '');

  const looksLikeHtml = /^\s*</.test(body) && /<html[\s>]/i.test(body);
  const isIncapsula = /Incapsula|_Incapsula_Resource|incident_id/i.test(body);

  logger.info('clalit soap response meta', {
    rid,
    endpointHost,
    status,
    contentType: ct,
    bodyLen: body.length,
    looksLikeHtml,
    isIncapsula,
  });

  // דוגמית קצרה (200 תווים) — מספיק כדי לזהות חסימה בלי להציף לוגים
  logger.debug('clalit soap response peek', {
    rid,
    peek: body.slice(0, 200),
  });

  // אם זה חסימה — שימי הודעה ברורה כבר כאן
  if (looksLikeHtml && isIncapsula) {
    logger.warn('clalit blocked by WAF/Incapsula (HTML returned instead of SOAP)', {
      rid,
      status,
      contentType: ct,
    });
  }

  return body;
}


/** ===== Cloud Function ===== */
export const openClaimsClalit = functions.onCall(
  {
    secrets: [SUPABASE_URL, SUPABASE_SERVICE_KEY, INTEGRATIONS_MASTER_KEY],
    cors: true,
  },
  async (req) => {
    try {
      const { schema, items } = (req.data ?? {}) as { schema: string; items: Item[] };

      if (!schema || !Array.isArray(items) || items.length === 0) {
        throw new functions.HttpsError('invalid-argument', 'schema/items required');
      }

      logger.info('openClaimsClalit called', { schema, itemsCount: items?.length });

      const sb = supabaseForSchema(schema);

      // אם זה נופל — היום זה הופך ל-INTERNAL בלי הסבר.
      const cfg = await loadClalitConfig(sb);

      const results: any[] = [];

      for (const it of items) {
        try {
          assertItemValid(it);

          const xmlInput = buildXmlInput(it, cfg);
          const soapResp = await callClalitSendXml(xmlInput, cfg.endpoint);

          logger.info('clalit soapResp check', {
            lesson_id: it.lesson_id,
            occur_date: it.occur_date,
            startsWith: soapResp.slice(0, 20),
            hasSendXMLResult: /<SendXMLResult/i.test(soapResp),
            hasHtml: /<html/i.test(soapResp),
          });

          const xmlOutput = extractXmlOutputFromSoap(soapResp);
          if (!xmlOutput) {
            results.push({
              lesson_id: it.lesson_id,
              occur_date: it.occur_date,
              ok: false,
              errorDescription: 'לא הצלחתי לחלץ XMLOutput מתשובת השרת',
              rawResponseXml: soapResp,
            });
            continue;
          }

          const parsed = parseXmlOutput(xmlOutput);

          const ok =
            Number.isFinite(parsed.resultCode) &&
            parsed.resultCode >= 0 &&
            (!!parsed.claimNumber || (parsed.answerDetails ?? '').includes('נקלט'));

          if (ok) {
            const { error } = await sb.rpc('open_lesson_claim_clalit', {
              p_lesson_id: it.lesson_id,
              p_occur_date: it.occur_date,
            });

            if (error) {
              results.push({
                lesson_id: it.lesson_id,
                occur_date: it.occur_date,
                ok: false,
                resultCode: parsed.resultCode,
                claimNumber: parsed.claimNumber,
                answerDetails: parsed.answerDetails,
                errorDescription: `נפתח בכללית אבל נכשל עדכון DB: ${error.message}`,
                rawResponseXml: xmlOutput,
              });
              continue;
            }
          }

          results.push({
            lesson_id: it.lesson_id,
            occur_date: it.occur_date,
            ok,
            resultCode: parsed.resultCode,
            claimNumber: parsed.claimNumber,
            answerDetails: parsed.answerDetails,
            errorDescription: ok ? undefined : (parsed.errorDescription || parsed.answerDetails || 'שגיאה לא ידועה'),
            rawResponseXml: xmlOutput,
          });
        } catch (e: any) {
          results.push({
            lesson_id: it.lesson_id,
            occur_date: it.occur_date,
            ok: false,
            errorDescription: e?.message || 'שגיאה לא ידועה',
          });
        }
      }

      return { results };
    } catch (e: any) {
      logger.error('openClaimsClalit failed', e);
      // אם זה כבר HttpsError — תזרקי כמו שהוא
      if (e?.code && typeof e.code === 'string') throw e;

      // אחרת להפוך לשגיאה קריאה ללקוח
      throw new functions.HttpsError(
        'internal',
        e?.message || 'openClaimsClalit crashed',
        { name: e?.name, message: e?.message, stack: e?.stack }
      );
    }
  }
);
