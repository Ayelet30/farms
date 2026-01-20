import { Injectable } from '@angular/core';
import { dbTenant } from './supabaseClient.service';

@Injectable({ providedIn: 'root' })
export class ParentPaymentsDbService {
  db() {
    return dbTenant();
  }
}
