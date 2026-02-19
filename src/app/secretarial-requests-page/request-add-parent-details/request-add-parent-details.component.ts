import { Component, Input, Output, EventEmitter, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { computed } from '@angular/core'; 
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { dbTenant } from '../../services/legacy-compat';
import { CurrentUserService } from '../../core/auth/current-user.service';
import { TenantBootstrapService } from '../../services/tenant-bootstrap.service';
import type { UiRequest } from '../../Types/detailes.model';

import { RequestValidationService } from '../../services/request-validation.service'; 
// ⚠️ תעדכני את הנתיב לפי הפרויקט שלך

type ParentMeta = {
  first_name?: string;
  last_name?: string;
  id_number?: string;
  phone?: string;
  email?: string;
  address?: string;
  extra_notes?: string | null;
  [k: string]: any;
};

type ToastKind = 'success' | 'error' | 'info';

@Component({
  selector: 'app-request-add-parent-details',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatSnackBarModule , MatProgressSpinnerModule],
  templateUrl: './request-add-parent-details.component.html',
  styleUrls: ['./request-add-parent-details.component.css'], // מומלץ scss בשביל העיצוב
})
export class RequestAddParentDetailsComponent {
private _req = signal<UiRequest | null>(null);

@Input({ required: true })
set request(value: UiRequest) {
  this._req.set(value);
}

readonly req = this._req;

  /** כמו בשאר קומפוננטות הפרטים */
  @Input() decidedByUid: string | null = null;

  /** callbacks שהעמוד הראשי יודע לתפוס */
  @Input() onApproved?: (e: { requestId: string; newStatus: 'APPROVED'; message?: string; meta?: any }) => void;
@Input() onRejected?: (e: { requestId: string; newStatus: 'REJECTED' | 'REJECTED_BY_SYSTEM'; message?: string; meta?: any }) => void;
  @Input() onError?: (e: { requestId?: string; message: string; raw?: any }) => void;

  /** נשאיר גם Outputs למקרה שיש מאזינים */
  @Output() approved = new EventEmitter<{ requestId: string; newStatus: 'APPROVED' }>();
  @Output() rejected = new EventEmitter<{ requestId: string; newStatus: 'REJECTED' }>();
  @Output() error = new EventEmitter<string>();
@Input() bulkMode = false;  // אם יש לך bulk כמו בדפים אחרים
public bulkWarning: string | null = null;

busy = signal(false);
action = signal<'approve' | 'reject' | null>(null);
busyText = computed(() => {
  switch (this.action()) {
    case 'approve': return 'הבקשה בתהליך אישור…';
    case 'reject':  return 'הבקשה בתהליך דחייה…';
    default:        return 'מעבד…';
  }
});

private showSnack(msg: string, type: 'success' | 'error') {
  // אם אין לך bulkMode – אפשר להשאיר בלי ה-if הזה
  if (this.bulkMode && type === 'success') return;

  this.snack.open(msg, 'סגור', {
    duration: 3000,
    direction: 'rtl',
    horizontalPosition: 'center',
    verticalPosition: 'top',
    panelClass: [type === 'success' ? 'snack-success' : 'snack-error'],
  });
}

  private tenantBoot = inject(TenantBootstrapService);

  private cu = inject(CurrentUserService);
  private snack = inject(MatSnackBar);
private validator = inject(RequestValidationService);
private async rejectBySystem(reason: string): Promise<void> {
  const db = dbTenant();

  const decidedUid =
    this.decidedByUid ?? (this.cu.current as any)?.uid ?? null;

  const { error } = await db.rpc('reject_secretarial_request', {
    p_request_id: this.req()?.id,
    p_decided_by_uid: decidedUid,
    p_decision_note: reason || 'הבקשה אינה תקינה',
  });

  if (error) throw error;

  const msg = `הבקשה נדחתה אוטומטית: ${reason}`;
  this.toast(msg, 'info');

 const r = this.req();
if (!r?.id) return;

this.onRejected?.({ requestId: r.id, newStatus: 'REJECTED_BY_SYSTEM', message: msg });
this.rejected.emit({ requestId: r.id, newStatus: 'REJECTED' });
}

  loading = signal(false);
  errText = signal<string | null>(null);
  decisionNote = '';

  get isSecretary(): boolean {
    const u: any = this.cu.current;
    const role = u?.role_in_tenant ?? u?.role ?? null;
    return role === 'secretary';
  }

 get isPending(): boolean {
  return (this.req()?.status ?? '') === 'PENDING';
}


  /** אצלך בפועל השדות של ההורה יושבים בשורש ה-payload (ולא ב-public_meta) */
  get parentMeta(): ParentMeta {
    const p: any = this.req()?.payload ?? {};
    // אם בעתיד תעבירי לתוך p.parent זה עדיין יעבוד:
    return (p.parent ?? p) as ParentMeta;
  }

  get fullName(): string {
    const m = this.parentMeta;
    return `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || '—';
  }

  get prettyJson(): string {
    try { return JSON.stringify(this.req()?.payload ?? {}, null, 2); }
    catch { return String(this.req()?.payload ?? ''); }
  }

  static async isValidRequset(): Promise<{ ok: boolean; reason?: string }> {
    return { ok: true };
  }

  async isValidRequset(): Promise<{ ok: boolean; reason?: string }> {
    return await RequestAddParentDetailsComponent.isValidRequset();
  }

  private toast(message: string, type: ToastKind = 'info') {
    this.snack.open(message, 'סגור', {
      duration: 3500,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
      panelClass: [`sf-toast`, `sf-toast-${type}`],
    });
  }


/** מקור אמת: tenantBoot (כמו בקוד האחר שלך) */
private async getFarmMetaSafe(): Promise<any | null> {
  await this.tenantBoot.ensureReady();
  return this.tenantBoot.getFarmMetaSync() ?? null;
}

/** tenant_id מתוך meta של החווה (או פונקציה ייעודית אם יש) */
private async getTenantId(): Promise<string | null> {
  const farm = await this.getFarmMetaSafe();
  // התאימי לפי המבנה אצלך:
  return farm?.tenant_id ?? farm?.id ?? farm?.tenantId ?? null;
}

/** schema_name מתוך meta של החווה (כמו בקוד שעובד אצלך) */
private async getSchemaName(): Promise<string | null> {
  const farm = await this.getFarmMetaSafe();
  return farm?.schema_name ?? null;
}

/* ---------------------------------------------------
   אופציונלי: fallback ל-storage רק אם אין farm meta
--------------------------------------------------- */
private getSelectedTenantFromStorage(): any | null {
  const keys = ['selectedTenant', 'sf_selectedTenant', 'tenant', 'currentTenant'];
  for (const k of keys) {
    const raw = localStorage.getItem(k);
    if (!raw) continue;
    try { return JSON.parse(raw); } catch { /* ignore */ }
  }
  return null;
}

private async getTenantIdWithFallback(): Promise<string | null> {
  const fromBoot = await this.getTenantId();
  if (fromBoot) return fromBoot;

  const t = this.getSelectedTenantFromStorage();
  return t?.tenant_id ?? t?.id ?? t?.tenantId ?? null;
}

private async getSchemaNameWithFallback(): Promise<string | null> {
  const fromBoot = await this.getSchemaName();
  if (fromBoot) return fromBoot;

  const t = this.getSelectedTenantFromStorage();
  // אצלך זה schema_name, לא "schema"
  return t?.schema_name ?? t?.schema ?? t?.db_schema ?? t?.farm_schema ?? null;
}

private async getTenantCtx(): Promise<{ tenant_id: string; schema: string }> {
  await this.tenantBoot.ensureReady();
  const farm = this.tenantBoot.getFarmMetaSync();

  const tenant_id = (farm as any)?.tenant_id ?? (farm as any)?.id ?? null;
  const schema = (farm as any)?.schema_name ?? null;

  if (!tenant_id) throw new Error('לא זוהה tenant_id (חווה מחוברת).');
  if (!schema) throw new Error('לא זוהתה סכמת חווה (schema_name).');

  // הגנה: לוודא שזה באמת string
  if (typeof tenant_id !== 'string') throw new Error(`tenant_id לא תקין: ${String(tenant_id)}`);
  if (typeof schema !== 'string') throw new Error(`schema לא תקינה: ${String(schema)}`);

  return { tenant_id, schema };
}


  // =========================
  // אישור = Cloud Function
  // =========================
  async approve(): Promise<void> {
 if (this.busy()) return; 
  const r = this.req();
  if (!this.isSecretary || !this.isPending || !r?.id) return;  


this.action.set('approve');
this.busy.set(true);

    this.loading.set(true);
    this.errText.set(null);

    try {
      // ✅ בדיקה דרך השירות לפני אישור
      const r = this.req();
if (!r) return;

const v = await this.validator.validate(r as any, 'approve');

    if (!v.ok) {
      await this.rejectBySystem(v.reason);
      return; // 👈 חשוב מאוד
    }
      const idToken = await this.cu.getIdToken(true);

      const { tenant_id, schema } = await this.getTenantCtx(); 
      
      const resp = await fetch('/api/approveParentSignupRequest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ schema, requestId: this.req()?.id, tenant_id }),
      });

      const ct = resp.headers.get('content-type') || '';
const raw = await resp.text();
let out: any = null;
try { out = JSON.parse(raw); } catch { out = { raw }; }

    if (!resp.ok || !out?.ok) {
  throw new Error(out?.message || out?.error || `HTTP ${resp.status}: ${raw.slice(0, 300)}`);
}

if (!r) return;

const okEvent = { requestId: r.id, newStatus: 'APPROVED' as const };
this.onApproved?.(okEvent);
this.approved.emit(okEvent);

this.bulkWarning = null;

if (out?.emailOk === false) {
  this.bulkWarning = 'אושרה ✅ אבל לא נשלח מייל להורה';
  this.showSnack(`אושר ✅ אבל שליחת מייל נכשלה`, 'error');
} else {
  this.showSnack('הבקשה אושרה בהצלחה ✅', 'success');
}

    } catch (e: any) {
      const msg = e?.message || 'שגיאה באישור בקשת הרשמה';
      console.error('approve PARENT_SIGNUP failed', e);
      this.errText.set(msg);
      this.toast(msg, 'error');
      this.onError?.({ requestId: this.req()?.id, message: msg, raw: e });
      this.error.emit(msg);
    } finally {
      this.loading.set(false);
      this.busy.set(false);
this.action.set(null);

    }
  }

  // =========================
  // דחייה = reject_secretarial_request (RPC)
  // =========================
  async reject(): Promise<void> {
    if (this.busy()) return;

  const r = this.req();
  if (!this.isSecretary || !this.isPending || !r?.id) return;

  this.action.set('reject');
  this.busy.set(true);
  this.errText.set(null);

  try {
    const v = await this.validator.validate(r as any, 'reject');
    if (!v.ok) {
      await this.rejectBySystem(v.reason);
      return;
    }

    const idToken = await this.cu.getIdToken(true);
    const { tenant_id, schema } = await this.getTenantCtx();
const resp = await fetch(
  'https://us-central1-bereshit-ac5d8.cloudfunctions.net/rejectParentSignupRequest',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      schema,
      requestId: r.id,
      tenant_id,
      decisionNote: this.decisionNote?.trim() || null,
    }),
  }
);

    const raw = await resp.text();
    let out: any = null;
    try { out = JSON.parse(raw); } catch { out = { raw }; }

    if (!resp.ok || !out?.ok) {
      throw new Error(out?.message || out?.error || `HTTP ${resp.status}: ${raw.slice(0, 300)}`);
    }

    const er = { requestId: r.id, newStatus: 'REJECTED' as const };
    this.onRejected?.(er);
    this.rejected.emit(er);

    this.bulkWarning = null;

    if (out?.emailOk === false) {
      this.bulkWarning = 'נדחתה ✅ אבל לא נשלח מייל להורה';
      this.showSnack(`נדחה ✅ אבל שליחת מייל נכשלה`, 'error');
    } else {
      this.showSnack('הבקשה נדחתה בהצלחה ✅', 'success');
    }
  } catch (e: any) {
    const msg = e?.message || 'שגיאה בדחיית הבקשה';
    console.error('reject PARENT_SIGNUP failed', e);
    this.errText.set(msg);
    this.showSnack(msg, 'error');
    this.onError?.({ requestId: r?.id, message: msg, raw: e });
    this.error.emit(msg);
  } finally {
    this.busy.set(false);
    this.action.set(null);
  }
}

}


