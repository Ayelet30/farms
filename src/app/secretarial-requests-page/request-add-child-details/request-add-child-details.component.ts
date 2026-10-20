import { Component, Input, OnChanges, OnInit, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant, getSupabaseClient } from '../../services/legacy-compat';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { RequestValidationService } from '../../services/request-validation.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { computed } from '@angular/core';
import { SupabaseTenantService } from '../../services/supabase-tenant.service';
import { getAuth } from 'firebase/auth';
import { requireTenant } from '../../services/supabaseClient.service';
import { Output, EventEmitter } from '@angular/core';
import { MatIcon } from "@angular/material/icon";
import { WaitingListDialog } from '../../shared/components/waiting-list-dialog/waiting-list-dialog';
import { CurrentUserService } from '../../core/auth/current-user.service';

type AddChildDetails = {
  request_id: string;
  created_at: string;
  requested_by_uid: string;
  requester_role: string;

  parent_uid: string;
  parent_name: string | null;

  child_id: string;
  child_name: string | null;
  gov_id: string | null;
  birth_date: string | null;
  age_years: number | null;
  gender: string | null;
  funding_source_id: string | null;
  funding_source_name: string | null;
  medical_notes: string | null;

  growth_delay: boolean;
  epilepsy: boolean;
  autism_spectrum: boolean;
  autism_function: string | null;
  physical_disability: boolean;
  cognitive_disability: boolean;
  emotional_issues: boolean;
  medical_other: string | null;

  terms_signed_name: string | null;
  terms_accepted_at: string | null;

  registration_amount: number | null;
  card_last4: string | null;

  // ✅ חדש - מגיע מה-RPC
  signed_pdf_bucket: string | null;
  signed_pdf_path: string | null;

  registration_charges: {
    id: string;
    item: string;
    amount: number;
    is_required: boolean;
  }[] | null;
};

type ToastKind = 'success' | 'error' | 'info';

@Component({
  selector: 'app-request-add-child-details',
  standalone: true,
  imports: [CommonModule, FormsModule, MatSnackBarModule, MatProgressSpinnerModule, MatIcon, WaitingListDialog],
  templateUrl: './request-add-child-details.component.html',
  styleUrls: ['./request-add-child-details.component.scss'],
})
export class RequestAddChildDetailsComponent implements OnInit, OnChanges {
  @Input({ required: true }) request!: any; // UiRequest
  @Input({ required: true }) decidedByUid!: string;

  @Input() onApproved?: (e: { requestId: string; newStatus: 'APPROVED'; message?: string; meta?: any }) => void;
  @Input() onRejected?: (e: { requestId: string; newStatus: | 'REJECTED' | 'REJECTED_BY_SYSTEM'; message?: string; meta?: any }) => void;
  @Input() onError?: (e: { requestId?: string; message: string; raw?: any }) => void;

  @Output() approved = new EventEmitter<any>();
  @Output() rejected = new EventEmitter<any>();

  private db = dbTenant();
  private snack = inject(MatSnackBar);
  private sanitizer = inject(DomSanitizer);
  busy = signal(false);
  action = signal<'approve' | 'reject' | null>(null);
  private tenantSvc = inject(SupabaseTenantService);
  private currentUserService = inject(CurrentUserService);

  busyText = computed(() => {
    switch (this.action()) {
      case 'approve': return 'הבקשה בתהליך אישור…';
      case 'reject': return 'הבקשה בתהליך דחייה…';
      default: return 'מעבד…';
    }
  });
  private approveUrl =
    'https://us-central1-bereshit-ac5d8.cloudfunctions.net/approveAddChildAndNotify';

  private rejectUrl =
    'https://us-central1-bereshit-ac5d8.cloudfunctions.net/rejectAddChildAndNotify';
  private async postCloud(url: string, body: any) {
    const user = getAuth().currentUser;
    if (!user) throw new Error('המשתמש לא מחובר');
    const token = await user.getIdToken();

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const raw = await resp.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch { }

    if (!resp.ok || !json?.ok) {
      throw new Error(json?.message || json?.error || `HTTP ${resp.status}: ${raw?.slice(0, 300)}`);
    }

    return json;
  }
  private getChildIdFromRequest(): string | null {
    const r = this.request;
    const p = r?.payload ?? {};
    return (
      r?.childId ??
      r?.child_id ??
      p?.child_id ??
      p?.childId ??
      null
    );
  }
  loading = signal(false);
  details = signal<AddChildDetails | null>(null);
  decisionNote = '';
  private validator = inject(RequestValidationService);
  private async rejectBySystem(reason: string): Promise<void> {
    if (!this.request?.id) return;

    try {
      const idToken = await getAuth().currentUser?.getIdToken();
      const tenantSchema = requireTenant().schema;               // ✅ schema מה-context

      await fetch(
        'https://us-central1-bereshit-ac5d8.cloudfunctions.net/autoRejectRequestAndNotify',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            tenantSchema,
            requestId: this.request.id,
            reason,
            decidedByUid: this.request.id
          }),
        }
      );
    } catch (e) {
      console.error('rejectBySystem (via CF) failed', e);
    }
  }
  // ===== Signed Terms popup =====
  signedOpen = signal(false);
  loadingSigned = signal(false);
  signedDocUrlRaw = signal<string | null>(null);
  signedDocUrlSafe = signal<SafeResourceUrl | null>(null);

  async ngOnInit() {
    await this.loadDetails();
  }

  private async callCloud(action: 'approve' | 'reject', extra?: { system?: boolean }) {
    const url =
      action === 'approve'
        ? '/api/approveAddChildAndNotify'
        : '/api/rejectAddChildAndNotify';

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: this.request.id,
        decidedByUid: this.decidedByUid ?? null,
        decisionNote: this.decisionNote || null,
        system: !!extra?.system, // 👈 כדי לאפשר REJECTED_BY_SYSTEM
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.ok === false) {
      throw new Error(json?.message || 'שגיאה בקריאה לשרת');
    }
    return json as {
      ok: true;
      newStatus: 'APPROVED' | 'REJECTED' | 'REJECTED_BY_SYSTEM';
      mail?: { ok: boolean; warning?: string };
      meta?: any;
      message?: string;
    };
  }
  async ngOnChanges(changes: SimpleChanges) {
    if (changes['request'] && !changes['request'].firstChange) {
      const prev = changes['request'].previousValue?.id;
      const curr = changes['request'].currentValue?.id;

      if (prev !== curr) {
        await this.loadDetails();
      }
    }
  }

  async loadDetails() {
    this.loading.set(true);
    try {
      const { data, error } = await this.db.rpc('get_add_child_request_details', {
        p_request_id: this.request.id,
      });
      if (error) throw error;

      const row = (data?.[0] ?? null) as AddChildDetails | null;
      this.details.set(row);
    } catch (e: any) {
      console.error(e);
      const msg = e?.message || 'שגיאה בטעינת פרטי הבקשה';
      this.toast(msg, 'error');
      this.onError?.({ requestId: this.request?.id, message: msg, raw: e });
    } finally {
      this.loading.set(false);
    }
  }

  static async isValidRequset(): Promise<{ ok: boolean; reason?: string }> {
    return { ok: true };
  }

  async isValidRequset(): Promise<{ ok: boolean; reason?: string }> {
    return await RequestAddChildDetailsComponent.isValidRequset();
  }

  get medicalTags(): string[] {
    const d = this.details();
    if (!d) return [];
    const tags: string[] = [];
    if (d.growth_delay) tags.push('עיכובי גדילה');
    if (d.epilepsy) tags.push('אפילפסיה');
    if (d.autism_spectrum) tags.push(`על הרצף${d.autism_function ? ` (${d.autism_function})` : ''}`);
    if (d.physical_disability) tags.push('מוגבלות פיזית');
    if (d.cognitive_disability) tags.push('מוגבלות קוגניטיבית');
    if (d.emotional_issues) tags.push('קשיים רגשיים');
    if ((d.medical_other || '').trim()) tags.push(`אחר: ${d.medical_other}`);
    return tags;
  }

  // ===== תקנון חתום: פתיחה/סגירה =====
  async openSignedTerms() {
    const d = this.details();
    if (!d?.child_id) return;

    this.loadingSigned.set(true);
    this.signedDocUrlRaw.set(null);
    this.signedDocUrlSafe.set(null);

    try {
      const bucket = d.signed_pdf_bucket ?? null;
      const path = d.signed_pdf_path ?? null;

      if (!bucket || !path) {
        this.signedOpen.set(true);
        return;
      }

      const client = getSupabaseClient();
      const { data: pub } = client.storage.from(bucket).getPublicUrl(path);
      let url = pub?.publicUrl ?? null;

      // cache-bust כדי שלא ייתקע על גרסה ישנה
      if (url) url = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;

      this.signedDocUrlRaw.set(url);
      this.signedDocUrlSafe.set(url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null);
      this.signedOpen.set(true);
    } catch (e: any) {
      console.error(e);
      this.toast(e?.message ?? 'שגיאה בפתיחת תקנון חתום', 'error');
    } finally {
      this.loadingSigned.set(false);
    }
  }

  closeSignedPopup() {
    this.signedOpen.set(false);
  }

  async approve() {
    if (!this.canManageRequests || !this.isPending || this.loading()) return;

    this.action.set('approve');
    this.loading.set(true);

    try {
      // ✅ בדיקה בתחילת אישור
      const v = await this.validator.validate(this.request, 'approve');
      if (!v.ok) {
        await this.rejectBySystem(v.reason ?? 'הבקשה אינה תקינה');
        return;
      }

      await this.tenantSvc.ensureTenantContextReady();
      const tenant = this.tenantSvc.requireTenant();
      const tenantSchema = tenant.schema;
      const tenantId = tenant.id;

      const childId = this.getChildIdFromRequest();
      if (!childId) throw new Error('חסר childId בבקשה');

      const json = await this.postCloud(this.approveUrl, {
        tenantSchema,
        tenantId,
        childId,
        requestId: this.request.id,
        decisionNote: this.decisionNote || null,
      });

      // ✅ הצלחה ב-DB
      const msg = 'הבקשה אושרה בהצלחה';
      this.approved.emit({
        requestId: this.request.id,
        newStatus: 'APPROVED'
      });

      if (json?.emailOk === false) {
        this.toast('אושר ✅ אבל שליחת מייל נכשלה', 'error'); // כמו אצלך במחיקה
      } else {
        this.toast(msg, 'success');
      }


      this.onApproved?.({
        requestId: this.request.id,
        newStatus: 'APPROVED',
        message: msg,
        meta: json,
      });
    } catch (e: any) {
      console.error(e);
      const msg = e?.message || 'שגיאה באישור הבקשה';
      this.toast(msg, 'error');
      this.onError?.({ requestId: this.request?.id, message: msg, raw: e });
    } finally {
      this.loading.set(false);
      this.action.set(null);
    }
  }
  async reject(args?: { source: 'user' | 'system'; reason?: string }) {
    if (!this.canManageRequests || !this.isPending || this.loading()) return;

    this.action.set('reject');
    this.loading.set(true);

    try {
      // ✅ בדיקה בתחילת דחייה
      const v = await this.validator.validate(this.request, 'reject');
      if (!v.ok) {
        await this.rejectBySystem(v.reason ?? 'הבקשה אינה תקינה');
        return;
      }

      await this.tenantSvc.ensureTenantContextReady();
      const tenant = this.tenantSvc.requireTenant();
      const tenantSchema = tenant.schema;
      const tenantId = tenant.id;

      const childId = this.getChildIdFromRequest();
      if (!childId) throw new Error('חסר childId בבקשה');

      const reason = (args?.reason ?? this.decisionNote ?? '').trim() || null;
      const system = args?.source === 'system';

      const json = await this.postCloud(this.rejectUrl, {
        tenantSchema,
        tenantId,
        childId,
        requestId: this.request.id,
        decisionNote: reason,
        system,
      });

      const newStatus = (json?.newStatus === 'REJECTED_BY_SYSTEM')
        ? 'REJECTED_BY_SYSTEM'
        : 'REJECTED';

      const msg = 'הבקשה נדחתה בהצלחה';
      this.rejected.emit({
        requestId: this.request.id,
        newStatus
      });

      if (json?.emailOk === false) {
        this.toast('נדחה ✅ אבל שליחת מייל נכשלה', 'error');
      } else {
        this.toast(msg, 'success');
      }

      this.onRejected?.({
        requestId: this.request.id,
        newStatus,
        message: msg,
        meta: json,
      });
    } catch (e: any) {
      console.error(e);
      const msg = e?.message || 'שגיאה בדחיית הבקשה';
      this.toast(msg, 'error');
      this.onError?.({ requestId: this.request?.id, message: msg, raw: e });
    } finally {
      this.loading.set(false);
      this.action.set(null);
    }
  }
  private toast(
    message: string,
    type: 'success' | 'error' | 'info' | 'systemReject' = 'info'
  ) {
    this.snack.open(message, 'סגירה', {
      duration: 3500,
      direction: 'rtl',
      horizontalPosition: 'center',
      verticalPosition: 'top',
      panelClass: [
        type === 'success' || type === 'info'
          ? 'app-toast-success'
          : type === 'systemReject'
            ? 'app-toast-system-reject'
            : 'app-toast-error'
      ],
    });
  }
  get isPending(): boolean {
    return this.request?.status === 'PENDING';
  }

  get canManageRequests(): boolean {
    const user = this.currentUserService.current;

    const role = String(
      (user as any)?.role_in_tenant ?? user?.role ?? ''
    ).trim().toLowerCase();

    return role === 'secretary';
  }

  // =========================================
  // WAITING LIST - ADD CHILD REQUEST
  // =========================================

  showWaitlistDialog = false;
  waitlistApprovedChild = false;
  waitlistApprovalReported = false;

  waitlistInstructors: {
    id_number: string;
    first_name?: string | null;
    last_name?: string | null;
    name?: string | null;
  }[] = [];

  async openWaitlistDialog(): Promise<void> {
    if (!this.canManageRequests || !this.isPending || this.loading()) return;

    const d = this.details();
    if (!d?.child_id || !d?.parent_uid) {
      this.toast('חסרים פרטי ילד או הורה בבקשה', 'error');
      return;
    }

    try {
      await this.tenantSvc.ensureTenantContextReady();

      const { data, error } = await dbTenant()
        .from('instructors')
        .select('id_number, first_name, last_name')
        .order('first_name', { ascending: true });

      if (error) throw error;

      this.waitlistInstructors = (data ?? []).map((i: any) => ({
        ...i,
        name: `${i.first_name ?? ''} ${i.last_name ?? ''}`.trim()
      }));

      this.waitlistApprovedChild = false;
      this.waitlistApprovalReported = false;
      this.showWaitlistDialog = true;

    } catch (error: any) {
      console.error('Failed to open waiting list:', error);
      this.toast(
        error?.message ?? 'שגיאה בטעינת המדריכים',
        'error'
      );
    }
  }


  // הפונקציה מועברת לחלון המשותף.
  // היא מופעלת רק כשהמשתמשת לוחצת על שמירה.
  approveChildBeforeWaitlist = async (): Promise<{
    childId: string;
    parentUid: string;
  }> => {
    if (!this.canManageRequests) {
      throw new Error('אין הרשאה לבצע פעולה זו');
    }
    const d = this.details();

    if (!d?.child_id || !d?.parent_uid) {
      throw new Error('חסרים פרטי ילד או הורה');
    }

    if (this.waitlistApprovedChild) {
      return {
        childId: d.child_id,
        parentUid: d.parent_uid
      };
    }

    if (!this.isPending) {
      throw new Error('הבקשה אינה ממתינה לאישור');
    }

    const validation = await this.validator.validate(
      this.request,
      'approve'
    );

    if (!validation.ok) {
      throw new Error(
        validation.reason ?? 'הבקשה אינה תקינה לאישור'
      );
    }


    await this.tenantSvc.ensureTenantContextReady();

    const tenant = this.tenantSvc.requireTenant();

    const json = await this.postCloud(this.approveUrl, {
      tenantSchema: tenant.schema,
      tenantId: tenant.id,
      childId: d.child_id,
      requestId: this.request.id,
      decisionNote: this.decisionNote || null
    });

    // מעכשיו לא נאשר שוב את אותה בקשה.
    this.waitlistApprovedChild = true;

    if (json?.emailOk === false) {
      this.toast(
        'הילד אושר, אך שליחת המייל נכשלה',
        'error'
      );
    }

    return {
      childId: d.child_id,
      parentUid: d.parent_uid
    };
  };

  onWaitlistSaved(): void {
    this.finishWaitlistDialog();
  }

  closeWaitlistDialog(): void {
    this.finishWaitlistDialog();
  }

  private finishWaitlistDialog(): void {
    this.showWaitlistDialog = false;

    // מעדכנים את מסך הבקשות גם במקרה שבו
    // האישור הצליח אך שמירת ההמתנה נכשלה.
    if (
      this.waitlistApprovedChild &&
      !this.waitlistApprovalReported
    ) {
      this.waitlistApprovalReported = true;

      this.approved.emit({
        requestId: this.request.id,
        newStatus: 'APPROVED'
      });

      this.onApproved?.({
        requestId: this.request.id,
        newStatus: 'APPROVED',
        message: 'הילד אושר במערכת'
      });
    }
  }

}
