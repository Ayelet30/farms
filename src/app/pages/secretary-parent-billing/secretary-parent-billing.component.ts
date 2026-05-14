// src/app/pages/secretary-parent-billing/secretary-parent-billing.component.ts

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { createParentCredit, getCurrentFarmMetaSync } from '../../services/supabaseClient.service';
import { MatDialog } from '@angular/material/dialog';
import { CreditDialogComponent } from './credit-dialog.component';
import { Component, OnInit, signal, computed, inject, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import {
  PaymentsService,
  ParentChargeRow,
} from '../../services/payments.service';
import { TranzilaService } from '../../services/tranzila.service';
import { AdditionalChargeDialogComponent } from './additional-charge-dialog.component';
import { MailService } from '../../services/mail.service';
import { dbTenant, dbPublic } from '../../services/supabaseClient.service';
type ChargeWithPaymentStatus = ParentChargeRow & {
  hasPaymentMethod?: boolean;
  hasExpiredPaymentMethod?: boolean;
  paymentBlockReason?: string | null;
};
type ParentChildEmailInfo = {
  first_name: string | null;
  last_name: string | null;
  gov_id: string | null;
};
@Component({
  selector: 'app-secretary-parent-billing',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './secretary-parent-billing.component.html',
  styleUrls: ['./secretary-parent-billing.component.scss'],
})

export class SecretaryParentBillingComponent implements OnInit {
  
private dialog = inject(MatDialog);
  private tranzila = inject(TranzilaService);
  
  // === פילטרים ===
  parentNameFilter = signal<string>('');
successMessage = signal<string | null>(null);
  // נתונים
charges = signal<ChargeWithPaymentStatus[]>([]);
  // סטטוסים
  loading = signal(false);
  error = signal<string | null>(null);
hasLoadedOnce = signal(false);
  // בחירת חיובים לסליקה
  selectedChargeIds = signal<Set<string>>(new Set());
failedPaymentParentUids = signal<Set<string>>(new Set());
  // טאב פעיל: 'open' | 'all'
  activeTab = signal<'open' | 'all'>('open');

 
  detailsOpenFor = signal<string | null>(null);
  detailsLoading = signal(false);
  detailsError = signal<string | null>(null);

  detailsItems = signal<any[]>([]);   // lesson items
  detailsPayments = signal<any[]>([]); // credits/payments

  detailsCredits = signal<any[]>([]);
  private thtk: string | null = null;
invoiceExtraLinesByChild = signal<Record<string, string>>({});
billingRunDate = signal<string>(new Date().toISOString().slice(0, 10));
unbilledWarning = signal<string | null>(null);
private creditDialogOpen = false;
private additionalChargeDialogOpen = false;
  constructor(private payments: PaymentsService,  private mailService: MailService,
) {}

  // === helpers ===

  private shekelsFromAgorot(agorot: number | null | undefined): number {
    if (agorot == null) return 0;
    return agorot / 100;
  }
remainingAgorot(c: ParentChargeRow): number {
  return this.realRemainingAgorot(c);
}
  /** חיובים פתוחים (יתרה > 0, לא בוטל) */
  openCharges = computed(() => {
    return this.charges().filter((c) => {
      const remaining = this.remainingAgorot(c);
      return remaining > 0 && c.status !== 'cancelled';
    });
  });

  /** מה שמוצג בטבלה, לפי הטאב */
 visibleCharges = computed(() => {
  const base =
    this.activeTab() === 'open' ? this.openCharges() : this.charges();

  const filter = this.parentNameFilter().toLowerCase().trim();
  if (!filter) return base;

  return base.filter((c) => {
    const name = (c.parent_name || `${c.first_name} ${c.last_name}` || '')
      .toLowerCase();

    return name.includes(filter);
  });
});
  /** סכום חיובים נבחרים */
  selectedTotalShekels = computed(() => {
    const ids = this.selectedChargeIds();
    let sum = 0;
    for (const c of this.openCharges()) {
      if (ids.has(c.id)) {
        const remaining = this.remainingAgorot(c);
        if (remaining > 0) sum += remaining / 100;
      }
    }
    return sum;
  });

  /** האם יש בחירה כלשהי */
  anySelected(): boolean {
    return this.selectedChargeIds().size > 0;
  }

  
  // === lifecycle ===

  async ngOnInit() {
    await this.loadCharges();
  }

  async loadCharges() {
  const farm = getCurrentFarmMetaSync();
  const tenantSchema = farm?.schema_name ?? null;

  try {
    this.loading.set(true);
    this.error.set(null);

    const { thtk } = await this.tranzila.getHandshakeToken(tenantSchema ?? 'public');
    this.thtk = thtk;

    const { rows } = await this.payments.listParentCharges({
      limit: 200,
    });
const parentUids = Array.from(
  new Set((rows ?? []).map((c: any) => c.parent_uid).filter(Boolean))
);

const profilesByParent = new Map<string, any[]>();

if (parentUids.length) {
  const { data: profiles, error: profilesErr } = await dbTenant()
    .from('payment_profiles')
    .select('parent_uid, active, is_default, expiry_month, expiry_year, last4, brand')
    .in('parent_uid', parentUids)
    .eq('active', true);

  if (profilesErr) throw profilesErr;

  for (const p of profiles ?? []) {
    const arr = profilesByParent.get(p.parent_uid) ?? [];
    arr.push(p);
    profilesByParent.set(p.parent_uid, arr);
  }
}

const rowsWithPaymentStatus = (rows ?? []).map((c: any) => {
  const profiles = profilesByParent.get(c.parent_uid) ?? [];
  const hasPaymentMethod = profiles.length > 0;
  const hasValidPaymentMethod = profiles.some((p) => !this.isCardExpired(p));
  const hasExpiredPaymentMethod = hasPaymentMethod && !hasValidPaymentMethod;

  return {
    ...c,
    hasPaymentMethod,
    hasExpiredPaymentMethod,
    paymentBlockReason: !hasPaymentMethod
      ? 'אין להורה אמצעי תשלום פעיל'
      : hasExpiredPaymentMethod
        ? 'כל אמצעי התשלום של ההורה פגי תוקף'
        : null,
  };
});

this.charges.set(rowsWithPaymentStatus);
    this.selectedChargeIds.set(new Set());
    this.hasLoadedOnce.set(true);
  } catch (e: any) {
    console.error('[ParentBilling] load error', e);
    this.error.set(e?.message ?? 'שגיאה בטעינת החיובים');
    this.hasLoadedOnce.set(true);
  } finally {
    this.loading.set(false);
  }
}
  // שינוי סינון UID
  async onParentNameFilterChange(name: string) {
    this.parentNameFilter.set(name);
  }

  // === בחירת חיובים ===

  toggleChargeSelection(chargeId: string, checked: boolean) {
  const next = new Set(this.selectedChargeIds());

  if (checked) {
    next.add(chargeId);
  } else {
    next.delete(chargeId);
  }

  this.selectedChargeIds.set(next);
}
  toggleSelectAllVisible(checked: boolean) {
  const next = new Set<string>();

  if (checked) {
    for (const c of this.openCharges()) {
      if (this.canSelectForPayment(c)) {
        next.add(c.id);
      }
    }
  }

  this.selectedChargeIds.set(next);
}

  isSelected(chargeId: string): boolean {
    return this.selectedChargeIds().has(chargeId);
  }

  // handlers מה־template
  onSelectAllChange(event: Event) {
    const input = event.target as HTMLInputElement | null;
    const checked = !!input?.checked;
    this.toggleSelectAllVisible(checked);
  }

  onRowCheckboxChange(chargeId: string, event: Event) {
  const input = event.target as HTMLInputElement | null;
  const checked = !!input?.checked;

  const charge = this.openCharges().find(c => c.id === chargeId);

  if (checked && charge && !this.canSelectForPayment(charge)) {
    input!.checked = false;
    return;
  }

  this.toggleChargeSelection(chargeId, checked);
}

  // === חיוב חיובים נבחרים ===

 async chargeSelected() {
  if (!this.anySelected()) return;

  try {
    this.loading.set(true);
    this.error.set(null);

    const farm = getCurrentFarmMetaSync();
    const schema = farm?.schema_name ?? 'public';

    const grouped = this.getSelectedChargesGroupedByParent();
    const entries = Object.entries(grouped);

    if (!entries.length) {
      this.error.set('לא נבחרו חיובים לחיוב');
      return;
    }

    const failures: string[] = [];

    for (const [parentUid, chargeIds] of entries) {
      try {
//         if (parentUid === 'zXWaxymcPSWzbUXYKNzASkhaZaz1') {
//   throw new Error('בדיקת כישלון חיוב יזומה');
// }
      await this.tranzila.chargeSelectedChargesForParent({
  tenantSchema: schema,
  parentUid,
  chargeIds,
  secretaryEmail: '',
  invoiceExtraLinesByChild: this.invoiceExtraLinesByChild(),
});
    } catch (e: any) {
  console.error('[ParentBilling] charge failed for parent', parentUid, e);
  failures.push(parentUid);

  const nextFailed = new Set(this.failedPaymentParentUids());
  nextFailed.add(parentUid);
  this.failedPaymentParentUids.set(nextFailed);

  const parentCharge = this.openCharges().find(c => c.parent_uid === parentUid);
  const parentName =
    parentCharge?.parent_name ||
    `${parentCharge?.first_name || ''} ${parentCharge?.last_name || ''}`.trim() ||
    parentUid;

  const farm = getCurrentFarmMetaSync();
  const tenantSchema = farm?.schema_name ?? 'public';
  const farmName = farm?.name ?? 'Smart Farm';
const children = await this.getParentChildrenForEmail(parentUid);
const email = this.buildPaymentFailedEmail({
  parentName,
  parentUid,
  chargeIds,
  farmName,
  errorMessage: e?.message ?? null,
  children,
});

 const secretaryEmails = await this.getSecretaryEmailsForCurrentTenant();

if (secretaryEmails.length) {
  await this.mailService.sendEmailGmail({
    tenantSchema,
    to: secretaryEmails,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
}
}
    }

    await this.loadCharges();

    if (failures.length) {
      this.error.set(`חלק מהחיובים לא חויבו. מספר הורים שנכשלו: ${failures.length}`);
    }
  } catch (e: any) {
    this.error.set(e?.message ?? 'שגיאה בחיוב');
  } finally {
    this.loading.set(false);
  }
}

  // === זיכוי הורה ===

async openCreditForCharge(c: ParentChargeRow) {
  if (this.creditDialogOpen) return;

  this.creditDialogOpen = true;

  try {
    const children = await this.getChildrenForCharge(c.id);

    const ref = this.dialog.open(CreditDialogComponent, {
      width: '560px',
      maxWidth: '92vw',
      autoFocus: false,
      panelClass: 'credit-dialog-panel',
      data: {
        parentUid: c.parent_uid,
        parentName: c.parent_name ?? '',
        relatedChargeId: c.id,
        children,
      },
    });

    ref.afterClosed().subscribe(async (result) => {
      this.creditDialogOpen = false;

      if (result?.saved) {
        await this.loadCharges();

        if (this.detailsOpenFor() === c.id) {
          await this.openChargeDetails(c.id);
        }
      }
    });
  } catch (e) {
    this.creditDialogOpen = false;
    throw e;
  }
}

  // === תצוגה ===

  formatShekelsFromAgorot(agorot: number | null | undefined): string {
    const val = this.shekelsFromAgorot(agorot);
    return `${val.toFixed(2)} ₪`;
  }
formatPeriod(c: ParentChargeRow): string {
  if (!c.period_start && !c.period_end) return '';

  const format = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString('he-IL'); // dd/MM/yyyy
  };

  if (c.period_start && c.period_end) {
    return `מ־${format(c.period_start)} עד ${format(c.period_end)}`;
  }

  if (c.period_start) {
    return `מ־${format(c.period_start)}`;
  }

  if (c.period_end) {
    return `עד ${format(c.period_end)}`;
  }

  return '';
}
  formatStatus(c: ParentChargeRow): string {
  const total = this.chargeTotalAgorot(c);
  const paid = this.paidAgorot(c);
  const credits = this.creditsAgorot(c);
  const remaining = this.realRemainingAgorot(c);

  if (c.status === 'cancelled') return 'בוטל';
  if (c.status === 'failed') return 'נכשל';
  if (c.status === 'pending') return 'ממתין לחיוב';

  if (remaining <= 0 && total > 0) {
    if (paid > 0 && credits > 0) return 'שולם עם זיכוי';
    if (credits > 0 && paid === 0) return 'נסגר בזיכוי';
    return 'שולם';
  }

  if (paid > 0 && remaining > 0) return 'שולם חלקית';

  return 'טיוטה';
}
 async openChargeDetails(chargeId: string) {
  try {
    this.detailsOpenFor.set(chargeId);
    this.detailsLoading.set(true);
    this.detailsError.set(null);
   const { data: newAmount, error: recalcErr } = await dbTenant().rpc(
  'recalc_charge_amount',
  { p_charge_id: chargeId }
);

if (recalcErr) throw recalcErr;

if (newAmount != null) {
  const updated = this.charges().map((c: any) => {
    if (c.id !== chargeId) return c;

    const paid = c.paid_agorot ?? 0;
    const credits = c.credits_agorot ?? 0;
    const newRemaining = Math.max(Number(newAmount) - paid - credits, 0);

    return {
      ...c,
      charge_amount_agorot: Number(newAmount),
      amount_agorot: Number(newAmount),
      remaining_agorot: newRemaining,
    };
  });

  this.charges.set(updated);
}

    const { data: items, error: e1 } = await dbTenant()
      .from('charge_details_with_office_note')
      .select(`
        id,
        row_type,
        occur_date,
        start_datetime,
        child_id,
        child_name,
        unit_price_agorot,
        quantity,
        amount_agorot,
        office_note,
        billing_source,
        is_cancelled_billable,
        related_lesson_id,
        item_type,
        item_code,
        description
      `)
      .eq('charge_id', chargeId)
      .order('occur_date', { ascending: true });

    if (e1) throw e1;

    const { data: credits, error: e2 } = await dbTenant()
      .from('parent_credits')
.select(`
    id,
  created_at,
  amount_agorot,
  reason,
  created_by,
  child_id,
  children:child_id (
    first_name,
    last_name,
    gov_id
  )
`)      .eq('related_charge_id', chargeId)
      .order('created_at', { ascending: true });

    if (e2) throw e2;
const sortedItems = (items ?? []).sort((a: any, b: any) => {
    if (a.row_type === b.row_type) {
    const dateCompare = (a.occur_date || '').localeCompare(b.occur_date || '');
    if (dateCompare !== 0) return dateCompare;

    return (a.start_datetime || '').localeCompare(b.start_datetime || '');
  }

  return a.row_type === 'lesson' ? -1 : 1;
});

this.detailsItems.set(sortedItems);
    this.detailsCredits.set(credits ?? []);
  } catch (e: any) {
    this.detailsError.set(e?.message ?? 'שגיאה בטעינת פירוט חיוב');
  } finally {
    this.detailsLoading.set(false);
  }
}

detailsCreditsTotalAgorot = computed(() => {
  return (this.detailsCredits() ?? []).reduce((sum, c) => sum + (c.amount_agorot ?? 0), 0);
});



async runbilling(runDate?: string, forceIgnoreWarning = false) {
     try {
    this.loading.set(true);
    this.error.set(null);
    this.successMessage.set(null);
this.unbilledWarning.set(null);
    const billingDate = runDate || this.billingRunDate() || new Date().toISOString().slice(0, 10);
const billingDay = Number(billingDate.split('-')[2]);


const previousMonthDate = this.getPreviousMonthDate(billingDate);
const previousMonthStart = previousMonthDate.slice(0, 7) + '-01';

const { data: dismissedWarning, error: dismissedErr } = await dbTenant()
  .from('billing_warnings_dismissals')
  .select('id')
  .eq('warning_type', 'UNBILLED_PREVIOUS_MONTH')
  .eq('warning_month', previousMonthStart)
  .maybeSingle();

if (dismissedErr) throw dismissedErr;

const { data: unbilledLessons, error: unbilledErr } = await dbTenant().rpc(
  'get_unbilled_lessons_for_month',
  { p_month: previousMonthDate }
);

if (unbilledErr) throw unbilledErr;

if (
  unbilledLessons?.length &&
  !dismissedWarning &&
  !forceIgnoreWarning
) {
  const parentNames = Array.from(
  new Set(
    (unbilledLessons ?? []).map((x: any) =>
      (x.parent_name || x.parent_uid || '').trim()
    )
  )
).filter(Boolean);

const parentsText = parentNames.length
  ? ` הורים: ${parentNames.join(', ')}.`
  : '';

this.unbilledWarning.set(
  `קיים שיעור אחד או יותר בחודש ${previousMonthDate.slice(0, 7)} שלא שולם.` +
  parentsText +
  ` כדי להכניס חיוב לשיעור/ים אלה יש להריץ חישוב על החודש עם החיוב החסר.`
);

  return;

}
    // להביא את כל ההורים שיום החיוב שלהם הוא היום שבתאריך שנבחר
    const { data: parents, error } = await dbTenant()
      .from('parents')
      .select('uid')
      .eq('billing_day_of_month', billingDay);

    if (error) throw error;

    const list = parents ?? [];
const targetMonthStart = billingDate.slice(0, 7) + '-01';

const { data: missingCurrentMonth, error: missingCurrentErr } =
  await dbTenant().rpc('get_unbilled_lessons_for_month', {
    p_month: targetMonthStart,
  });

if (missingCurrentErr) throw missingCurrentErr;

const parentUidsToRun = new Set((list ?? []).map((p: any) => p.uid));

const relevantMissing = (missingCurrentMonth ?? []).filter((x: any) =>
  parentUidsToRun.has(x.parent_uid)
);

if (relevantMissing.length) {
  const parentUids = Array.from(
    new Set(relevantMissing.map((x: any) => x.parent_uid))
  );

  for (const parentUid of parentUids) {
    const { data: existingMonthlyCharge, error: existingMonthlyErr } =
      await dbTenant()
        .from('charges')
        .select('id')
        .eq('parent_uid', parentUid)
        .eq('billing_month', targetMonthStart)
        .eq('charge_kind', 'monthly')
        .maybeSingle();

    if (existingMonthlyErr) throw existingMonthlyErr;

    if (existingMonthlyCharge) {
      await dbTenant().rpc('create_missing_lessons_charge_for_parent', {
        p_parent_uid: parentUid,
        p_month: targetMonthStart,
      });
    } else {
      await dbTenant().rpc('create_monthly_charge_for_parent', {
        p_parent_uid: parentUid,
        p_billing_date: billingDate,
      });
    }
  }

  await this.loadCharges();

  this.successMessage.set(
    `החיוב חושב עבור חודש ${targetMonthStart.slice(0, 7)}. אם היו שיעורים חסרים לחיוב קיים, נוצר עבורם חיוב השלמה.`
  );

  return;
}
    let ok = 0;
    let failed = 0;

    for (const p of list) {
      const { error: rpcError } = await dbTenant().rpc('create_monthly_charge_for_parent', {
        p_parent_uid: p.uid,
        p_billing_date: billingDate,
      });

      if (rpcError) {
        failed++;
        console.error('RPC failed', {
          parentUid: p.uid,
          billingDate,
          message: rpcError.message,
          code: rpcError.code,
          details: rpcError.details,
          hint: rpcError.hint,
        });
      } else {
        ok++;
      }
    }

    await this.loadCharges();

    if (failed > 0) {
      this.error.set(`החיוב הורץ חלקית. הצליחו: ${ok}, נכשלו: ${failed}`);
    }
  } catch (e: any) {
    console.error('[ParentBilling] runbilling error', e);
    this.error.set(e?.message ?? 'שגיאה בהרצת חיוב יזום');
  } finally {
    this.loading.set(false);
  }
}

private getSelectedChargesGroupedByParent(): Record<string, string[]> {
  const ids = this.selectedChargeIds();
  const grouped: Record<string, string[]> = {};

  for (const c of this.openCharges()) {
    if (!ids.has(c.id)) continue;

    if (!grouped[c.parent_uid]) {
      grouped[c.parent_uid] = [];
    }

    grouped[c.parent_uid].push(c.id);
  }

  return grouped;
}
async openAdditionalChargeDialog(c: ParentChargeRow) {
  if (this.additionalChargeDialogOpen) return;

  this.additionalChargeDialogOpen = true;

  try {
    const children = await this.getChildrenForCharge(c.id);

    const ref = this.dialog.open(AdditionalChargeDialogComponent, {
      width: '560px',
      maxWidth: '92vw',
      autoFocus: false,
      data: {
        parentUid: c.parent_uid,
        parentName: c.parent_name || `${c.first_name} ${c.last_name}`.trim(),
        children,
      },
    });

    ref.afterClosed().subscribe(async (result) => {
      this.additionalChargeDialogOpen = false;

      if (!result?.saved) return;

      try {
        this.loading.set(true);
        this.error.set(null);

        const chargeId = await this.createAdditionalCharge({
          parentUid: c.parent_uid,
          amountAgorot: result.amountAgorot,
          description: result.description,
          childId: result.childId,
        });

        await this.loadCharges();

        if (this.detailsOpenFor() === c.id || this.detailsOpenFor() === chargeId) {
          await this.openChargeDetails(chargeId);
        }
      } catch (e: any) {
        this.error.set(e?.message ?? 'שגיאה ביצירת חיוב נוסף');
      } finally {
        this.loading.set(false);
      }
    });
  } catch (e) {
    this.additionalChargeDialogOpen = false;
    throw e;
  }
}
private async createAdditionalCharge(args: {
  parentUid: string;
  amountAgorot: number;
  description: string;
  childId: string;
}) {
  const now = new Date();
  const isoNow = now.toISOString();
  const itemDate = isoNow.slice(0, 10);
  const billingMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const sb = dbTenant();

  let chargeId: string;

  const { data: existing, error: fetchErr } = await sb
    .from('charges')
    .select('id, amount_agorot')
    .eq('parent_uid', args.parentUid)
    .eq('billing_month', billingMonth)
    .maybeSingle();

  if (fetchErr) throw fetchErr;

  if (existing) {
    chargeId = existing.id;

    const { error: updateErr } = await sb
      .from('charges')
      .update({
        amount_agorot: Number(existing.amount_agorot || 0) + args.amountAgorot,
        updated_at: isoNow,
      })
      .eq('id', chargeId);

    if (updateErr) throw updateErr;
  } else {
    const { data: insertedCharge, error: insertChargeErr } = await sb
      .from('charges')
      .insert({
        parent_uid: args.parentUid,
        amount_agorot: args.amountAgorot,
        currency: 'ILS',
        status: 'draft',
        description: 'חיוב נוסף',
        billing_month: billingMonth,
        created_at: isoNow,
        updated_at: isoNow,
        office_note: 'חיוב נוסף שהוזן ידנית ע"י המזכירה',
      })
      .select('id')
      .single();

    if (insertChargeErr) throw insertChargeErr;

    chargeId = insertedCharge.id;
  }

  const { error: insertItemErr } = await sb
    .from('charge_items')
    .insert({
      charge_id: chargeId,
      parent_uid: args.parentUid,
      child_id: args.childId,
      item_type: 'extra',
      item_code: 'extra_manual',
      description: args.description,
      amount_agorot: args.amountAgorot,
      quantity: 1,
      unit_price_agorot: args.amountAgorot,
      item_date: itemDate,
      office_note: 'חיוב נוסף שהוזן ידנית ע"י המזכירה',
      metadata: {
        created_by: 'secretary-parent-billing',
        source: 'manual_additional_charge',
        child_id: args.childId,
      },
      created_at: isoNow,
      updated_at: isoNow,
    });

  if (insertItemErr) throw insertItemErr;

  return chargeId;
}
private isCardExpired(profile: any): boolean {
  if (!profile?.expiry_month || !profile?.expiry_year) return false;

  const now = new Date();

  // סוף חודש התוקף
  const expiryEnd = new Date(
    Number(profile.expiry_year),
    Number(profile.expiry_month),
    0,
    23,
    59,
    59
  );

  return expiryEnd < now;
}

canSelectForPayment(c: ChargeWithPaymentStatus): boolean {
  return (
    this.remainingAgorot(c) > 0 &&
    c.status !== 'cancelled' &&
    c.hasPaymentMethod === true &&
    c.hasExpiredPaymentMethod !== true
  );
}
isParentPaymentFailed(parentUid: string): boolean {
  return this.failedPaymentParentUids().has(parentUid);
}
private buildPaymentFailedEmail(args: {
  parentName: string;
  parentUid: string;
  chargeIds: string[];
  farmName: string;
  errorMessage?: string | null;
  children?: ParentChildEmailInfo[];
  
}) {
  const parentName = args.parentName || args.parentUid;
  const subject = `חיוב אשראי נכשל – ${parentName}`;
const children = args.children ?? [];

const childrenHtml = children.length
  ? `
  <p style="margin:14px 0 6px 0;"><b>ילדים משויכים להורה:</b></p>
  <table style="border-collapse:collapse;width:100%;max-width:520px;">
    <thead>
      <tr>
        <th style="text-align:right;border:1px solid #e5e7eb;padding:6px;background:#f9fafb;">שם הילד/ה</th>
        <th style="text-align:right;border:1px solid #e5e7eb;padding:6px;background:#f9fafb;">תעודת זהות</th>
      </tr>
    </thead>
    <tbody>
      ${children.map(child => {
        const name = `${child.first_name || ''} ${child.last_name || ''}`.trim() || '—';
        return `
          <tr>
            <td style="border:1px solid #e5e7eb;padding:6px;">${this.escapeHtml(name)}</td>
            <td style="border:1px solid #e5e7eb;padding:6px;">${this.escapeHtml(child.gov_id || '—')}</td>
          </tr>
        `;
      }).join('')}
    </tbody>
  </table>
`
  : `<p style="margin:14px 0 6px 0;color:#6b7280;">לא נמצאו ילדים משויכים להורה.</p>`;
  const html = `
<div style="direction:rtl;font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#111827;">
  <h2 style="margin:0 0 8px 0;">${args.farmName}</h2>

  <p style="margin:0 0 12px 0;">
    חיוב אשראי עבור ההורה <b>${parentName}</b> לא עבר.
  </p>

  <p style="margin:0 0 8px 0;">
  </p>

  <p style="margin:0 0 8px 0;">
    <b>מספר חיובים שניסו לחייב:</b> ${args.chargeIds.length}
  </p>
  ${childrenHtml}

  ${
    args.errorMessage
      ? `<p style="margin:0 0 8px 0;color:#b42318;"><b>שגיאה:</b> ${args.errorMessage}</p>`
      : ''
  }

  <hr style="margin:18px 0;border:none;border-top:1px solid #e5e7eb;" />
  <p style="margin:0;color:#6b7280;font-size:13px;">הודעה אוטומטית ממערכת Smart Farm.</p>
</div>
`.trim();

  const text = `
${args.farmName}
חיוב אשראי נכשל
הורה: ${parentName}
מספר חיובים: ${args.chargeIds.length}
${args.errorMessage ? `שגיאה: ${args.errorMessage}` : ''}
`.trim();

  return { subject, html, text };
}
private async getSecretaryEmailsForCurrentTenant(): Promise<string[]> {
  const farm = getCurrentFarmMetaSync();
  const tenantId = farm?.id;

  if (!tenantId) return [];

  const { data: tenantUsers, error: tuError } = await dbPublic()
    .from('tenant_users')
    .select('uid')
    .eq('tenant_id', tenantId)
    .eq('role_in_tenant', 'secretary')
    .eq('is_active', true);

  if (tuError) throw tuError;

  const uids = Array.from(
    new Set((tenantUsers ?? []).map((x: any) => x.uid).filter(Boolean))
  );

  if (!uids.length) return [];

  const { data: users, error: usersError } = await dbPublic()
    .from('users')
    .select('email')
    .in('uid', uids)
    .eq('role', 'secretary');

  if (usersError) throw usersError;

  return Array.from(
    new Set(
      (users ?? [])
        .map((u: any) => String(u.email || '').trim().toLowerCase())
        .filter(Boolean)
    )
  );
}
private async getParentChildrenForEmail(parentUid: string): Promise<ParentChildEmailInfo[]> {
  const { data, error } = await dbTenant()
    .from('children')
    .select('first_name, last_name, gov_id')
    .eq('parent_uid', parentUid)
    .order('first_name', { ascending: true });

  if (error) throw error;

  return (data ?? []) as ParentChildEmailInfo[];
}
private escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
private getPreviousMonthDate(dateStr: string): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}
async dismissUnbilledWarning() {
  try {
    const billingDate =
      this.billingRunDate() || new Date().toISOString().slice(0, 10);

    const previousMonthDate = this.getPreviousMonthDate(billingDate);
    const previousMonthStart = previousMonthDate.slice(0, 7) + '-01';

    const { error } = await dbTenant()
      .from('billing_warnings_dismissals')
      .upsert(
        {
          warning_type: 'UNBILLED_PREVIOUS_MONTH',
          warning_month: previousMonthStart,
          note: 'המזכירה בחרה להתעלם מהתראת חיוב חסר בחודש קודם',
        },
        {
          onConflict: 'warning_type,warning_month',
        }
      );

    if (error) throw error;

    this.unbilledWarning.set(null);
  } catch (e: any) {
    this.error.set(e?.message ?? 'שגיאה בהסרת האזהרה');
  }
}
private async getChildrenForParent(parentUid: string) {
  const { data, error } = await dbTenant()
    .from('children')
    .select('child_uuid, first_name, last_name, gov_id')
    .eq('parent_uid', parentUid)
    .order('first_name', { ascending: true });

  if (error) throw error;

  return data ?? [];
}
paidAgorot(c: ParentChargeRow): number {
  return c.paid_agorot ?? 0;
}

creditsAgorot(c: ParentChargeRow): number {
  return c.credits_agorot ?? 0;
}

chargeTotalAgorot(c: ParentChargeRow): number {
  return c.charge_amount_agorot ?? 0;
}

finalAmountAfterCreditsAgorot(c: ParentChargeRow): number {
  return Math.max(
    this.chargeTotalAgorot(c) - this.creditsAgorot(c),
    0
  );
}

realRemainingAgorot(c: ParentChargeRow): number {
  return Math.max(
    this.chargeTotalAgorot(c) -
      this.paidAgorot(c) -
      this.creditsAgorot(c),
    0
  );
}
private async getChildrenForCharge(chargeId: string) {
  const { data: detailRows, error: detailErr } = await dbTenant()
    .from('charge_details_with_office_note')
    .select('child_id')
    .eq('charge_id', chargeId)
    .not('child_id', 'is', null);

  if (detailErr) throw detailErr;

  const childIds = Array.from(
    new Set((detailRows ?? []).map((x: any) => x.child_id).filter(Boolean))
  );

  if (!childIds.length) return [];

  const { data, error } = await dbTenant()
    .from('children')
    .select('child_uuid, first_name, last_name, gov_id')
    .in('child_uuid', childIds)
    .order('first_name', { ascending: true });

  if (error) throw error;

  return data ?? [];
}

// === UX helpers: grouping charges by billing month ===
private getChargeMonthKey(c: ParentChargeRow): string {
  const raw =
    (c as any).billing_month ||
    c.period_start ||
    c.period_end ||
    c.created_at ||
    new Date().toISOString();

  return String(raw).slice(0, 7);
}

formatMonthTitle(monthKey: string): string {
  if (!monthKey) return 'ללא חודש חיוב';

  const [year, month] = monthKey.split('-').map(Number);
  if (!year || !month) return monthKey;

  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString('he-IL', {
    month: 'long',
    year: 'numeric',
  });
}

formatChargeMainTitle(c: ParentChargeRow): string {
  const month = this.formatMonthTitle(this.getChargeMonthKey(c));
  const desc = c.description?.trim();
  return desc ? `${desc} · ${month}` : `חיוב ${month}`;
}

visibleChargeGroups = computed(() => {
  const map = new Map<string, ChargeWithPaymentStatus[]>();

  for (const c of this.visibleCharges()) {
    const key = this.getChargeMonthKey(c);
    const arr = map.get(key) ?? [];
    arr.push(c);
    map.set(key, arr);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([monthKey, rows]) => {
      const totalAgorot = rows.reduce((sum, c) => sum + this.chargeTotalAgorot(c), 0);
      const remainingAgorot = rows.reduce((sum, c) => sum + this.realRemainingAgorot(c), 0);
      const paidAgorot = rows.reduce((sum, c) => sum + this.paidAgorot(c), 0);
      const creditsAgorot = rows.reduce((sum, c) => sum + this.creditsAgorot(c), 0);
      const selectedCount = rows.filter(c => this.isSelected(c.id)).length;
      const openCount = rows.filter(c => this.remainingAgorot(c) > 0 && c.status !== 'cancelled').length;

      return {
        monthKey,
        title: this.formatMonthTitle(monthKey),
        rows,
        totalAgorot,
        remainingAgorot,
        paidAgorot,
        creditsAgorot,
        selectedCount,
        openCount,
      };
    });
});

getChargeCardClass(c: ParentChargeRow): string {
  const remaining = this.realRemainingAgorot(c);

  if (c.status === 'cancelled') return 'charge-card cancelled';
  if (c.status === 'failed') return 'charge-card failed';
  if (remaining <= 0 && this.chargeTotalAgorot(c) > 0) return 'charge-card paid';
  if (c.status === 'pending') return 'charge-card pending';
  return 'charge-card draft';
}

shortPeriod(c: ParentChargeRow): string {
  if (!c.period_start && !c.period_end) return 'לא הוגדרה תקופת חיוב';

  const format = (d: string) => new Date(d).toLocaleDateString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });

  if (c.period_start && c.period_end) return `${format(c.period_start)}–${format(c.period_end)}`;
  if (c.period_start) return `מ־${format(c.period_start)}`;
  return `עד ${format(c.period_end!)}`;
}

detailsGroupedByChild = computed(() => {
  const groups = new Map<string, any>();

  const upsert = (key: string, childName: string) => {
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        childName: childName || 'ללא שיוך לילד/ה',
        items: [],
        credits: [],
        itemsTotalAgorot: 0,
        creditsTotalAgorot: 0,
        finalAgorot: 0,
      });
    }

    return groups.get(key);
  };

  for (const item of this.detailsItems() ?? []) {
    const key = item.child_id || 'unknown';
    const group = upsert(key, item.child_name || 'ללא שיוך לילד/ה');

    group.items.push(item);
    group.itemsTotalAgorot += Number(item.amount_agorot ?? 0);
  }

  for (const cr of this.detailsCredits() ?? []) {
    const childName = cr.children
      ? `${cr.children.first_name || ''} ${cr.children.last_name || ''}`.trim()
      : 'ללא שיוך לילד/ה';

    const key = cr.child_id || 'unknown-credit';
    const group = upsert(key, childName);

    group.credits.push(cr);
    group.creditsTotalAgorot += Number(cr.amount_agorot ?? 0);
  }

  return Array.from(groups.values()).map(group => ({
    ...group,
    finalAgorot: Math.max(group.itemsTotalAgorot - group.creditsTotalAgorot, 0),
  }));
});
chargeActionLabel(c: ChargeWithPaymentStatus): string {
  if (!this.canSelectForPayment(c)) return 'לא ניתן לחייב';
  return this.isSelected(c.id) ? 'נבחר לחיוב' : 'בחר לחיוב';
}


invoiceExtraTextForChild(childId: string): string {
  return this.invoiceExtraLinesByChild()[childId] ?? '';
}

setInvoiceExtraTextForChild(childId: string, value: string) {
  const next = {
    ...this.invoiceExtraLinesByChild(),
    [childId]: value,
  };

  if (!value.trim()) {
    delete next[childId];
  }

  this.invoiceExtraLinesByChild.set(next);
}
async confirmDeleteCredit(credit: any, chargeId: string) {
  const ref = this.dialog.open(DeleteCreditConfirmDialogComponent, {
    width: '420px',
    maxWidth: '92vw',
    autoFocus: false,
    panelClass: 'delete-credit-dialog-panel',
    data: { credit },
  });

  ref.afterClosed().subscribe(async (confirmed) => {
    if (!confirmed) return;

    try {
      this.detailsLoading.set(true);
      this.error.set(null);

      const { error } = await dbTenant()
        .from('parent_credits')
        .delete()
        .eq('id', credit.id);

      if (error) throw error;

      await this.loadCharges();
      await this.openChargeDetails(chargeId);
    } catch (e: any) {
      this.error.set(e?.message ?? 'שגיאה במחיקת הזיכוי');
    } finally {
      this.detailsLoading.set(false);
    }
  });
}
}
@Component({
  selector: 'app-delete-credit-confirm-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="simple-confirm-dialog" dir="rtl">
      <h3>מחיקת זיכוי</h3>

      <p>
        האם את בטוחה שברצונך למחוק את הזיכוי?
      </p>

      <p class="note">
        פעולה זו תמחק את הזיכוי מהחיוב ותעדכן את היתרה לתשלום.
      </p>

      <div class="dialog-actions">
        <button type="button" (click)="close(false)">לא</button>
        <button type="button" class="danger" (click)="close(true)">כן</button>
      </div>
    </div>
  `,
  styles: [`
    .simple-confirm-dialog {
      width: 100%;
      box-sizing: border-box;
      padding: 34px 42px 14px;
      text-align: center;
      direction: rtl;
      color: #3f3f3f;
      font-family: 'Heebo', system-ui, sans-serif;
    }

    h3 {
      margin: 0 0 22px;
      font-size: 23px;
      font-weight: 900;
      color: #3f3f3f;
    }

    p {
      margin: 0 0 12px;
      font-size: 18px;
      line-height: 1.55;
      font-weight: 500;
    }

    .note {
      font-size: 16px;
      color: #555;
      margin-bottom: 26px;
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-start;
      gap: 10px;
      direction: ltr;
    }

    button {
      min-width: 34px;
      height: 31px;
      padding: 0 10px;
      border-radius: 9px;
      border: 2px solid #3f3f3f;
      background: #fff;
      color: #3f3f3f;
      font-size: 15px;
      font-weight: 800;
      cursor: pointer;
      line-height: 1;
    }

    button:hover {
      background: #f5f7ef;
    }

    button.danger {
      color: #b42318;
      border-color: #b42318;
    }
  `],
})
export class DeleteCreditConfirmDialogComponent {
  constructor(
    private ref: MatDialogRef<DeleteCreditConfirmDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {}

  close(confirm: boolean) {
    this.ref.close(confirm);
  }
}