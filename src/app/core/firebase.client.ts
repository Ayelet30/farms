// firebase.client.ts
import { getApp } from 'firebase/app';
import { getAuth as _getAuth } from 'firebase/auth';

// לא מאתחלים פה! provideFirebaseApp עושה את זה באפליקציה
export const app = () => getApp();          // ייזרק אם אין אפליקציה – טוב לדיבוג
export const auth = () => _getAuth();       // מחזיר את ה-Auth של ה-Default App
