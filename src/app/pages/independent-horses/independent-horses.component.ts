import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { dbTenant, getCurrentUserData } from '../../services/legacy-compat';
import { FormsModule } from '@angular/forms';
import { UiDialogService } from '../../services/ui-dialog.service';
import { inject } from '@angular/core';
type Horse = {
    id: string;
    name: string;
    age: number | null;
    color: string | null;
    gender: string | null;
    horse_size: string | null;
    is_active: boolean;
    notes: string | null;
    food_supplements: string | null;
    horse_equipment: string | null;
    last_shoeing_date: string | null;
    next_shoeing_date: string | null;
    last_vaccination_date: string | null;
    next_vaccination_date: string | null;
    next_tetanus_date: string | null;
    next_rabies_date: string | null;
    next_flu_date: string | null;
    next_herpes_date: string | null;
    next_west_nile_date: string | null;
};
type HorseTaskStatus = 'open' | 'completed' | 'cancelled';

type HorseServiceTask = {
    id: string;
    horse_uid: string;
    service_name: string;
    due_date: string;
    status: HorseTaskStatus;
    notes: string | null;
    cancellation_note: string | null;
    completed_at: string | null;
    cancelled_at: string | null;
};
type RiderServiceStatus = 'active' | 'completed' | 'cancelled';
type RiderService = {
    id: string;
    rider_uid: string;
    horse_uid: string;
    service_name: string;
    start_date: string;
    end_date: string | null;
    status: RiderServiceStatus;
    service_mode: string;
    cancellation_note: string | null;
    cancelled_at: string | null;
};
@Component({
    selector: 'app-independent-horses',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './independent-horses.component.html',
    styleUrls: ['./independent-horses.component.scss'],
})
export class IndependentHorsesComponent implements OnInit {
    loading = true;
    error = '';
    horses: Horse[] = [];
    tasksByHorse: Record<string, HorseServiceTask[]> = {};
    private ui = inject(UiDialogService);
    servicesByHorse: Record<string, RiderService[]> = {};
    editingHorseId: string | null = null;
    editHorseDraft: Partial<Horse> = {};
    pendingCancelledServiceIds = new Set<string>();
    pendingCancelledTaskIds = new Set<string>();
    async ngOnInit() {
        try {
            const user = await getCurrentUserData();

            if (!user?.uid) {
                this.error = 'משתמש לא מחובר';
                return;
            }

            const db = dbTenant();

            const { data, error } = await db
                .from('horses')
                .select(`
          id,
          name,
          age,
          color,
          gender,
          horse_size,
          is_active,
          notes,
          food_supplements,
          horse_equipment
          
        `)
                .eq('owner_rider_uid', user.uid)
                .order('name', { ascending: true });

            if (error) {
                this.error = error.message || 'שגיאה בטעינת הסוסים';
                return;
            }

            this.horses = data ?? [];
            await this.loadHorseTasks(user.uid);
            await this.loadHorseServices(user.uid);
        } catch (e: any) {
            this.error = e?.message || 'שגיאה לא צפויה';
        } finally {
            this.loading = false;
        }
    }

    genderLabel(value: string | null): string {
        switch (value) {
            case 'male': return 'זכר';
            case 'female': return 'נקבה';
            case 'gelding': return 'מסורס';
            default: return '—';
        }
    }

    sizeLabel(value: string | null): string {
        switch (value) {
            case 'pony_small': return 'פוני קטן';
            case 'pony_large': return 'פוני גדול';
            case 'horse': return 'סוס';
            default: return '—';
        }
    }

    dateText(value: string | null): string {
        if (!value) return '—';

        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '—';

        return d.toLocaleDateString('he-IL', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
        });
    }

    isSoon(value: string | null): boolean {
        if (!value) return false;

        const today = new Date();
        const target = new Date(value);
        if (Number.isNaN(target.getTime())) return false;

        today.setHours(0, 0, 0, 0);
        target.setHours(0, 0, 0, 0);

        const diffDays =
            (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);

        return diffDays >= 0 && diffDays <= 30;
    }

    isPast(value: string | null): boolean {
        if (!value) return false;

        const today = new Date();
        const target = new Date(value);
        if (Number.isNaN(target.getTime())) return false;

        today.setHours(0, 0, 0, 0);
        target.setHours(0, 0, 0, 0);

        return target.getTime() < today.getTime();
    }

    treatmentClass(value: string | null): string {
        if (this.isPast(value)) return 'danger';
        if (this.isSoon(value)) return 'soon';
        return '';
    }
    private async loadHorseTasks(riderUid: string): Promise<void> {
        const horseIds = this.horses.map(h => h.id);

        if (!horseIds.length) {
            this.tasksByHorse = {};
            return;
        }

        const { data, error } = await dbTenant()
            .from('rider_service_tasks')
            .select(`
      id,
      horse_uid,
      service_name,
      due_date,
      status,
      notes,
      cancellation_note,
      completed_at,
      cancelled_at
    `)
            .eq('rider_uid', riderUid)
            .in('horse_uid', horseIds)
            .order('due_date', { ascending: false });

        if (error) {
            console.error(error);
            return;
        }

        this.tasksByHorse = {};

        for (const task of (data ?? []) as HorseServiceTask[]) {
            if (!this.tasksByHorse[task.horse_uid]) {
                this.tasksByHorse[task.horse_uid] = [];
            }

            this.tasksByHorse[task.horse_uid].push(task);
        }
    }
    statusLabel(status: HorseTaskStatus): string {
        switch (status) {
            case 'open': return 'פתוח';
            case 'completed': return 'בוצע';
            case 'cancelled': return 'בוטל';
            default: return status;
        }
    }

    statusClass(status: HorseTaskStatus): string {
        switch (status) {
            case 'open': return 'open';
            case 'completed': return 'completed';
            case 'cancelled': return 'cancelled';
            default: return '';
        }
    }
    isOverdue(task: HorseServiceTask): boolean {
        if (task.status !== 'open') return false;
        if (!task.due_date) return false;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const due = new Date(task.due_date);
        due.setHours(0, 0, 0, 0);

        return due.getTime() < today.getTime();
    }
    daysLate(task: HorseServiceTask): number {
        if (!this.isOverdue(task)) return 0;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const due = new Date(task.due_date);
        due.setHours(0, 0, 0, 0);

        return Math.floor(
            (today.getTime() - due.getTime()) /
            (1000 * 60 * 60 * 24)
        );
    }
    private async loadHorseServices(riderUid: string): Promise<void> {
        const horseIds = this.horses.map(h => h.id);

        if (!horseIds.length) {
            this.servicesByHorse = {};
            return;
        }

        const { data, error } = await dbTenant()
            .from('rider_services')
            .select(`
      id,
      rider_uid,
      horse_uid,
      service_name,
      start_date,
      end_date,
      status,
      service_mode,
      cancellation_note,
      cancelled_at
    `)
            .eq('rider_uid', riderUid)
            .in('horse_uid', horseIds)
            .order('created_at', { ascending: false });

        if (error) {
            console.error(error);
            return;
        }

        this.servicesByHorse = {};

        for (const service of (data ?? []) as RiderService[]) {
            if (!this.servicesByHorse[service.horse_uid]) {
                this.servicesByHorse[service.horse_uid] = [];
            }

            this.servicesByHorse[service.horse_uid].push(service);
        }
    }
    startEditHorse(horse: Horse): void {
        this.editingHorseId = horse.id;
        this.editHorseDraft = {
            color: horse.color,
            is_active: horse.is_active,
        };

        this.pendingCancelledServiceIds.clear();
        this.pendingCancelledTaskIds.clear();
    }

    cancelEditHorse(): void {
        this.editingHorseId = null;
        this.editHorseDraft = {};
        this.pendingCancelledServiceIds.clear();
        this.pendingCancelledTaskIds.clear();
    }
    async saveHorseEdit(horse: Horse): Promise<void> {
        const newActive = this.editHorseDraft.is_active as boolean;
        const summary = this.buildEditSummary(horse);

        if (summary === 'לא בוצעו שינויים.') {
            await this.ui.alert('לא בוצעו שינויים לשמירה.', 'אין שינויים');
            return;
        }
        const ok = await this.ui.confirm({
            title: 'אישור שמירת שינויים',
            message: summary,
            dangerText: newActive === false
                ? 'הפיכת הסוס ללא פעיל תבטל את השירותים והמשימות העתידיות שלו.'
                : '',
            okText: 'כן, לשמור שינויים',
            cancelText: 'חזרה לעריכה',
            showCancel: true,
        });

        if (!ok) return;

        const db = dbTenant();

        const { error: horseError } = await db
            .from('horses')
            .update({
                color: this.editHorseDraft.color ?? null,
                is_active: newActive,
            })
            .eq('id', horse.id);

        if (horseError) {
            console.error(horseError);
            await this.ui.alert('שמירת הסוס נכשלה.', 'שגיאה');
            return;
        }

        if (this.pendingCancelledServiceIds.size) {
            const { error } = await db
                .from('rider_services')
                .update({
                    status: 'cancelled',
                    cancelled_at: new Date().toISOString(),
                    cancellation_note: 'השירות בוטל על ידי הרוכב',
                })
                .in('id', Array.from(this.pendingCancelledServiceIds));

            if (error) {
                console.error(error);
                await this.ui.alert('ביטול השירותים נכשל.', 'שגיאה');
                return;
            }
        }

        if (this.pendingCancelledTaskIds.size) {
            const { error } = await db
                .from('rider_service_tasks')
                .update({
                    status: 'cancelled',
                    cancelled_at: new Date().toISOString(),
                    cancellation_note: 'המשימה בוטלה על ידי הרוכב',
                })
                .in('id', Array.from(this.pendingCancelledTaskIds));

            if (error) {
                console.error(error);
                await this.ui.alert('ביטול המשימות נכשל.', 'שגיאה');
                return;
            }
        }

        horse.color = this.editHorseDraft.color ?? null;
        horse.is_active = newActive;

        this.cancelEditHorse();

        const user = await getCurrentUserData();
        if (user?.uid) {
            await this.loadHorseServices(user.uid);
            await this.loadHorseTasks(user.uid);
        }

        await this.ui.alert('השינויים נשמרו בהצלחה.', 'הצלחה');
    }
    cancelService(service: RiderService): void {
        if (service.status === 'cancelled') return;

        if (this.pendingCancelledServiceIds.has(service.id)) {
            this.pendingCancelledServiceIds.delete(service.id);
        } else {
            this.pendingCancelledServiceIds.add(service.id);
        }
    }
    cancelTask(task: HorseServiceTask): void {
        if (task.status !== 'open') return;

        if (this.pendingCancelledTaskIds.has(task.id)) {
            this.pendingCancelledTaskIds.delete(task.id);
        } else {
            this.pendingCancelledTaskIds.add(task.id);
        }
    }
    serviceStatusLabel(status: RiderServiceStatus): string {
        switch (status) {
            case 'active': return 'פעיל';
            case 'completed': return 'בוצע';
            case 'cancelled': return 'בוטל';
            default: return String(status);
        }
    }
    isServicePendingCancel(service: RiderService): boolean {
        return this.pendingCancelledServiceIds.has(service.id);
    }

    isTaskPendingCancel(task: HorseServiceTask): boolean {
        return this.pendingCancelledTaskIds.has(task.id);
    }

    private buildEditSummary(horse: Horse): string {
        const changes: string[] = [];

        const oldColor = horse.color || '—';
        const newColor = String(this.editHorseDraft.color ?? '').trim() || '—';

        if (oldColor !== newColor) {
            changes.push(`צבע: ${oldColor} ← ${newColor}`);
        }

        const newActive = this.editHorseDraft.is_active as boolean;

        if (horse.is_active !== newActive) {
            changes.push(`סטטוס סוס: ${horse.is_active ? 'פעיל' : 'לא פעיל'} ← ${newActive ? 'פעיל' : 'לא פעיל'}`);
        }

        const services = this.servicesByHorse[horse.id] || [];
        const tasks = this.tasksByHorse[horse.id] || [];

        const cancelledServices = services.filter(s => this.pendingCancelledServiceIds.has(s.id));
        const cancelledTasks = tasks.filter(t => this.pendingCancelledTaskIds.has(t.id));

        if (cancelledServices.length) {
            changes.push(
                `שירותים לביטול: ${cancelledServices.map(s => s.service_name).join(', ')}`
            );
        }

        if (cancelledTasks.length) {
            changes.push(
                `משימות לביטול: ${cancelledTasks.map(t => t.service_name).join(', ')}`
            );
        }

        if (!changes.length) {
            return 'לא בוצעו שינויים.';
        }

        return changes.map(change => change.trim()).join('\n\n');
    }
}