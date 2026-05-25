import { Injectable, signal } from '@angular/core';
import {
  ensureTenantContextReady,
  dbTenant,
} from '../services/legacy-compat';

@Injectable({ providedIn: 'root' })
export class RequestBadgeService {
  pendingCount = signal(0);
  private channel: any = null;

  async init() {
    await this.reload();
    await this.listenRealtime();
  }

  async reload() {
    await ensureTenantContextReady();
    const db = dbTenant();

    const { count, error } = await db
      .from('v_secretarial_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'PENDING');

    if (error) {
      console.error('badge count error', error);
      return;
    }

    this.pendingCount.set(count ?? 0);
  }

  decrement() {
    this.pendingCount.update(v => Math.max(0, v - 1));
    void this.reload();
  }

  increment() {
    this.pendingCount.update(v => v + 1);
    void this.reload();
  }

  private async listenRealtime() {
    const db = dbTenant();

    if (this.channel) {
      await db.removeChannel(this.channel);
    }

    this.channel = db
      .channel('request-badge-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          table: 'secretarial_requests',
        },
        () => {
          void this.reload();
        }
      )
      .subscribe();
  }
}