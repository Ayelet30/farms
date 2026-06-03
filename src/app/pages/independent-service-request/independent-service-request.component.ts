import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { getCurrentUserData } from '../../services/legacy-compat';
import { dbTenant, supabase } from '../../services/supabaseClient.service';
import { createClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';


type RiderServiceType = {
    id: string;
    name: string;
    category: string;
    default_price_agorot: number;
    requires_approval: boolean;
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
        recurrence_unit: 'month' as 'day' | 'week' | 'month',
        recurrence_interval: 1,

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
      requires_approval
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
        const today = this.todayYmd();

        if (this.form.requested_start_date < today) {
            this.error = this.isOnceMode
                ? 'תאריך הביצוע לא יכול להיות לפני היום.'
                : 'תאריך ההתחלה לא יכול להיות לפני היום.';
            return false;
        }
        if (this.isRecurringRangeMode && !this.form.requested_end_date) {
            this.error = 'יש לבחור תאריך סיום לשירות מחזורי';
            return false;
        }

        if (
            this.isRecurringRangeMode &&
            this.form.requested_end_date <= this.form.requested_start_date
        ) {
            this.error = 'תאריך סיום חייב להיות אחרי תאריך ההתחלה';
            return false;
        }

        if (service.requires_approval && !this.form.approval_file) {
            this.approvalFileError = 'חובה לצרף אישור עבור שירות זה';
            return false;
        }

        return true;
    }

    async submit(event?: Event) {
        event?.preventDefault();
        event?.stopPropagation();

        if (this.submitting) return;

        if (!this.validate()) {
            this.scrollToError();
            return;
        } if (this.submitting) return;
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
            let approvalFilePayload: any = null;
            if (this.form.approval_file) {
                approvalFilePayload = await this.uploadApprovalFile(this.form.approval_file);
            }
            const payload = {
                rider_uid: this.userUid,

                service_type_id: service.id,
                service_name: service.name,
                service_category: service.category,

                horse_uid: horse.id,
                horse_name: horse.name,

                default_price_agorot: service.default_price_agorot,

                notes: this.form.notes?.trim() || null,

                summary: this.buildSummary(service.name, horse.name),
                approval_file: approvalFilePayload,
                service_mode: this.form.service_mode,

                requested_start_date: this.form.requested_start_date,

                requested_end_date: this.isRecurringRangeMode
                    ? this.form.requested_end_date
                    : null,


                recurrence_unit: this.isOnceMode ? null : this.form.recurrence_unit,
                recurrence_interval: this.isOnceMode ? null : this.form.recurrence_interval,

                planned_dates: this.isRecurringRangeMode
                    ? this.plannedDates
                    : [],

                service_settings: {
                    category: service.category,
                    default_price_agorot: service.default_price_agorot,
                    requires_approval: service.requires_approval,
                },
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
                service_mode: 'once',
                recurrence_unit: 'month',
                recurrence_interval: 1,
                notes: '',
                approval_file: null,
            };

        } catch (e: any) {
            this.error = e?.message || 'שגיאה בשליחת הבקשה';
        } finally {
            this.submitting = false;
        }
    }

    onServiceChanged() {
        this.form.requested_start_date = '';
        this.form.requested_end_date = '';
        this.form.service_mode = 'once';
        this.form.recurrence_unit = 'month';
        this.form.recurrence_interval = 1;
        this.plannedDates = [];
    }
    recalculatePlannedDates() {
        this.plannedDates = [];

        if (
            !this.isRecurringRangeMode ||
            !this.form.requested_start_date ||
            !this.form.requested_end_date ||
            !this.form.recurrence_unit ||
            !this.form.recurrence_interval
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

            switch (this.form.recurrence_unit) {
                case 'day':
                    current.setDate(current.getDate() + this.form.recurrence_interval);
                    break;

                case 'week':
                    current.setDate(current.getDate() + this.form.recurrence_interval * 7);
                    break;

                case 'month':
                    current.setMonth(current.getMonth() + this.form.recurrence_interval);
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
        publicUrl: string;
        name: string;
        type: string;
        size: number;
    }> {
        if (!supabase) {
            throw new Error('Supabase client is not initialized');
        }

        const ext = file.name.split('.').pop()?.toLowerCase() || 'file';

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        const random = Math.random().toString(36).slice(2, 10);

        const filePath = `${this.userUid}/${timestamp}-${random}.${ext}`;


        const { error } = await supabase.storage
            .from('rider-service-approvals')
            .upload(filePath, file, {
                upsert: true,
                contentType: file.type,
            });

        if (error) {
            console.error('UPLOAD RIDER SERVICE APPROVAL ERROR', error);
            throw new Error(`שגיאה בהעלאת הקובץ: ${error.message}`);
        }

        const { data } = supabase.storage
            .from('rider-service-approvals')
            .getPublicUrl(filePath);

        return {
            bucket: 'rider-service-approvals',
            path: filePath,
            publicUrl: data.publicUrl,
            name: file.name,
            type: file.type,
            size: file.size,
        };
    }

    get isOnceMode(): boolean {
        return this.form.service_mode === 'once';
    }

    get isRecurringRangeMode(): boolean {
        return this.form.service_mode === 'recurring_range';
    }

    onServiceModeChanged() {
        this.form.requested_start_date = '';
        this.form.requested_end_date = '';
        this.form.recurrence_unit = 'month';
        this.form.recurrence_interval = 1;
        this.plannedDates = [];
    } private buildSummary(serviceName: string, horseName: string): string {
        const start = this.formatDateIl(this.form.requested_start_date);
        const end = this.formatDateIl(this.form.requested_end_date);

        if (this.isOnceMode) {
            return `בקשה לשירות "${serviceName}" עבור הסוס/ה ${horseName} בתאריך ${start}`;
        }

        if (this.isRecurringRangeMode) {
            return `בקשה לשירות "${serviceName}" עבור הסוס/ה ${horseName} באופן מחזורי מתאריך ${start} עד ${end}`;
        }

        return `בקשה לשירות "${serviceName}" עבור הסוס/ה ${horseName} כשירות קבוע החל מתאריך ${start}`;
    }

    private async fixedServiceAlreadyExists(): Promise<boolean> {
        const service = this.selectedService;

        if (!service || !this.isOnceMode) return false;
        if (!this.form.horse_uid) return false;

        const db = dbTenant();

        const { data, error } = await db
            .from('rider_services')
            .select('id')
            .eq('rider_uid', this.userUid)
            .eq('horse_uid', this.form.horse_uid)
            .eq('service_type_id', service.id)
            .eq('service_mode', 'once')
            .eq('start_date', this.form.requested_start_date)
            .in('status', ['active', 'completed'])
            .limit(1);

        if (error) throw error;

        return !!data?.length;
    }
    private storageClient = createClient(
        environment.supabaseUrl,
        environment.supabaseAnonKey
    );
    private todayYmd(): string {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    private scrollToError(): void {
        setTimeout(() => {
            const el =
                document.querySelector('.state-card.error') ||
                document.querySelector('.error-text') ||
                document.querySelector('.field-error');

            if (el) {
                el.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                });
            }
        }, 0);
    }
    private formatDateIl(date: string): string {
        if (!date) return '';

        const d = new Date(date);

        return d.toLocaleDateString('he-IL', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        });
    }
}