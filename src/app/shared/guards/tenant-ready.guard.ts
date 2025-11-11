import { Injectable } from '@angular/core';
import { CanActivate } from '@angular/router';
import { ensureTenantContextReady } from '../../services/legacy-compat';

@Injectable({ providedIn: 'root' })
export class TenantReadyGuard implements CanActivate {
  async canActivate(): Promise<boolean> {
    await ensureTenantContextReady();   // יוודא selectedTenant או יבחר חברות ראשונה
    return true;
  }
}
