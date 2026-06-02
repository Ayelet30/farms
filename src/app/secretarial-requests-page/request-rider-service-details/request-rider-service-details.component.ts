import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { UiRequest } from '../../Types/detailes.model';
import { dbTenant } from '../../services/legacy-compat';

@Component({
    selector: 'app-request-rider-service-details',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './request-rider-service-details.component.html',
    styleUrls: ['./request-rider-service-details.component.scss'],
})
export class RequestRiderServiceDetailsComponent {
    private _request = signal<UiRequest | null>(null);

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

    busy = false;
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
        if (!r?.id || this.busy) return;

        this.busy = true;
        this.errText = '';

        try {
            const db = dbTenant();

            const { error } = await db
                .from('secretarial_requests')
                .update({
                    status: 'APPROVED',
                    decided_by_uid: this.decidedByUid,
                    decided_at: new Date().toISOString(),
                    decision_note: this.decisionNote?.trim() || null,
                })
                .eq('id', r.id)
                .eq('status', 'PENDING');

            if (error) throw error;

            const ev = { requestId: r.id, newStatus: 'APPROVED' as const };
            this.onApproved?.(ev);
            this.approved.emit(ev);
        } catch (e: any) {
            const msg = e?.message || 'שגיאה באישור בקשת השירות';
            this.errText = msg;
            this.onError?.({ requestId: r?.id, message: msg, raw: e });
            this.error.emit(msg);
        } finally {
            this.busy = false;
        }
    }

    async reject() {
        const r = this.req();
        if (!r?.id || this.busy) return;

        this.busy = true;
        this.errText = '';

        try {
            const db = dbTenant();

            const { error } = await db
                .from('secretarial_requests')
                .update({
                    status: 'REJECTED',
                    decided_by_uid: this.decidedByUid,
                    decided_at: new Date().toISOString(),
                    decision_note: this.decisionNote?.trim() || null,
                })
                .eq('id', r.id)
                .eq('status', 'PENDING');

            if (error) throw error;

            const ev = { requestId: r.id, newStatus: 'REJECTED' as const };
            this.onRejected?.(ev);
            this.rejected.emit(ev);
        } catch (e: any) {
            const msg = e?.message || 'שגיאה בדחיית בקשת השירות';
            this.errText = msg;
            this.onError?.({ requestId: r?.id, message: msg, raw: e });
            this.error.emit(msg);
        } finally {
            this.busy = false;
        }
    }
}