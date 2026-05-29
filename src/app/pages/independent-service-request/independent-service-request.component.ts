import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant, getCurrentUserData } from '../../services/legacy-compat';

type RiderServiceType = {
    id: string;
    name: string;
    category: string;
    default_price_agorot: number;
    is_recurring: boolean;
    default_recurrence_unit: string | null;
    default_recurrence_interval: number | null;
    requires_approval: boolean;
    notes: string | null;
};

type HorseOption = {
    id: string;
    name: string;
    is_active: boolean;
};

@Component({
    selector: 'app-independent-service-request',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './independent-service-request.component.html',
    styleUrls: ['./independent-service-request.component.scss'],
})
export class IndependentServiceRequestComponent implements OnInit {
    loading = true;
    submitting = false;
    error = '';
    success = '';

    userUid = '';

    serviceTypes: RiderServiceType[] = [];
    horses: HorseOption[] = [];
    approvalFileError = '';
    plannedDates: string[] = [];
    form = {
        service_type_id: '',
        horse_uid: '',
        requested_start_date: '',
        requested_end_date: '',
        service_mode: 'once' as 'once' | 'recurring_range' | 'permanent',
        notes: '',
        approval_file: null as File | null,
    };

    async ngOnInit() {
        try {
            const user = await getCurrentUserData();

            if (!user?.uid) {
                this.error = 'משתמש לא מחובר';
                return;
            }

            this.userUid = user.uid;

            await Promise.all([
                this.loadServiceTypes(),
                this.loadHorses(),
            ]);

        } catch (e: any) {
            this.error = e?.message || 'שגיאה בטעינת הנתונים';
        } finally {
            this.loading = false;
        }
    }

    private async loadServiceTypes() {
        const db = dbTenant();

        const { data, error } = await db
            .from('rider_service_types')
            .select(`
        id,
        name,
        category,
        default_price_agorot,
        is_recurring,
        default_recurrence_unit,
        default_recurrence_interval,
        requires_approval,
        notes
      `)
            .eq('is_active', true)
            .order('category', { ascending: true })
            .order('name', { ascending: true });

        if (error) throw error;

        this.serviceTypes = data ?? [];
    }

    private async loadHorses() {
        const db = dbTenant();

        const { data, error } = await db
            .from('horses')
            .select('id, name, is_active')
            .eq('owner_rider_uid', this.userUid)
            .eq('is_active', true)
            .order('name', { ascending: true });

        if (error) throw error;

        this.horses = data ?? [];
    }

    get selectedService(): RiderServiceType | null {
        return this.serviceTypes.find(x => x.id === this.form.service_type_id) ?? null;
    }

    get selectedHorse(): HorseOption | null {
        return this.horses.find(x => x.id === this.form.horse_uid) ?? null;
    }

    categoryLabel(category: string): string {
        switch (category) {
            case 'boarding': return 'פנסיון';
            case 'medical': return 'רפואי';
            case 'maintenance': return 'תחזוקה';
            case 'general': return 'כללי';
            default: return category;
        }
    }

    recurrenceText(service: RiderServiceType | null): string {
        if (!service?.is_recurring) return 'חד פעמי';

        const interval = service.default_recurrence_interval ?? 1;

        switch (service.default_recurrence_unit) {
            case 'day': return `כל ${interval} יום`;
            case 'week': return `כל ${interval} שבוע`;
            case 'month': return `כל ${interval} חודש`;
            default: return 'מחזורי';
        }
    }

    priceText(agorot: number | null | undefined): string {
        const value = (agorot ?? 0) / 100;
        return `${value.toLocaleString('he-IL')} ₪`;
    }

    private validate(): boolean {
        this.error = '';
        this.success = '';
        this.approvalFileError = '';

        const service = this.selectedService;

        if (!this.form.service_type_id || !service) {
            this.error = 'יש לבחור סוג שירות';
            return false;
        }

        if (!this.form.horse_uid) {
            this.error = 'יש לבחור סוס';
            return false;
        }
        if (!this.form.requested_start_date) {
            this.error = this.isOnceMode
                ? 'יש לבחור תאריך ביצוע'
                : 'יש לבחור תאריך התחלה';
            return false;
        }

        if (this.isRecurringRangeMode && !this.form.requested_end_date) {
            this.error = 'יש לבחור תאריך סיום לשירות מחזורי';
            return false;
        }

        if (
            this.isRecurringRangeMode &&
            this.form.requested_end_date < this.form.requested_start_date
        ) {
            this.error = 'תאריך סיום לא יכול להיות לפני תאריך התחלה';
            return false;
        }
        if (service.requires_approval && !this.form.approval_file) {
            this.approvalFileError = 'חובה לצרף אישור עבור שירות זה';
            return false;
        }

        return true;
    }

    async submit() {
        if (this.submitting) return;
        if (!this.validate()) return;

        const service = this.selectedService;
        const horse = this.selectedHorse;

        if (!service || !horse) {
            this.error = 'בחירה לא תקינה';
            return;
        }

        this.submitting = true;
        this.error = '';
        this.success = '';
        let approvalFilePayload: any = null;

        if (this.form.approval_file) {
            approvalFilePayload = await this.uploadApprovalFile(this.form.approval_file);
        }

        try {
            const db = dbTenant();

            const payload = {
                rider_uid: this.userUid,

                service_type_id: service.id,
                service_name: service.name,
                service_category: service.category,

                horse_uid: horse.id,
                horse_name: horse.name,

                default_price_agorot: service.default_price_agorot,
                is_recurring: service.is_recurring,
                default_recurrence_unit: service.default_recurrence_unit,
                default_recurrence_interval: service.default_recurrence_interval,

                notes: this.form.notes?.trim() || null,
                service_mode: this.form.service_mode,

                requested_recurrence_unit:
                    this.isRecurringRangeMode || this.isPermanentMode
                        ? service.default_recurrence_unit
                        : null,

                requested_recurrence_interval:
                    this.isRecurringRangeMode || this.isPermanentMode
                        ? service.default_recurrence_interval
                        : null,
                requested_start_date: this.form.requested_start_date,

                requested_end_date: this.isRecurringRangeMode
                    ? this.form.requested_end_date
                    : null,

                is_permanent: this.isPermanentMode,

                planned_dates: this.isRecurringRangeMode
                    ? this.plannedDates
                    : [],
                summary: this.buildSummary(service.name, horse.name),
                service_settings: {
                    category: service.category,
                    default_price_agorot: service.default_price_agorot,
                    is_recurring: service.is_recurring,
                    default_recurrence_unit: service.default_recurrence_unit,
                    default_recurrence_interval: service.default_recurrence_interval,
                    requires_approval: service.requires_approval,
                    notes: service.notes,
                },


                approval_file: approvalFilePayload,
            };

            const { error } = await db
                .from('secretarial_requests')
                .insert({
                    request_type: 'RIDER_SERVICE_REQUEST',
                    status: 'PENDING',
                    requested_by_uid: this.userUid,
                    requested_by_role: 'independent',
                    child_id: null,
                    instructor_id: null,
                    lesson_occ_id: null,
                    from_date: this.form.requested_start_date,

                    to_date: this.isRecurringRangeMode
                        ? this.form.requested_end_date
                        : this.form.requested_start_date,
                    payload,
                });

            if (error) throw error;

            this.success = 'הבקשה נשלחה למזכירות בהצלחה ✅';

            this.form = {
                service_type_id: '',
                horse_uid: '',
                requested_start_date: '',
                requested_end_date: '',
                service_mode: 'once' as 'once' | 'recurring_range' | 'permanent', notes: '',
                approval_file: null as File | null,

            };

        } catch (e: any) {
            this.error = e?.message || 'שגיאה בשליחת הבקשה';
        } finally {
            this.submitting = false;
        }
    }


    onServiceChanged() {
        const service = this.selectedService;

        if (!service) {
            this.form.service_mode = 'once';
            return;
        }

        this.form.service_mode = service.is_recurring ? 'recurring_range' : 'once';

        this.form.requested_start_date = '';
        this.form.requested_end_date = '';
        this.plannedDates = [];

        this.recalculatePlannedDates();
    }

    recalculatePlannedDates() {
        this.plannedDates = [];

        const service = this.selectedService;

        if (
            !service ||
            !service.is_recurring ||
            !this.isRecurringRangeMode ||
            !this.form.requested_start_date ||
            !this.form.requested_end_date ||
            !service.default_recurrence_unit ||
            !service.default_recurrence_interval
        ) {
            return;
        }

        const start = new Date(this.form.requested_start_date);
        const end = new Date(this.form.requested_end_date);

        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
        if (end < start) return;

        const dates: string[] = [];
        const current = new Date(start);

        while (current <= end && dates.length < 100) {
            dates.push(current.toISOString().slice(0, 10));

            switch (service.default_recurrence_unit) {
                case 'day':
                    current.setDate(current.getDate() + service.default_recurrence_interval);
                    break;

                case 'week':
                    current.setDate(current.getDate() + service.default_recurrence_interval * 7);
                    break;

                case 'month':
                    current.setMonth(current.getMonth() + service.default_recurrence_interval);
                    break;
            }
        }

        this.plannedDates = dates;
    }
    onApprovalFileSelected(event: Event) {
        this.approvalFileError = '';

        const input = event.target as HTMLInputElement;
        const file = input.files?.[0] ?? null;

        if (!file) {
            this.form.approval_file = null;
            return;
        }

        const allowed = [
            'application/pdf',
            'image/jpeg',
            'image/png',
        ];

        if (!allowed.includes(file.type)) {
            this.approvalFileError = 'ניתן לצרף רק PDF או תמונה';
            this.form.approval_file = null;
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            this.approvalFileError = 'הקובץ גדול מדי. מקסימום 5MB';
            this.form.approval_file = null;
            return;
        }

        this.form.approval_file = file;
    }

    private async uploadApprovalFile(file: File): Promise<{
        bucket: string;
        path: string;
        name: string;
        type: string;
        size: number;
    }> {
        const db = dbTenant();

        const safeName = file.name
            .replace(/\s+/g, '_')
            .replace(/[^\w.\-א-ת]/g, '');

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        const filePath =
            `moacha_atarim_app/${this.userUid}/${timestamp}-${safeName}`;

        const { error } = await db.storage
            .from('rider-service-approvals')
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false,
                contentType: file.type,
            });

        if (error) {
            throw new Error(`שגיאה בהעלאת הקובץ: ${error.message}`);
        }

        return {
            bucket: 'rider-service-approvals',
            path: filePath,
            name: file.name,
            type: file.type,
            size: file.size,
        };
    }
    get isRecurringService(): boolean {
        return !!this.selectedService?.is_recurring;
    }

    get isOnceMode(): boolean {
        return this.form.service_mode === 'once';
    }

    get isRecurringRangeMode(): boolean {
        return this.form.service_mode === 'recurring_range';
    }

    get isPermanentMode(): boolean {
        return this.form.service_mode === 'permanent';
    }
    onServiceModeChanged() {
        this.form.requested_start_date = '';
        this.form.requested_end_date = '';
        this.plannedDates = [];
    }
    private buildSummary(serviceName: string, horseName: string): string {
        if (this.isOnceMode) {
            return `בקשה לשירות "${serviceName}" עבור הסוס/ה ${horseName} בתאריך ${this.form.requested_start_date}`;
        }

        if (this.isRecurringRangeMode) {
            return `בקשה לשירות "${serviceName}" עבור הסוס/ה ${horseName} באופן מחזורי מתאריך ${this.form.requested_start_date} עד ${this.form.requested_end_date}`;
        }

        return `בקשה לשירות "${serviceName}" עבור הסוס/ה ${horseName} כשירות קבוע החל מתאריך ${this.form.requested_start_date}`;
    }
}