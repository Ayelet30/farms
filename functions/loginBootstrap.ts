// functions/src/loginBootstrap.ts
import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import * as functions from 'firebase-functions'; // ← בשביל config()
import './initFirebase';
import * as logger from 'firebase-functions/logger';

// עוזרים ללוגים בטוחים:
const redact = (v?: string, keep = 4) =>
  v ? `${v.slice(0, keep)}…${v.slice(-keep)}` : '(empty)';

const hostOf = (u?: string) => {
  try { return u ? new URL(u).host : '(empty)'; } catch { return '(bad url)'; }
};

function sourceOf(
  envKey: 'SUPABASE_URL' | 'SUPABASE_SERVICE_KEY' | 'SUPABASE_JWT_SECRET',
  runtimeKey: 'url' | 'service_key' | 'jwt_secret'
) {
  // שימי לב: cfgFromRuntime מוגדר אצלך מעל
  // @ts-ignore
  return process.env[envKey] ? 'process.env'
       // @ts-ignore
       : (functions.config()?.supabase?.[runtimeKey] ? 'functions.config()' : 'missing');
}



if (admin.apps.length === 0) {
  admin.initializeApp();
}

const cfgFromEnv = {
  url: process.env.SUPABASE_URL,
  serviceKey: process.env.SUPABASE_SERVICE_KEY,
  jwtSecret: process.env.SUPABASE_JWT_SECRET,
};

const cfgFromRuntime = (functions.config()?.supabase ?? {}) as {
  url?: string; service_key?: string; jwt_secret?: string;
};

const CFG = {
  url: cfgFromEnv.url || cfgFromRuntime.url,
  serviceKey: cfgFromEnv.serviceKey || cfgFromRuntime.service_key,
  jwtSecret: cfgFromEnv.jwtSecret || cfgFromRuntime.jwt_secret,
};


// עוזר: להחזיר JSON ללא החזרת Response (void בלבד)
function sendJson(res: Response, status: number, body: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).send(JSON.stringify(body));
}

export const loginBootstrap = onRequest(
  { region: 'europe-west1', cors: true },
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Preflight
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.status(204).send('');
        return; // ← חשוב: מחזירים void
      }

      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }

      const missing: string[] = [];
      if (!CFG.url) missing.push('SUPABASE_URL');
      if (!CFG.serviceKey) missing.push('SUPABASE_SERVICE_KEY');
      if (!CFG.jwtSecret) missing.push('SUPABASE_JWT_SECRET');
      if (missing.length) return sendJson(res, 500, { error: 'Supabase config missing', missing });


      // אימות Firebase ID token
      const authHeader = req.headers.authorization || '';
      const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!idToken) {
        sendJson(res, 401, { error: 'Missing Firebase ID token' });
        return;
      }

      const decoded = await admin.auth().verifyIdToken(idToken);
      const uid = decoded.uid;

      // חברות פעילה
      const q = `${CFG.url}/rest/v1/tenant_users` +
        `?uid=eq.${encodeURIComponent(uid)}` +
        `&is_active=eq.true` +
        `&select=tenant_id,role_in_tenant`;

      const r = await fetch(q, {
        headers: {
          apikey: CFG.serviceKey as string,
          Authorization: `Bearer ${CFG.serviceKey}`,
          Accept: 'application/json',
        }
      });

      const rTxt = await r.text();
      if (!r.ok) {
        sendJson(res, r.status, { error: 'tenant_users query failed', stage: 'tenant_users', details: rTxt.slice(0, 500) });
        return;
      }

      let memberships: Array<{ tenant_id: string; role_in_tenant: string }> = [];
      try { memberships = JSON.parse(rTxt); } catch { }
      if (!Array.isArray(memberships) || memberships.length === 0) {
        sendJson(res, 403, { error: 'User has no active farm membership', stage: 'no_membership' });
        return;
      }

      const chosen = memberships[0];
      const farmId = chosen.tenant_id;

      // פרטי חווה
      const r2 = await fetch(
        `${CFG.url}/rest/v1/farms?select=id,name,schema_name&id=eq.${encodeURIComponent(farmId)}`,
        {
          headers: {
            apikey: CFG.serviceKey as string,
            Authorization: `Bearer ${CFG.serviceKey}`,
            Accept: 'application/json',
          },
        }
      );

      const r2Txt = await r2.text();
      if (!r2.ok) {
        sendJson(res, r2.status, { error: 'Farm lookup failed', stage: 'farms_select', details: r2Txt.slice(0, 500) });
        return;
      }

      let farms: Array<{ id: string; name: string; schema_name: string }> = [];
      try { farms = JSON.parse(r2Txt); } catch { }
      const farm = farms[0];
      if (!farm) {
        sendJson(res, 404, { error: 'Farm not found', stage: 'farm_missing' });
        return;
      }

      // הנפקת access_token ל-Supabase
      const access_token = jwt.sign(
        { role: 'authenticated', sub: uid, user_metadata: { tenant_id: farmId } },
        CFG.jwtSecret as string,
        { expiresIn: '15m' }
      );

      sendJson(res, 200, { access_token, farm, role_in_tenant: chosen.role_in_tenant });
      return;
    } catch (e: any) {
      console.error('loginBootstrap error:', e);
      sendJson(res, 500, { error: e?.message || 'internal error', stage: 'catch' });
      return;
    }
  }
);
