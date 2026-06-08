import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { dbTenant, getCurrentUserData } from '../../services/legacy-compat';

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
@Component({
    selector: 'app-independent-horses',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './independent-horses.component.html',
    styleUrls: ['./independent-horses.component.scss'],
})
export class IndependentHorsesComponent implements OnInit {
    loading = true;
    error = '';
    horses: Horse[] = [];
    tasksByHorse: Record<string, HorseServiceTask[]> = {};
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
          horse_equipment,
          last_shoeing_date,
          next_shoeing_date,
          last_vaccination_date,
          next_vaccination_date,
          next_tetanus_date,
          next_rabies_date,
          next_flu_date,
          next_herpes_date,
          next_west_nile_date
        `)
                .eq('owner_rider_uid', user.uid)
                .order('name', { ascending: true });

            if (error) {
                this.error = error.message || 'שגיאה בטעינת הסוסים';
                return;
            }

            this.horses = data ?? [];
            await this.loadHorseTasks(user.uid);
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
}