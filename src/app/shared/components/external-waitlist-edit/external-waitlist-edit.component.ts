import { CommonModule } from '@angular/common';
import {
    Component,
    EventEmitter,
    Input,
    Output,
    OnInit,
    inject
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiDialogService } from '../../../services/ui-dialog.service';

import {
    ExternalWaitlistRequest,
    ExternalWaitlistAvailability,
    WaitlistService
} from '../../../services/waitlist.service';

type FarmHours = {
    day_of_week: number;
    is_open: boolean;
    farm_start: string | null;
    farm_end: string | null;
};

type AvailableDay = {
    day: number;
    start: string;
};

@Component({
    selector: 'app-external-waitlist-edit',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './external-waitlist-edit.component.html',
    styleUrl: './external-waitlist-edit.component.scss'
})
export class ExternalWaitlistEditComponent implements OnInit {
    @Input({ required: true }) request!: ExternalWaitlistRequest;

    @Input() ridingTypes: { id: string; name: string }[] = [];
    @Input() farmHours: FarmHours[] = [];

    @Output() closed = new EventEmitter<void>();
    @Output() saved = new EventEmitter<void>();

    private readonly service = inject(WaitlistService);
    private readonly ui = inject(UiDialogService);

    saving = false;
    error = '';

    allRidingTypes = true;
    ridingTypeIds: string[] = [];
    ridingSearch = '';
    ridingOpen = false;

    allTimes = true;
    days: AvailableDay[] = [];

    parentName = '';
    phone = '';
    additionalPhone = '';
    email = '';

    healthFund = 'כללית';
    healthFundOther = '';

    previousRiding = '';
    previousRidingDetails = '';
    referralReasonText = '';

    readonly weekDays = [
        { id: 1, name: 'ראשון' },
        { id: 2, name: 'שני' },
        { id: 3, name: 'שלישי' },
        { id: 4, name: 'רביעי' },
        { id: 5, name: 'חמישי' },
        { id: 6, name: 'שישי' },
        { id: 7, name: 'שבת' }
    ];

    ngOnInit(): void {
        if (!this.request || this.request.status !== 'open') {
            this.error = 'לא ניתן לערוך בקשה שאינה פתוחה.';
            return;
        }

        this.ridingTypeIds = [...(this.request.riding_type_ids ?? [])];
        this.allRidingTypes = this.ridingTypeIds.length === 0;

        this.allTimes = this.request.availability?.mode === 'all';

        this.days = (this.request.availability?.days ?? []).map(item => ({
            day: item.day,
            start: item.start?.slice(0, 5) ?? ''
        }));

        this.parentName = this.request.parent_name ?? '';
        this.phone = this.request.phone ?? '';
        this.additionalPhone = this.request.additional_phone ?? '';
        this.email = this.request.email ?? '';

        this.healthFund = this.request.health_fund;
        this.healthFundOther = this.request.health_fund_other ?? '';

        this.previousRiding = this.request.previous_riding ?? '';
        this.previousRidingDetails =
            this.request.previous_riding_details ?? '';

        this.referralReasonText =
            this.request.referral_reason_text ?? '';
    }

    get age(): number | null {
        const value = this.request.birth_date;
        if (!value) return null;

        const [year, month, day] = value
            .slice(0, 10)
            .split('-')
            .map(Number);

        if (!year || !month || !day) return null;

        const now = new Date();
        let age = now.getFullYear() - year;

        if (
            now.getMonth() + 1 < month ||
            (
                now.getMonth() + 1 === month &&
                now.getDate() < day
            )
        ) {
            age--;
        }

        return age >= 0 ? age : null;
    }

    get filteredRidingTypes(): { id: string; name: string }[] {
        const query = this.ridingSearch.trim().toLowerCase();

        return this.ridingTypes.filter(type =>
            type.name.toLowerCase().includes(query)
        );
    }

    chooseAllRidingTypes(all: boolean): void {
        this.allRidingTypes = all;

        if (all) {
            this.ridingTypeIds = [];
        }

        this.ridingOpen = false;
        this.error = '';
    }

    toggleRidingType(id: string, selected: boolean): void {
        this.ridingTypeIds = selected
            ? [...new Set([...this.ridingTypeIds, id])]
            : this.ridingTypeIds.filter(item => item !== id);

        this.error = '';
    }

    get availableDays() {
        return this.weekDays.filter(day =>
            this.getHours(day.id) !== undefined
        );
    }

    getHours(day: number): FarmHours | undefined {
        return this.farmHours.find(hours =>
            hours.day_of_week === day &&
            hours.is_open === true &&
            !!hours.farm_start &&
            !!hours.farm_end &&
            hours.farm_start < hours.farm_end
        );
    }

    getDay(day: number): AvailableDay | undefined {
        return this.days.find(item => item.day === day);
    }

    toggleDay(day: number): void {
        if (this.getDay(day)) {
            this.days = this.days.filter(item => item.day !== day);
        } else {
            const hours = this.getHours(day);

            if (!hours?.farm_start) return;

            this.days = [
                ...this.days,
                { day, start: '' }
            ].sort((a, b) => a.day - b.day);
        }

        this.error = '';
    }

    setAllTimes(all: boolean): void {
        this.allTimes = all;

        if (all) {
            this.days = [];
        }

        this.error = '';
    }

    availabilitySummary(): string[] {
        if (this.allTimes) {
            return ['כל הימים והשעות'];
        }

        if (!this.days.length) {
            return ['לא נבחרו ימים'];
        }

        return this.days.map(item => {
            const name = this.weekDays.find(
                day => day.id === item.day
            )?.name ?? String(item.day);

            // בדיקת שעות לכל יום בנפרד
            if (this.getDayStartError(item.day)) {
                return `יום ${name}: יש לתקן שגיאות בשעות`;
            }

            const hours = this.getHours(item.day);

            const start =
                item.start?.slice(0, 5) ||
                hours?.farm_start ||
                '—';

            const end =
                hours?.farm_end?.slice(0, 5) ||
                '—';

            return `יום ${name}: ${start}–${end}`;
        });
    }

    cancel(): void {
        if (!this.saving) {
            this.closed.emit();
        }
    }

    async save(): Promise<void> {
        if (this.saving) return;

        this.error = '';
        if (this.hasInvalidAvailability) {
            this.error = 'יש לתקן את שעות הזמינות לפני השמירה.';
            return;
        }

        if (this.request.status !== 'open') {
            this.error = 'הבקשה אינה פתוחה.';
            return;
        }

        if (!this.allRidingTypes && !this.ridingTypeIds.length) {
            this.error = 'יש לבחור לפחות סוג רכיבה אחד.';
            return;
        }

        const validHealthFunds = [
            'כללית',
            'מכבי',
            'מאוחדת',
            'לאומית',
            'אחר'
        ];

        this.healthFund = this.healthFund?.trim() ?? '';

        if (!validHealthFunds.includes(this.healthFund)) {
            await this.ui.alert(
                'ערך קופת החולים אינו תקין. יש לבחור קופת חולים מהרשימה.',
                'לא ניתן לשמור את הבקשה'
            );
            return;
        }

        if (
            this.healthFund === 'אחר' &&
            !this.healthFundOther.trim()
        ) {
            await this.ui.alert(
                'יש להזין את שם קופת החולים.',
                'חסר מידע'
            );
            return;
        }

        if (
            this.email.trim() &&
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim())
        ) {
            this.error = 'כתובת המייל אינה תקינה.';
            return;
        }

        if (!this.allTimes) {
            if (!this.days.length) {
                this.error = 'יש לבחור לפחות יום אחד.';
                return;
            }

            for (const item of this.days) {
                const hours = this.getHours(item.day);
                const start = item.start?.slice(0, 5) || hours?.farm_start;

                if (
                    !hours?.farm_start ||
                    !hours.farm_end ||
                    !start ||
                    !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
                    start < hours.farm_start ||
                    start >= hours.farm_end
                ) {
                    const dayName = this.weekDays.find(
                        day => day.id === item.day
                    )?.name;

                    this.error =
                        `יש להזין שעת התחלה תקינה ביום ${dayName}.`;

                    return;
                }
            }
        }

        const availability: ExternalWaitlistAvailability =
            this.allTimes
                ? { mode: 'all', days: [] }
                : {
                    mode: 'specific',
                    days: this.days.map(item => ({
                        day: item.day,
                        start: item.start?.slice(0, 5) ||
                            this.getHours(item.day)!.farm_start!
                    }))
                };

        this.saving = true;

        try {
            await this.service.updateExternalRequest({
                requestId: this.request.id,
                parentName: this.parentName,
                phone: this.phone,
                additionalPhone: this.additionalPhone,
                email: this.email,
                healthFund: this.healthFund,
                healthFundOther: this.healthFundOther,
                previousRiding: this.previousRiding || null,
                previousRidingDetails: this.previousRidingDetails,
                referralReasonText: this.referralReasonText,
                ridingTypeIds: this.allRidingTypes
                    ? []
                    : this.ridingTypeIds,
                availability
            });

            this.saved.emit();

        } catch (error: any) {
            console.error('External request update failed:', error);

            this.saving = false;

            const message =
                error?.message === 'Invalid health fund'
                    ? 'קופת החולים שנשלחה אינה תקינה. יש לבדוק את הערך שנבחר.'
                    : error?.message ?? 'לא ניתן לשמור את השינויים.';

            await this.ui.alert(
                message,
                'שגיאה בשמירת הבקשה'
            );

        } finally {
            this.saving = false;
        }
    }

    validateDayStart(day: number): void {
        const selectedDay = this.getDay(day);
        const hours = this.getHours(day);

        if (!selectedDay || !hours?.farm_start || !hours.farm_end) {
            return;
        }

        const start = selectedDay.start?.slice(0, 5);

        // שדה ריק מייצג את תחילת שעות הפעילות.
        if (!start) {
            return;
        }

        // שעה מוקדמת מדי מתוקנת אוטומטית.
        if (start < hours.farm_start) {
            selectedDay.start = hours.farm_start;
        }

        this.error = '';
    }

    getDayStartError(day: number): string | null {
        const selectedDay = this.getDay(day);
        const hours = this.getHours(day);

        if (!selectedDay) {
            return null;
        }

        if (!hours?.farm_start || !hours.farm_end) {
            return 'לא נמצאו שעות פעילות תקינות לחווה.';
        }

        const start = selectedDay.start?.slice(0, 5);

        if (!start) {
            return null;
        }

        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) {
            return 'יש להזין שעה תקינה.';
        }

        if (start >= hours.farm_end) {
            return 'השעות חייבות להיות בתוך שעות הפעילות של החווה.';
        }

        return null;
    }

    get hasInvalidAvailability(): boolean {
        return !this.allTimes && (
            this.days.length === 0 ||
            this.days.some(day => this.getDayStartError(day.day) !== null)
        );
    }
}