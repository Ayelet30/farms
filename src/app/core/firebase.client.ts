// src/app/core/firebase.client.ts
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { environment } from '../../environments/environment'; // ודאי שהנתיב נכון

// קונפיג מהקונסול של Firebase: Project settings → Your apps → SDK setup and config
const firebaseConfig = environment.firebase;

// אתחול חד-פעמי
export const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

// יצירת אובייקט Auth "קשור" לאפליקציה
export const auth: Auth = getAuth(app);
