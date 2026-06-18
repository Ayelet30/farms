import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { dbTenant } from '../../services/supabaseClient.service';
import { MatDialog } from '@angular/material/dialog';
import { inject } from '@angular/core';
import { RiderCreditDialogComponent } from './rider-credit-dialog.component';
import { RiderAdditionalChargeDialogComponent } from './rider-additional-charge-dialog.component';

type RiderChargeRow = {
    id: string;
    rider_uid: string;
    rider_name: string | null;
    rider_phone: string | null;
    rider_email: string | null;
    amount_agorot: number;
    paid_agorot: number;
    remaining_agorot: number;
    status: string;
    billing_month: string;
    period_start: string | null;
    period_end: string | null;
    description: string | null;
    office_note: string | null;
    created_at: string;
    credits_agorot: number;
};

@Component({
    selector: 'app-secretary-rider-billing',
    standalone: true,
    imports: [CommonModule, FormsModule, MatIconModule],
    templateUrl: './secretary-rider-billing.component.html',
    styleUrls: ['./secretary-rider-billing.component.scss'],
})
export class SecretaryRiderBillingComponent implements OnInit {
    charges = signal<RiderChargeRow[]>([]);
    selectedChargeIds = signal<Set<string>>(new Set());
    detailsCredits = signal<any[]>([]);

    detailsCreditsTotalAgorot = computed(() => {
        return (this.detailsCredits() ?? [])
            .reduce((sum, c) => sum + Number(c.amount_agorot ?? 0), 0);
    });
    loading = signal(false);
    hasLoadedOnce = signal(false);
    error = signal<string | null>(null);
    successMessage = signal<string | null>(null);
    unbilledWarning = signal<string | null>(null);

    riderNameFilter = signal('');
    billingRunDate = signal(new Date().toISOString().slice(0, 10));
    activeTab = signal<'open' | 'all'>('open');

    detailsOpenFor = signal<string | null>(null);
    detailsLoading = signal(false);
    detailsError = signal<string | null>(null);
    detailsItems = signal<any[]>([]);
    private dialog = inject(MatDialog);
    async ngOnInit() {
        await this.loadCharges();
    }

    openCharges = computed(() => {
        return this.charges().filter(c =>
            this.remainingAgorot(c) > 0 && c.status !== 'cancelled'
        );
    });

    visibleCharges = computed(() => {
        const base = this.activeTab() === 'open'
            ? this.openCharges()
            : this.charges();

        const filter = this.riderNameFilter().trim().toLowerCase();

        if (!filter) return base;

        return base.filter(c =>
            String(c.rider_name || '').toLowerCase().includes(filter)
        );
    });

    visibleChargeGroups = computed(() => {
        const map = new Map<string, RiderChargeRow[]>();

        for (const c of this.visibleCharges()) {
            const key = String(c.billing_month || c.created_at).slice(0, 7);
            const arr = map.get(key) ?? [];
            arr.push(c);
            map.set(key, arr);
        }

        return Array.from(map.entries())
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([monthKey, rows]) => ({
                monthKey,
                title: this.formatMonthTitle(monthKey),
                rows,
                totalAgorot: rows.reduce((sum, c) => sum + Number(c.amount_agorot || 0), 0),
                paidAgorot: rows.reduce((sum, c) => sum + Number(c.paid_agorot || 0), 0),
                remainingAgorot: rows.reduce((sum, c) => sum + this.remainingAgorot(c), 0),
                openCount: rows.filter(c => this.remainingAgorot(c) > 0 && c.status !== 'cancelled').length,
            }));
    });

    selectedTotalShekels = computed(() => {
        const ids = this.selectedChargeIds();
        return this.openCharges()
            .filter(c => ids.has(c.id))
            .reduce((sum, c) => sum + this.remainingAgorot(c) / 100, 0);
    });

    anySelected(): boolean {
        return this.selectedChargeIds().size > 0;
    }

    async loadCharges() {
        try {
            this.loading.set(true);
            this.error.set(null);

            const { data, error } = await dbTenant()
                .from('rider_charges_with_rider')
                .select('*')
                .order('billing_month', { ascending: false })
                .order('created_at', { ascending: false })
                .limit(300);

            if (error) throw error;

            this.charges.set((data ?? []) as RiderChargeRow[]);
            this.selectedChargeIds.set(new Set());
            this.hasLoadedOnce.set(true);
        } catch (e: any) {
            console.error('[RiderBilling] load error', e);
            this.error.set(e?.message ?? 'שגיאה בטעינת חיובי רוכבים');
            this.hasLoadedOnce.set(true);
        } finally {
            this.loading.set(false);
        }
    }

    async runBilling(forceIgnoreWarning = false) {
        try {
            this.loading.set(true);
            this.error.set(null);
            this.successMessage.set(null);
            this.unbilledWarning.set(null);

            const billingDate =
                this.billingRunDate() || new Date().toISOString().slice(0, 10);

            const previousMonthDate = this.getPreviousMonthDate(billingDate);
            const previousMonthStart = previousMonthDate.slice(0, 7) + '-01';

            const { data: unbilledPrev, error: prevErr } = await dbTenant().rpc(
                'get_unbilled_rider_tasks_for_month',
                { p_month: previousMonthStart }
            );

            if (prevErr) throw prevErr;

            if (unbilledPrev?.length && !forceIgnoreWarning) {
                const riderNames = Array.from(
                    new Set(
                        unbilledPrev
                            .map((x: any) => x.rider_name || x.rider_uid)
                            .filter(Boolean)
                    )
                );

                this.unbilledWarning.set(
                    `קיימות משימות שירות שבוצעו בחודש ${previousMonthStart.slice(0, 7)} ועדיין לא חויבו. ` +
                    `רוכבים: ${riderNames.join(', ')}. ` +
                    `כדי לכלול אותן, הריצי חיוב על אותו חודש או המשיכי בכל זאת.`
                );

                return;
            }

            const { data, error } = await dbTenant().rpc(
                'run_independent_riders_billing',
                { p_billing_date: billingDate }
            );

            if (error) throw error;

            const createdCount = (data ?? []).filter((x: any) => x.created).length;

            await this.loadCharges();

            this.successMessage.set(
                createdCount
                    ? `נוצרו/עודכנו ${createdCount} חיובי רוכבים עצמאיים.`
                    : 'לא נמצאו משימות שבוצעו לחיוב בחודש הזה.'
            );
        } catch (e: any) {
            console.error('[RiderBilling] run error', e);
            this.error.set(e?.message ?? 'שגיאה בהרצת חיוב רוכבים');
        } finally {
            this.loading.set(false);
        }
    }

    async openChargeDetails(chargeId: string) {
        try {
            this.detailsOpenFor.set(chargeId);
            this.detailsLoading.set(true);
            this.detailsError.set(null);

            const { data, error } = await dbTenant()
                .from('rider_charge_details')
                .select('*')
                .eq('charge_id', chargeId)
                .order('item_date', { ascending: true });

            if (error) throw error;
            const { data: credits, error: creditsErr } = await dbTenant()
                .from('rider_credits')
                .select(`
    id,
    created_at,
    amount_agorot,
    reason,
    created_by
  `)
                .eq('related_charge_id', chargeId)
                .order('created_at', { ascending: true });

            if (creditsErr) throw creditsErr;

            this.detailsCredits.set(credits ?? []);
            this.detailsItems.set(data ?? []);
        } catch (e: any) {
            this.detailsError.set(e?.message ?? 'שגיאה בטעינת פירוט חיוב');
        } finally {
            this.detailsLoading.set(false);
        }
    }

    toggleChargeSelection(chargeId: string, checked: boolean) {
        const next = new Set(this.selectedChargeIds());

        if (checked) {
            next.add(chargeId);
        } else {
            next.delete(chargeId);
        }

        this.selectedChargeIds.set(next);
    }

    isSelected(chargeId: string): boolean {
        return this.selectedChargeIds().has(chargeId);
    }

    async markSelectedAsPaid() {
        const ids = Array.from(this.selectedChargeIds());
        if (!ids.length) return;

        try {
            this.loading.set(true);
            this.error.set(null);

            const { error } = await dbTenant()
                .from('rider_charges')
                .update({
                    status: 'paid',
                    paid_agorot: 0, // נעדכן מיד לפי הסכום בפועל בשלב הבא
                    updated_at: new Date().toISOString(),
                })
                .in('id', ids);

            if (error) throw error;

            for (const id of ids) {
                const charge = this.charges().find(c => c.id === id);
                if (!charge) continue;

                await dbTenant()
                    .from('rider_charges')
                    .update({
                        paid_agorot: charge.amount_agorot,
                        status: 'paid',
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', id);
            }

            await this.loadCharges();
            this.successMessage.set('החיובים סומנו כשולמו.');
        } catch (e: any) {
            this.error.set(e?.message ?? 'שגיאה בסימון חיובים כשולמו');
        } finally {
            this.loading.set(false);
        }
    }

    remainingAgorot(c: RiderChargeRow): number {
        return this.realRemainingAgorot(c);
    }

    formatShekelsFromAgorot(agorot: number | null | undefined): string {
        return `${((agorot ?? 0) / 100).toFixed(2)} ₪`;
    }

    formatStatus(c: RiderChargeRow): string {
        if (c.status === 'cancelled') return 'בוטל';
        if (c.status === 'failed') return 'נכשל';
        if (c.status === 'pending') return 'ממתין לחיוב';

        if (this.remainingAgorot(c) <= 0 && c.amount_agorot > 0) {
            return 'שולם';
        }

        return 'טיוטה';
    }

    formatMonthTitle(monthKey: string): string {
        const [year, month] = monthKey.split('-').map(Number);
        if (!year || !month) return monthKey;

        return new Date(year, month - 1, 1).toLocaleDateString('he-IL', {
            month: 'long',
            year: 'numeric',
        });
    }

    shortPeriod(c: RiderChargeRow): string {
        if (!c.period_start && !c.period_end) return 'לא הוגדרה תקופת חיוב';

        const format = (d: string) =>
            new Date(d).toLocaleDateString('he-IL', {
                day: '2-digit',
                month: '2-digit',
                year: '2-digit',
            });

        if (c.period_start && c.period_end) {
            return `${format(c.period_start)}–${format(c.period_end)}`;
        }

        if (c.period_start) return `מ־${format(c.period_start)}`;

        return `עד ${format(c.period_end!)}`;
    }

    getChargeCardClass(c: RiderChargeRow): string {
        if (c.status === 'cancelled') return 'charge-card cancelled';
        if (c.status === 'failed') return 'charge-card failed';
        if (this.remainingAgorot(c) <= 0 && c.amount_agorot > 0) return 'charge-card paid';
        if (c.status === 'pending') return 'charge-card pending';
        return 'charge-card draft';
    }

    private getPreviousMonthDate(dateStr: string): string {
        const d = new Date(dateStr);
        d.setMonth(d.getMonth() - 1);
        return d.toISOString().slice(0, 10);
    }
    openRiderAdditionalChargeDialog(c: RiderChargeRow) {
        const ref = this.dialog.open(RiderAdditionalChargeDialogComponent, {
            width: '560px',
            maxWidth: '92vw',
            autoFocus: false,
            data: {
                riderUid: c.rider_uid,
                riderName: c.rider_name || c.rider_uid,
                relatedChargeId: c.id,
            },
        });

        ref.afterClosed().subscribe(async (result) => {
            if (!result?.saved) return;

            await this.loadCharges();

            if (this.detailsOpenFor() === c.id) {
                await this.openChargeDetails(c.id);
            }
        });
    }
    openRiderCreditDialog(c: RiderChargeRow) {
        const ref = this.dialog.open(RiderCreditDialogComponent, {
            width: '560px',
            maxWidth: '92vw',
            autoFocus: false,
            data: {
                riderUid: c.rider_uid,
                riderName: c.rider_name || c.rider_uid,
                relatedChargeId: c.id,
            },
        });

        ref.afterClosed().subscribe(async (result) => {
            if (!result?.saved) return;

            await this.loadCharges();

            if (this.detailsOpenFor() === c.id) {
                await this.openChargeDetails(c.id);
            }
        });
    }
    paidAgorot(c: RiderChargeRow): number {
        return c.paid_agorot ?? 0;
    }

    creditsAgorot(c: RiderChargeRow): number {
        return c.credits_agorot ?? 0;
    }

    chargeTotalAgorot(c: RiderChargeRow): number {
        return c.amount_agorot ?? 0;
    }

    realRemainingAgorot(c: RiderChargeRow): number {
        return Math.max(
            this.chargeTotalAgorot(c) -
            this.paidAgorot(c) -
            this.creditsAgorot(c),
            0
        );
    }

    finalAmountAfterCreditsAgorot(c: RiderChargeRow): number {
        return Math.max(
            this.chargeTotalAgorot(c) - this.creditsAgorot(c),
            0
        );
    }
}