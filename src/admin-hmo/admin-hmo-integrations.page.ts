import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { CurrentUserService } from '../app/core/auth/current-user.service';

type HmoProvider = 'CLALIT' | 'MACCABI' | 'MEUHEDET';

@Component({
  selector: 'app-admin-hmo-integrations',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-hmo-integrations.page.html',
  styleUrls: ['./admin-hmo-integrations.page.scss'],
})
export class AdminHmoIntegrationsPage {
  schema = '';

  provider: HmoProvider = 'MACCABI';

  username = '';
  password = '';

  // כללית
  supplierId = '';
  endpoint = 'https://sapaktest.clalit.co.il/mushlamsupplierservice/SupplierRequest.asmx';

  // מכבי
  serviceProviderType = '5';
  serviceProviderCode = '';
  maccabiEndpoint = 'https://wmsup.mac.org.il';

  // מאוחדת - כרגע בסיס
  meuhedetProviderCode = '';
  meuhedetEndpoint = '';

  saving = false;
  lastOk = false;
  lastErr = '';

  private cu = inject(CurrentUserService);

  private readonly CONNECT_URL =
    'https://us-central1-bereshit-ac5d8.cloudfunctions.net/connectHmoForFarm';

  constructor(private http: HttpClient) {}

  get providerLabel(): string {
    switch (this.provider) {
      case 'CLALIT': return 'כללית';
      case 'MACCABI': return 'מכבי';
      case 'MEUHEDET': return 'מאוחדת';
    }
  }

  private async authHeaders() {
    const token = await this.cu.getIdToken(true);

    return {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
  }

  private validate() {
    if (!this.schema.trim()) throw new Error('חסר Tenant Schema');
    if (!this.username.trim()) throw new Error('חסר שם משתמש');
    if (!this.password.trim()) throw new Error('חסרה סיסמה');

    if (this.provider === 'CLALIT') {
      if (!this.supplierId.trim()) throw new Error('חסר Supplier ID');
      if (!this.endpoint.trim()) throw new Error('חסר Endpoint');
    }

    if (this.provider === 'MACCABI') {
      if (!this.serviceProviderType.trim()) throw new Error('חסר סוג נותן שירות');
      if (!this.serviceProviderCode.trim()) throw new Error('חסר קוד נותן שירות');
      if (!this.maccabiEndpoint.trim()) throw new Error('חסר Endpoint מכבי');
    }

    if (this.provider === 'MEUHEDET') {
      if (!this.meuhedetProviderCode.trim()) throw new Error('חסר קוד ספק מאוחדת');
    }
  }

  private buildBody() {
    const base = {
      schema: this.schema.trim(),
      provider: this.provider,
      username: this.username.trim(),
      password: this.password.trim(),
    };

    if (this.provider === 'CLALIT') {
      return {
        ...base,
        supplierId: this.supplierId.trim(),
        endpoint: this.endpoint.trim(),
      };
    }

    if (this.provider === 'MACCABI') {
      return {
        ...base,
        serviceProviderType: this.serviceProviderType.trim(),
        serviceProviderCode: this.serviceProviderCode.trim(),
        endpoint: this.maccabiEndpoint.trim(),
      };
    }

    return {
      ...base,
      providerCode: this.meuhedetProviderCode.trim(),
      endpoint: this.meuhedetEndpoint.trim(),
    };
  }

  async saveSecrets() {
    this.lastOk = false;
    this.lastErr = '';

    try {
      this.saving = true;
      this.validate();

      const opts = await this.authHeaders();
      const body = this.buildBody();

      await firstValueFrom(this.http.post(this.CONNECT_URL, body, opts));

      this.lastOk = true;
      this.password = '';
    } catch (e: any) {
      this.lastErr =
        e?.error?.message ||
        e?.error?.error ||
        e?.message ||
        JSON.stringify(e?.error || e, null, 2);

      console.error(e);
    } finally {
      this.saving = false;
    }
  }
}