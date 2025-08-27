// functions/src/loginBootstrap.ts (Firebase Functions v2)
import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import jwt from 'jsonwebtoken';
import './initFirebase';


if (admin.apps.length === 0) {
  admin.initializeApp();
}
// שמרי את הערכים האלו ב-ENV של הפונקציות (לא בקוד!):
// firebase functions:config:set supabase.url="https://<proj>.supabase.co" supabase.service_key="<SERVICE_KEY>" supabase.jwt_secret="<JWT_SECRET>"
const CFG = {
  url: (process.env.SUPABASE_URL || (global as any).functions?.config?.supabase?.url) as string,
  serviceKey: (process.env.SUPABASE_SERVICE_KEY || (global as any).functions?.config?.supabase?.service_key) as string,
  jwtSecret: (process.env.SUPABASE_JWT_SECRET || (global as any).functions?.config?.supabase?.jwt_secret) as string,
};

export const loginBootstrap = onRequest(async (req, res) => {
  try {
    // 1) אימות פיירבייס
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) { res.status(401).json({ error: 'Missing Firebase ID token' }); return; }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    // 2) שליפת החוות של המשתמש
    const q = `${CFG.url}/rest/v1/tenant_users?uid=eq.${uid}&is_active=eq.true&select=tenant_id,role_in_tenant`;
    const r = await fetch(q, { headers: { apikey: CFG.serviceKey, Authorization: `Bearer ${CFG.serviceKey}` } });
    const memberships = await r.json() as Array<{ tenant_id: string; role_in_tenant: string }>;

    if (!Array.isArray(memberships) || memberships.length === 0) {
      res.status(403).json({ error: 'User has no active farm membership' });
      return;
    }

    // 3) בוחרים חווה (אם יש אחת – לוקחים אותה)
    const chosen = memberships[0]; // אפשר להחליף ללוגיקה אחרת/ברירת מחדל
    const farmId = chosen.tenant_id;

    // 4) שולפים מטא-דאטה של החווה (שם הסכמה)
    const r2 = await fetch(`${CFG.url}/rest/v1/farms?id=eq.${farmId}&select=id,name,schema_name`,
      { headers: { apikey: CFG.serviceKey, Authorization: `Bearer ${CFG.serviceKey}` } });
    const [farm] = await r2.json() as Array<{ id: string; name: string; schema_name: string }>;
    if (!farm) { res.status(404).json({ error: 'Farm not found' }); return; }

    // 5) מנפיקים JWT ל-Supabase (עם tenant_id)
    const access_token = jwt.sign(
      { role: 'authenticated', sub: uid, user_metadata: { tenant_id: farmId } },
      CFG.jwtSecret,
      { expiresIn: '15m' }
    );

    res.status(200).json({
      access_token,
      farm,
      role_in_tenant: chosen.role_in_tenant,
    });
    return;
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e?.message || 'internal error' });
    return;
  }
});
