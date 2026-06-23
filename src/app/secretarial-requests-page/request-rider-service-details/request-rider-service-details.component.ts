import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { UiRequest } from '../../Types/detailes.model';
import { dbTenant } from '../../services/legacy-compat';
import { inject } from '@angular/core';
import { getAuth } from 'firebase/auth';
import { RequestValidationService } from '../../services/request-validation.service';
import { ensureTenantContextReady, requireTenant } from '../../services/supabaseClient.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIcon } from "@angular/material/icon";
@Component({
    selector: 'app-request-rider-service-details',
    standalone: true,
    imports: [CommonModule, FormsModule, MatProgressSpinnerModule, MatIcon],
    templateUrl: './request-rider-service-details.component.html',
    styleUrls: ['./request-rider-service-details.component.scss'],
})
export class RequestRiderServiceDetailsComponent {
    private _request = signal<UiRequest | null>(null);
    private validation = inject(RequestValidationService);
    @Input({ required: true })
    set request(value: UiRequest) {
        this._request.set(value);

    }

    req = this._request;

    @Input() decidedByUid: string | null = null;
    @Input() onApproved?: (e: { requestId: string; newStatus: 'APPROVED' }) => void;
    @Input() onRejected?: (e: { requestId: string; newStatus: 'REJECTED' }) => void;
    @Input() onError?: (e: { requestId?: string; message: string; raw?: any }) => void;

    @Output() approved = new EventEmitter<{ requestId: string; newStatus: 'APPROVED' }>();
    @Output() rejected = new EventEmitter<{ requestId: string; newStatus: 'REJECTED' }>();
    @Output() error = new EventEmitter<string>();

    busy = signal(false);
    action = signal<'approve' | 'reject' | null>(null);

    busyText = computed(() => {
        switch (this.action()) {
            case 'approve': return 'הבקשה בתהליך אישור…';
            case 'reject': return 'הבקשה בתהליך דחייה…';
            default: return 'מעבד…';
        }
    });
    decisionNote = '';
    errText = '';

    get p(): any {
        return this.req()?.payload ?? {};
    }

    get serviceModeLabel(): string {
        switch (this.p.service_mode) {
            case 'once': return 'חד־פעמי';
            case 'recurring_range': return 'מחזורי לתקופה';
            case 'permanent': return 'קבוע ללא תאריך סיום';
            default: return '—';
        }
    }

    get categoryLabel(): string {
        switch (this.p.service_category || this.p.service_settings?.category) {
            case 'boarding': return 'פנסיון';
            case 'medical': return 'רפואי';
            case 'maintenance': return 'תחזוקה';
            case 'general': return 'כללי';
            default: return '—';
        }
    }

    get priceText(): string {
        const agorot =
            this.p.default_price_agorot ??
            this.p.service_settings?.default_price_agorot ??
            0;

        return `${(agorot / 100).toLocaleString('he-IL')} ₪`;
    }

    get recurrenceText(): string {
        if (this.p.service_mode === 'once') {
            return 'חד־פעמי';
        }

        if (this.p.service_mode === 'permanent') {
            return 'קבוע ללא תאריך סיום';
        }

        const unit =
            this.p.requested_recurrence_unit ??
            this.p.service_settings?.default_recurrence_unit;

        const interval =
            this.p.requested_recurrence_interval ??
            this.p.service_settings?.default_recurrence_interval ??
            1;

        if (!unit) return 'מחזורי';

        switch (unit) {
            case 'day':
                return `כל ${interval} יום`;

            case 'week':
                return `כל ${interval} שבוע`;

            case 'month':
                return `כל ${interval} חודש`;

            default:
                return 'מחזורי';
        }
    }

    dateText(v: string | null | undefined): string {
        if (!v) return '—';
        return new Date(v).toLocaleDateString('he-IL', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
        });
    }
    async approve() {
        const r = this.req();
        if (!r?.id || this.busy()) return;

        this.busy.set(true);
        this.action.set('approve');
        this.errText = '';

        try {
            const validation = await this.validation.validate(r, 'approve');
            if (!validation.ok) {
                const reason = validation.reason ?? 'הבקשה אינה תקינה';

                await this.rejectBySystem(reason);

                throw new Error(`הבקשה נדחתה אוטומטית: ${reason}`);
            }

            await this.callRiderServiceDecisionFunction(
                'approveRiderServiceRequestAndNotify',
                r.id
            );

            const ev = { requestId: r.id, newStatus: 'APPROVED' as const };
            this.onApproved?.(ev);
            this.approved.emit(ev);
        } catch (e: any) {
            const msg = e?.message || 'שגיאה באישור בקשת השירות';
            this.errText = msg;
            this.onError?.({ requestId: r?.id, message: msg, raw: e });
            this.error.emit(msg);
        } finally {
            this.busy.set(false);
            this.action.set(null);
        }
    }
    async reject() {
        const r = this.req();
        if (!r?.id || this.busy()) return;

        this.busy.set(true);
        this.action.set('reject');
        this.errText = '';

        try {
            const validation = await this.validation.validate(r, 'reject');
            if (!validation.ok) {
                const reason = validation.reason ?? 'הבקשה אינה תקינה';

                await this.rejectBySystem(reason);

                throw new Error(`הבקשה נדחתה אוטומטית: ${reason}`);
            }

            await this.callRiderServiceDecisionFunction(
                'rejectRiderServiceRequestAndNotify',
                r.id
            );

            const ev = { requestId: r.id, newStatus: 'REJECTED' as const };
            this.onRejected?.(ev);
            this.rejected.emit(ev);
        } catch (e: any) {
            const msg = e?.message || 'שגיאה בדחיית בקשת השירות';
            this.errText = msg;
            this.onError?.({ requestId: r?.id, message: msg, raw: e });
            this.error.emit(msg);
        } finally {
            this.busy.set(false);
            this.action.set(null);
        }
    }
    get approvalFileUrl(): string | null {
        const path = this.p?.approval_file?.path;
        if (!path) return null;

        const db = dbTenant();

        const { data } = db
            .storage
            .from('rider-service-approvals') // לשנות לשם הבאקט שלך
            .getPublicUrl(path);

        return data.publicUrl;
    }
    private async callRiderServiceDecisionFunction(
        functionName: 'approveRiderServiceRequestAndNotify' | 'rejectRiderServiceRequestAndNotify',
        requestId: string
    ) {
        await ensureTenantContextReady();

        const tenant = requireTenant();

        const token = await getAuth().currentUser?.getIdToken();

        if (!token) throw new Error('המשתמש לא מחובר');

        const res = await fetch(
            `https://us-central1-bereshit-ac5d8.cloudfunctions.net/${functionName}`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    tenantSchema: tenant.schema,
                    tenantId: tenant.id,
                    requestId,
                    decisionNote: this.decisionNote?.trim() || null,
                }),
            }
        );

        const json = await res.json().catch(() => ({}));

        if (!res.ok || json?.ok === false) {
            throw new Error(json?.message || json?.error || 'שגיאה בטיפול בבקשה');
        }

        return json;
    }
    private async rejectBySystem(reason: string): Promise<void> {
        const r = this.req();
        if (!r?.id) return;

        try {
            await ensureTenantContextReady();

            const tenant = requireTenant();
            const idToken = await getAuth().currentUser?.getIdToken();

            if (!idToken) throw new Error('המשתמש לא מחובר');

            const res = await fetch(
                'https://us-central1-bereshit-ac5d8.cloudfunctions.net/autoRejectRequestAndNotify',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${idToken}`,
                    },
                    body: JSON.stringify({
                        tenantSchema: tenant.schema,
                        requestId: r.id,
                        reason,
                        decidedByUid: this.decidedByUid ?? null,
                    }),
                }
            );

            const json = await res.json().catch(() => ({}));

            if (!res.ok || json?.ok === false) {
                throw new Error(json?.message || json?.error || 'שגיאה בדחייה אוטומטית');
            }

            const ev = {
                requestId: r.id,
                newStatus: 'REJECTED_BY_SYSTEM' as const,
            };

            this.onRejected?.(ev as any);
            this.rejected.emit(ev as any);

        } catch (e) {
            console.error('rejectBySystem failed', e);
            throw e;
        }
    }
}