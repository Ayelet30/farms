import { onRequest } from "firebase-functions/v2/https";

import * as logger from "firebase-functions/logger";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { Resend } from "resend";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const RESEND_API_KEY = process.env.RESEND_API_KEY as string; // ← מפתח ל־Resend (שליחת מיילים)

function cors(res: any) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
}


function genTempPassword(): string {
  // סיסמה זמנית חזקה וקצרה (~12 תווים)
  return crypto.randomBytes(9).toString("base64url");
}

async function sendWelcomeEmail(to: string, fullName: string, username: string, password: string) {
  if (!RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY");
  const resend = new Resend(RESEND_API_KEY);

  const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif">
      <h2>ברוך/ה הבא/ה למערכת</h2>
      <p>שלום ${fullName},</p>
      <p>החשבון שלך נוצר בהצלחה.</p>
      <p><b>שם משתמש:</b> ${username}<br/>
         <b>סיסמה זמנית:</b> ${password}</p>
      <p>מטעמי אבטחה מומלץ להחליף סיסמה לאחר הכניסה הראשונה.</p>
    </div>
  `;

  await resend.emails.send({
    from: "no-reply@your-domain.com", // דומיין מאומת ב-Resend
    to,
    subject: "החשבון שלך נוצר בהצלחה",
    html
  });
}

export const createParent = onRequest(
  { region: "europe-west1" },
  async (req, res): Promise<void> => {
    cors(res);

    if (req.method === "OPTIONS") { res.status(200).send("ok"); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }

    try {
      if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
        logger.error("Missing Supabase env");
        res.status(500).json({ error: "server env not configured" });
        return;
      }

      const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      const {
        full_name, email, phone, id_number, address, extra_notes, message_preferences,
        tenant_id, schema_name
      } = (req.body ?? {}) as Record<string, any>;

      // שדות חובה
      const required = ["full_name","email","phone","id_number","address"];
      const missing = required.filter(k => !req.body?.[k]);
      if (missing.length) { res.status(400).json({ error: `missing required fields: ${missing.join(", ")}` }); return; }

      // שם המשתמש = האימייל
      const username = email;
      // סיסמה זמנית
      const tempPassword = genTempPassword();
    

      // 1) יצירת משתמש עם סיסמה זמנית (לא שולח שום מייל אוטומטי)
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true, // מאשרים מייל כדי לא לייצר זרימות אימות נוספות
        user_metadata: { full_name, phone, id_number, address, tenant_id, schema_name, username }
      });
      if (createErr) { res.status(400).json({ error: createErr.message }); return; }

      const newUid = created?.user?.id;
      if (!newUid) { res.status(400).json({ error: "failed to create auth user" }); return; }

      // 2) הוספה לטבלת parents (כולל username)
      const { error: insertErr } = await supabase
        .from("parents")
        .insert([{
          uid: newUid,
          full_name,
          username,
          phone,
          email,
          id_number,
          address,
          extra_notes,
          message_preferences: Array.isArray(message_preferences) && message_preferences.length
            ? message_preferences
            : ["inapp"],
          tenant_id,
          schema_name
        }]);

      if (insertErr) {
        await supabase.auth.admin.deleteUser(newUid); // rollback
        res.status(400).json({ error: insertErr.message });
        return;
      }

      // 3) שליחת המייל רק אחרי שהכנסה לטבלה הצליחה
      try {
        await sendWelcomeEmail(email, full_name, username, tempPassword);
      } catch (mailErr: any) {
        // מייל נכשל → מנקים הכול כדי לא להישאר "חצי-דרך"
        await supabase.from("parents").delete().eq("uid", newUid).eq("tenant_id", tenant_id);
        await supabase.auth.admin.deleteUser(newUid);
        res.status(500).json({ error: "created user but failed to send email; rolled back" });
        return;
      }

      // הצלחה מלאה
      res.status(200).json({ ok: true, uid: newUid });
      return;
    } catch (e: any) {
      logger.error("createParent error", e);
      res.status(500).json({ error: e?.message || "unknown error" });
      return;
    }
  }
);




 
