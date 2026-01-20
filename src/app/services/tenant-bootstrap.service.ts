import { Injectable } from '@angular/core';
import { ensureTenantContextReady, getCurrentFarmMetaSync } from './legacy-compat';

@Injectable({ providedIn: 'root' })
export class TenantBootstrapService {
  ensureReady() {
    return ensureTenantContextReady();
  }

  getFarmMetaSync() {
    return getCurrentFarmMetaSync();
  }
}
