// functions/src/initFirebase.ts
import { getApps, initializeApp } from 'firebase-admin/app';

// אתחול יחיד של Firebase Admin (גם באמולטור וגם בענן)
if (!getApps().length) {
  initializeApp(); // ישתמש ב-Default Credentials (אמולטור/Production)
}

export {}; // כדי למנוע תלונות TypeScript על "מודול ריק"
