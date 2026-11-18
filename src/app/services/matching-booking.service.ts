import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { Injectable, inject } from '@angular/core';
import { QuickAppointmentComponent } from '../pages/schedule/secretary-schedule/quick-appointment/quick-appointment.component';
import type { WeeklyMatchingCandidate } from './matching.service';
import { UiDialogService } from './ui-dialog.service';
import { defer, finalize, Observable, of, switchMap } from 'rxjs';
import { ACTIVE_CHILD_UPDATE } from './child-activation';
import { dbTenant, ensureTenantContextReady } from './legacy-compat';

@Injectable({ providedIn: 'root' })
export class MatchingBookingService {
    private readonly overlay = inject(Overlay);
    private readonly ui = inject(UiDialogService);

    open(
        candidate: WeeklyMatchingCandidate,
        childId: string,
        instructorName: string
    ): Observable<boolean> {
        return defer(() => {
            const controller = new AbortController();

            return defer(() =>
                this.prepareChildForBooking(candidate, childId, controller.signal)
            ).pipe(
                switchMap(ready =>
                    ready
                        ? this.openQuickAppointment(candidate, childId, instructorName)
                        : of(false)
                ),
                finalize(() => controller.abort())
            );
        });
    }

    private async prepareChildForBooking(
        candidate: WeeklyMatchingCandidate,
        childId: string,
        signal: AbortSignal
    ): Promise<boolean> {
        try {
            await ensureTenantContextReady();
            if (signal.aborted) return false;

            const db = dbTenant();
            const canContinue = await this.confirmQueuePriority(db, candidate, signal);
            if (!canContinue || signal.aborted) return false;
            const { data: child, error: readError } = await db
                .from('children')
                .select('status')
                .eq('child_uuid', childId)
                .maybeSingle();

            if (signal.aborted) return false;
            if (readError) throw readError;

            const status = child?.status;
            if (status === 'Pending Addition Approval') {
                await this.ui.alert(
                    'הילד/ה ממתין/ה לאישור הוספה למערכת. יש לאשר את בקשת ההוספה במסך ״בקשות ואישורים״ ולאחר מכן לחזור לשיבוץ.',
                    'נדרש אישור הוספת ילד/ה'
                );
                return false;
            }

            if (
                status === 'Active' ||
                status === 'Deletion Scheduled' ||
                status === 'Pending Deletion Approval'
            ) {
                return true;
            }

            const normalizedStatus = status?.toLowerCase();

            if (normalizedStatus !== 'deleted' && normalizedStatus !== 'inactive') {
                await this.ui.alert(
                    'לא ניתן לאמת את סטטוס הילד/ה לשיבוץ. יש לרענן את הרשימה.',
                    'לא ניתן לפתוח שיבוץ'
                );
                return false;
            }

            const confirmed = await this.ui.confirm({
                title: 'הפעלת ילד/ה לפני שיבוץ',
                message: 'הילד/ה אינו/ה פעיל/ה. האם להפעיל את הילד/ה ולפתוח את חלון השיבוץ?',
                okText: 'הפעלה ופתיחת שיבוץ',
                cancelText: 'ביטול',
                showCancel: true
            });

            if (!confirmed || signal.aborted) return false;

            const { data: updatedChild, error: updateError } = await db
                .from('children')
                .update(ACTIVE_CHILD_UPDATE)
                .eq('child_uuid', childId)
                .eq('status', status!)
                .select('status')
                .maybeSingle();

            if (signal.aborted) return false;
            if (updateError) throw updateError;
            if (updatedChild?.status === 'Active') return true;

            // ייתכן שהסטטוס השתנה בזמן שהודעת האישור הייתה פתוחה.
            const { data: currentChild, error: recheckError } = await db
                .from('children')
                .select('status')
                .eq('child_uuid', childId)
                .maybeSingle();

            if (signal.aborted) return false;
            if (recheckError) throw recheckError;
            if (currentChild?.status === 'Active') return true;

            await this.ui.alert(
                'לא ניתן היה לוודא שהילד/ה הופעל/ה. רענני את הרשימה ובדקי את הסטטוס.',
                'לא ניתן לפתוח שיבוץ'
            );
            return false;
        } catch (error) {
            console.error('Failed to verify or activate child for booking:', error);

            if (!signal.aborted) {
                await this.ui.alert(
                    'בדיקת הסטטוס או הפעלת הילד/ה נכשלה. אפשר לנסות שוב.',
                    'לא ניתן לפתוח שיבוץ'
                );
            }

            return false;
        }
    }

    private async confirmQueuePriority(
        db: ReturnType<typeof dbTenant>,
        candidate: WeeklyMatchingCandidate,
        signal: AbortSignal
    ): Promise<boolean> {
        const { data, error } = await db.rpc('matching_find_earlier_request', {
            p_entry_id: candidate.request_id,
            p_series_start_date: candidate.series_start_date,
            p_instructor_id: candidate.instructor_id,
            p_start_time: candidate.start_time,
            p_end_time: candidate.end_time,
            p_riding_type_id: candidate.riding_type_id,
            p_slot_kind: candidate.initial_slot_kind
        });

        if (signal.aborted) return false;

        if (error || !Array.isArray(data)) {
            await this.ui.alert(
                error?.message || 'לא ניתן לבדוק כרגע את סדר הקדימות בתור.',
                'לא ניתן לפתוח שיבוץ'
            );
            return false;
        }

        const earlierChildren = data as {
            request_id: string;
            child_name: string | null;
            priority: number;
            queue_position: number;
            reason: 'higher_priority' | 'earlier_position';
        }[];

        if (earlierChildren.length === 0) return true;

        const lines = earlierChildren.map(child => {
            const name = child.child_name || 'ילד/ה ללא שם';
            const reason = child.reason === 'higher_priority'
                ? 'עדיפות גבוהה יותר'
                : 'אותה עדיפות, מיקום מוקדם יותר';

            return `• ${name} — ${reason} (מקום ${child.queue_position} בעדיפות)`;
        });

        return this.ui.confirm({
            title: 'יש בקשות שקודמות בתור',
            message:
                `הילדים הבאים קודמים בתור ומתאימים למשבצת הזו:\n${lines.join('\n')}\n\n` +
                'האם להמשיך לשיבוץ?',
            okText: 'המשך לשיבוץ',
            cancelText: 'ביטול',
            showCancel: true
        });
    }

    private openQuickAppointment(
        candidate: WeeklyMatchingCandidate,
        childId: string,
        instructorName: string
    ): Observable<boolean> {
        return new Observable<boolean>(subscriber => {
            const overlayRef = this.overlay.create({
                positionStrategy: this.overlay.position().global()
                    .centerHorizontally()
                    .centerVertically(),
                scrollStrategy: this.overlay.scrollStrategies.block(),
                hasBackdrop: false,
                width: '100vw',
                height: '100dvh',
                panelClass: 'quick-booking-overlay-panel'
            });

            subscriber.add(() => overlayRef.dispose());

            const componentRef = overlayRef.attach(
                new ComponentPortal(QuickAppointmentComponent)
            );

            componentRef.setInput('date', candidate.series_start_date);
            componentRef.setInput('startTime', candidate.start_time);
            componentRef.setInput('endTime', candidate.end_time);
            componentRef.setInput('instructorId', candidate.instructor_id);
            componentRef.setInput('instructorName', instructorName);
            componentRef.setInput('matchingPrefill', {
                requestId: candidate.request_id,
                childId,
                ridingTypeId: candidate.riding_type_id,
                ridingTypeName: candidate.riding_type,
                slotKind: candidate.initial_slot_kind
            });

            let saved = false;

            subscriber.add(componentRef.instance.saved.subscribe(() => {
                saved = true;
            }));

            subscriber.add(componentRef.instance.close.subscribe(() => {
                subscriber.next(saved);
                subscriber.complete();

                if (saved) {
                    void this.ui.alert(
                        'השיבוץ נשמר ובקשת ההמתנה הוסרה.',
                        'השיבוץ הושלם'
                    );
                }
            }));
        });
    }
}