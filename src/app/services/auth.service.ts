// auth.service.ts (דוגמה)
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';

@Injectable({ providedIn: 'root' })
export class AuthService {
    private http = inject(HttpClient);
    private afAuth = inject(Auth);

    async callLoginBootstrap() {
        const user = await this.afAuth.currentUser;
        if (!user) throw new Error('No Firebase user is signed in');

        const idToken = await user.getIdToken(/* forceRefresh */ true); // מרענן טוקן שפג
        const headers = new HttpHeaders({ Authorization: `Bearer ${idToken}` });

        this.http.get('/api/loginBootstrap', { headers }).subscribe({
            next: (res) => console.log('OK', res),
            error: async (err) => {
                // חשוב: לקרוא את גוף התשובה כדי לראות stage/code
                if (err.error) console.error('loginBootstrap error body:', err.error);
                console.error('loginBootstrap status:', err.status);
            }
        });
    }
}
