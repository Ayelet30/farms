import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import jwt from "jsonwebtoken";
import * as logger from "firebase-functions/logger";
import { randomUUID } from "node:crypto";

// init once
if (getApps().length === 0) {
  initializeApp();
}

// helpers
function sendJson(
  res: any,
  status: number,
  body: Record<string, unknown> = {},
  extra?: Record<string, unknown>
): void {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).send(JSON.stringify({ ...body, ...(extra ?? {}) }));
}

function tokenPreview(t: string): string {
  if (!t) return "empty";
  return `${t.split(".").length}-parts len=${t.length}`;
}

// helper: קריאת PostgREST של Supabase + לוגים
async function sbFetch<T>(
  url: string,
  serviceKey: string,
  ctx?: { reqId?: string; label?: string }
): Promise<{ ok: boolean; status: number; text: string; json?: T }> {
  const t0 = Date.now();
  const r = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
    },
  });

  const t1 = Date.now();
  const text = await r.text();
  let json: T | undefined = undefined;
  try { json = JSON.parse(text) as T; } catch {}

  logger.debug("sbFetch result", {
    reqId: ctx?.reqId,
    label: ctx?.label,
    ok: r.ok,
    status: r.status,
    duration_ms: t1 - t0,
    textPreview: r.ok ? undefined : text.slice(0, 500),
    url,
  });

  return { ok: r.ok, status: r.status, text, json };
}

// secrets
const SUPABASE_URL = defineSecret("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = defineSecret("SUPABASE_SERVICE_KEY");
const SUPABASE_JWT_SECRET = defineSecret("SUPABASE_JWT_SECRET");

export const loginBootstrap = onRequest(
  { region: "europe-west1", cors: true, secrets: [SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_JWT_SECRET] },
  async (req, res): Promise<void> => {
    const reqId = (req.headers["x-request-id"] as string) || randomUUID();
    res.setHeader("x-request-id", reqId);

    logger.info("loginBootstrap start", {
      reqId,
      method: req.method,
      path: (req as any).path || req.url,
      origin: req.headers.origin,
      hasAuthHeader: Boolean(req.headers.authorization),
    });

    try {
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
        logger.debug("CORS preflight", { reqId });
        res.status(204).send("");
        return;
      }

      if (req.method !== "GET") {
        logger.warn("Method not allowed", { reqId, method: req.method });
        sendJson(res, 405, { error: "Method not allowed" }, { reqId, stage: "method_check" });
        return;
      }

      // סודות (trim) + הסרת סלאש סופי מה-URL
      const rawUrl = (SUPABASE_URL.value() ?? process.env.SUPABASE_URL ?? "").trim();
      const serviceKey = (SUPABASE_SERVICE_KEY.value() ?? process.env.SUPABASE_SERVICE_KEY ?? "").trim();
      const jwtSecret = (SUPABASE_JWT_SECRET.value() ?? process.env.SUPABASE_JWT_SECRET ?? "").trim();
      const url = rawUrl.replace(/\/+$/, ""); // למניעת // כפול

      logger.debug("secrets presence", {
        reqId,
        hasUrl: Boolean(url),
        hasServiceKey: Boolean(serviceKey),
        hasJwtSecret: Boolean(jwtSecret),
      });

      const missing: string[] = [];
      if (!url) missing.push("SUPABASE_URL");
      if (!serviceKey) missing.push("SUPABASE_SERVICE_KEY");
      if (!jwtSecret) missing.push("SUPABASE_JWT_SECRET");
      if (missing.length) {
        logger.error("Supabase config missing", { reqId, missing });
        return sendJson(res, 500, { error: "Supabase config missing", missing }, { reqId, stage: "secrets" });
      }

      // אימות Firebase ID token
      const authHeader = req.headers.authorization || "";
      const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      logger.debug("auth header parsed", { reqId, token: tokenPreview(idToken) });

      if (!idToken) {
        logger.warn("Missing Firebase ID token", { reqId });
        return sendJson(res, 401, { error: "Missing Firebase ID token" }, { reqId, stage: "auth_header" });
      }

      const decoded = await verifyIdTokenOr401(idToken, reqId);
      const uid = decoded.uid;
      logger.info("Firebase token verified", {
        reqId,
        uid,
        aud: (decoded as any).aud,
        iss: (decoded as any).iss,
        sign_in_provider: (decoded as any).firebase?.sign_in_provider,
        auth_time: (decoded as any).auth_time,
        exp: (decoded as any).exp,
      });

      // tenant_users
      const q1 = `${url}/rest/v1/tenant_users?uid=eq.${encodeURIComponent(uid)}&is_active=eq.true&select=tenant_id,role_in_tenant`;
      const r1 = await sbFetch<Array<{ tenant_id: string; role_in_tenant: string }>>(q1, serviceKey, { reqId, label: "tenant_users" });

      if (!r1.ok || !Array.isArray(r1.json)) {
        logger.error("tenant_users query failed", { reqId, status: r1.status, stage: "tenant_users", preview: r1.text.slice(0, 300) });
        return sendJson(res, r1.status, { error: "tenant_users query failed", stage: "tenant_users", details: r1.text.slice(0, 500) }, { reqId });
      }

      const memberships = r1.json;
      logger.debug("tenant memberships", { reqId, count: memberships.length });

      if (memberships.length === 0) {
        logger.warn("no active membership", { reqId, uid });
        return sendJson(res, 403, { error: "User has no active farm membership", stage: "no_membership" }, { reqId });
      }

      const { tenant_id: farmId, role_in_tenant } = memberships[0];
      logger.debug("selected membership", { reqId, farmId, role_in_tenant });

      // farms
      const q2 = `${url}/rest/v1/farms?select=id,name,schema_name&id=eq.${encodeURIComponent(farmId)}`;
      const r2 = await sbFetch<Array<{ id: string; name: string; schema_name: string }>>(q2, serviceKey, { reqId, label: "farms_select" });

      if (!r2.ok || !Array.isArray(r2.json)) {
        logger.error("Farm lookup failed", { reqId, status: r2.status, stage: "farms_select", preview: r2.text.slice(0, 300) });
        return sendJson(res, r2.status, { error: "Farm lookup failed", stage: "farms_select", details: r2.text.slice(0, 500) }, { reqId });
      }

      const farm = r2.json[0];
      if (!farm) {
        logger.warn("farm not found", { reqId, farmId });
        return sendJson(res, 404, { error: "Farm not found", stage: "farm_missing" }, { reqId });
      }

      // JWT ל-Supabase
      const access_token = jwt.sign(
        { role: "authenticated", sub: uid, user_metadata: { tenant_id: farmId } },
        jwtSecret,
        { expiresIn: "15m" }
      );

      logger.info("loginBootstrap ok", { reqId, uid, farmId, role_in_tenant });
      sendJson(res, 200, { access_token, farm, role_in_tenant }, { reqId, stage: "done" });

    } catch (e: any) {
      const http = typeof e?.__http__ === "number" ? e.__http__ : 500;
      logger.error("loginBootstrap error", { reqId, http, message: e?.message, code: e?.code, stage: e?.stage || "catch", stack: e?.stack });
      sendJson(res, http, { error: e?.message || "internal error", code: e?.code, stage: e?.stage || "catch" }, { reqId });
    }
  }
);

// עטיפה ייעודית לאימות הטוקן – נחזיר 401 במקום 500
async function verifyIdTokenOr401(idToken: string, reqId: string) {
  try {
    return await getAuth().verifyIdToken(idToken);
  } catch (e: any) {
    const code = e?.code || e?.errorInfo?.code || "auth/verify-failed";
    logger.warn("verifyIdToken failed", { reqId, code, message: e?.message });
    throw { __http__: 401, message: "Invalid Firebase ID token", code, stage: "verify_id_token" };
  }
}
