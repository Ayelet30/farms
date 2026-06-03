import { Injectable, signal } from '@angular/core';
import {
  ensureTenantContextReady,
  dbTenant,
  getCurrentFarmMetaSync,
  getSupabaseClient,
} from '../services/supabaseClient.service';

@Injectable({ providedIn: 'root' })
export class RequestBadgeService {
  pendingCount = signal(0);

  private channel: any = null;
  private currentSchema: string | null = null;

  async init() {
    await this.refreshTenant();
  }

  async refreshTenant() {
    await ensureTenantContextReady();

    const farm = getCurrentFarmMetaSync();
    const schema = farm?.schema_name ?? null;

    if (!schema) {
      this.pendingCount.set(0);
      return;
    }

    // אם עברנו חווה — מחליפים realtime channel
    if (schema !== this.currentSchema) {
      this.currentSchema = schema;
      await this.listenRealtime(schema);
    }

    await this.reload();
  }

  async reload() {
    await ensureTenantContextReady();

    const { count, error } = await dbTenant()
      .from('v_secretarial_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'PENDING');

    if (error) {
      console.error('badge count error', error);
      return;
    }

    this.pendingCount.set(count ?? 0);
  }

  private async listenRealtime(schema: string) {
    const client = getSupabaseClient();

    if (this.channel) {
      await client.removeChannel(this.channel);
      this.channel = null;
    }

    this.channel = client
      .channel(`request-badge-${schema}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema,
          table: 'secretarial_requests',
        },
        () => void this.reload()
      )
      .subscribe(status => {
        console.log('badge realtime status:', schema, status);
      });
  }
}