import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { CurrentUserService } from '../app/core/auth/current-user.service';

@Component({
  selector: 'app-admin-clalit',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-clalit.page.html',
})
export class AdminClalitPage {
  schema = '';
  username = '';
  password = '';
  supplierId = '';
  endpoint = 'https://sapaktest.clalit.co.il/mushlamsupplierservice/SupplierRequest.asmx';

  saving = false;
  lastOk = false;
  lastErr = '';

  private cu = inject(CurrentUserService);

  private readonly CONNECT_URL =
    'https://us-central1-bereshit-ac5d8.cloudfunctions.net/connectClalitForFarm';

  constructor(private http: HttpClient) {}

  private async authHeaders() {
    const token = await this.cu.getIdToken(true);
    return {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
  }

  async saveClalitSecrets() {
    this.lastOk = false;
    this.lastErr = '';

    try {
      this.saving = true;

      if (!this.schema.trim()) throw new Error('חסר schema');
      if (!this.username.trim()) throw new Error('חסר username');
      if (!this.password.trim()) throw new Error('חסר password');
      if (!this.supplierId.trim()) throw new Error('חסר supplierId');
      if (!this.endpoint.trim()) throw new Error('חסר endpoint');

      const opts = await this.authHeaders();

      const body = {
        schema: this.schema.trim(),
        username: this.username.trim(),
        password: this.password.trim(),
        supplierId: this.supplierId.trim(),
        endpoint: this.endpoint.trim(),
      };

      await firstValueFrom(this.http.post(this.CONNECT_URL, body, opts));
      this.lastOk = true;
    } catch (e: any) {
      const msg =
        e?.error?.message ||
        e?.error?.error ||
        e?.message ||
        JSON.stringify(e?.error || e, null, 2);
      this.lastErr = msg;
      console.error(e);
    } finally {
      this.saving = false;
    }
  }
}
