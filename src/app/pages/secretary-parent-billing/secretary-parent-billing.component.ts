// src/app/pages/secretary-parent-billing/secretary-parent-billing.component.ts
import {
  Component,
  OnInit,
  signal,
  computed,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { createParentCredit, getCurrentFarmMetaSync } from '../../services/supabaseClient.service';
import { MatDialog } from '@angular/material/dialog';
import { CreditDialogComponent } from './credit-dialog.component';
import {
  PaymentsService,
  ParentChargeRow,
} from '../../services/payments.service';
import { dbTenant } from '../../services/supabaseClient.service';
import { TranzilaService } from '../../services/tranzila.service';
import { AdditionalChargeDialogComponent } from './additional-charge-dialog.component';
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

  // נתונים
  charges = signal<ParentChargeRow[]>([]);

  // סטטוסים
  loading = signal(false);
  error = signal<string | null>(null);
hasLoadedOnce = signal(false);
  // בחירת חיובים לסליקה
  selectedChargeIds = signal<Set<string>>(new Set());

  // טאב פעיל: 'open' | 'all'
  activeTab = signal<'open' | 'all'>('open');

  // טופס זיכוי
  creditAmount = signal<string>(''); // בש"ח
  creditReason = signal<string>('');
  creditSaving = signal(false);
  creditError = signal<string | null>(null);
  creditSuccess = signal<string | null>(null);

  detailsOpenFor = signal<string | null>(null);
  detailsLoading = signal(false);
  detailsError = signal<string | null>(null);

  detailsItems = signal<any[]>([]);   // lesson items
  detailsPayments = signal<any[]>([]); // credits/payments

  creditParentUid = signal<string | null>(null);
  creditParentName = signal<string | null>(null);
  creditRelatedChargeId = signal<string | null>(null);

  detailsCredits = signal<any[]>([]);
  private thtk: string | null = null;

invoiceExtraText = '';


  constructor(private payments: PaymentsService) {}

  // === helpers ===

  private shekelsFromAgorot(agorot: number | null | undefined): number {
    if (agorot == null) return 0;
    return agorot / 100;
  }

 remainingAgorot(c: ParentChargeRow): number {
    // אם ה־VIEW כבר מחשב – זה השדה המרכזי
    return c.remaining_agorot ?? 0;
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

    this.charges.set(rows);
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
        const remaining = this.remainingAgorot(c);
        if (remaining > 0) next.add(c.id);
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
        await this.tranzila.chargeSelectedChargesForParent({
          tenantSchema: schema,
          parentUid,
          chargeIds,
          secretaryEmail: 'ayelethury@gmail.com',
          invoiceExtraText: this.invoiceExtraText?.trim() || null,
        });
      } catch (e: any) {
        console.error('[ParentBilling] charge failed for parent', parentUid, e);
        failures.push(parentUid);
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

  async submitCredit() {
    this.creditError.set(null);
    this.creditSuccess.set(null);

    const raw = this.creditAmount();
    const amountStr = String(raw ?? '').trim();

    const reason = this.creditReason().trim();
    
    const parentUid = this.creditParentUid();
    if (!parentUid) {
      this.creditError.set('בחר/י קודם הורה מתוך הטבלה (כפתור "הוסף זיכוי").');
      return;
    }


    const amountNumber = Number(amountStr.replace(',', '.'));
    if (!amountStr || isNaN(amountNumber) || amountNumber <= 0) {
      this.creditError.set('יש להזין סכום זיכוי חיובי בש"ח');
      return;
    }
    if (!reason) {
      this.creditError.set('יש להזין סיבה לזיכוי');
      return;
    }

    try {
      this.creditSaving.set(true);

      await createParentCredit({
        parent_uid: parentUid,
        amount_agorot: Math.round(amountNumber * 100),
        reason,
        related_charge_id: this.creditRelatedChargeId(),
      });


      this.creditAmount.set('');
      this.creditReason.set('');
      this.creditSuccess.set('הזיכוי נשמר בהצלחה');
      await this.loadCharges();
    } catch (e: any) {
      console.error('[ParentBilling] credit error', e);
      this.creditError.set(e?.message ?? 'שגיאה בשמירת הזיכוי');
    } finally {
      this.creditSaving.set(false);
    }
  }

 


openCreditForCharge(c: ParentChargeRow) {
  const ref = this.dialog.open(CreditDialogComponent, {
    width: '560px',
    maxWidth: '92vw',
    autoFocus: false,
    panelClass: 'credit-dialog-panel',
    data: {
      parentUid: c.parent_uid,
      parentName: c.parent_name ?? '',
      relatedChargeId: c.id,
    },
  });

  ref.afterClosed().subscribe(async (result) => {
    if (result?.saved) {
      await this.loadCharges();
      if (this.detailsOpenFor() === c.id) {
          await this.openChargeDetails(c.id);
    }
    }
  });
}

  // === תצוגה ===

  formatShekelsFromAgorot(agorot: number | null | undefined): string {
    const val = this.shekelsFromAgorot(agorot);
    return `${val.toFixed(2)} ₪`;
  }

  formatPeriod(c: ParentChargeRow): string {
    if (c.period_start && c.period_end) {
      return `${c.period_start} – ${c.period_end}`;
    }
    return c.period_start || c.period_end || '';
  }

  formatStatus(status: ParentChargeRow['status']): string {
    switch (status) {
      case 'draft':
        return 'טיוטה';
      case 'pending':
        return 'ממתין לחיוב';
      case 'open':
        return 'פתוח';
      case 'partial':
        return 'שולם חלקית';
      case 'paid':
        return 'שולם';
      case 'failed':
        return 'נכשל';
      case 'cancelled':
        return 'בוטל';
      default:
        return status ?? '';
    }
  }

  async openChargeDetails(chargeId: string) {
  try {
    this.detailsOpenFor.set(chargeId);
    this.detailsLoading.set(true);
    this.detailsError.set(null);

    const { data: items, error: e1 } = await dbTenant()
    .from('lesson_billing_items_with_office_note')

.select(`
  occur_date,
  start_datetime,
  child_id,
  child_name,
  unit_price_agorot,
  quantity,
  amount_agorot,
  office_note,
  billing_source,
  is_cancelled_billable
`)   .eq('charge_id', chargeId)
      .order('start_datetime', { ascending: true });

    if (e1) throw e1;

    const { data: credits, error: e2 } = await dbTenant()
      .from('parent_credits')
      .select('created_at,amount_agorot,reason,created_by')
      .eq('related_charge_id', chargeId)
      .order('created_at', { ascending: true });

    if (e2) throw e2;

    this.detailsItems.set(items ?? []);
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



  async runbilling() {
  try {
    this.loading.set(true);
    this.error.set(null);

    const now = new Date();
    const day = now.getDate();
    const billingDate = now.toISOString().slice(0, 10); // YYYY-MM-DD

    // להביא את כל ההורים שיום החיוב שלהם הוא היום
    const { data: parents, error } = await dbTenant()
      .from('parents')
      .select('uid')
      .eq('billing_day_of_month', day);

    if (error) throw error;

    const list = parents ?? [];

    // לעבור אחד-אחד ולהפעיל RPC
    let ok = 0;
    let failed = 0;


    for (const p of list) {
const { data, error: rpcError } = await dbTenant().rpc('create_monthly_charge_for_parent', {
  p_parent_uid: p.uid,
  p_billing_date: billingDate,
});

if (rpcError) {
  console.error('RPC failed', {
    message: rpcError.message,
    code: rpcError.code,
    details: rpcError.details,
    hint: rpcError.hint,
  });
}

else {
        ok++;
      }
    }


    // רענון מסך החיובים (כדי לראות את מה שנוצר)
    await this.loadCharges();

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
  const ref = this.dialog.open(AdditionalChargeDialogComponent, {
    width: '420px',
    data: {
      parentUid: c.parent_uid,
      parentName: c.parent_name || `${c.first_name} ${c.last_name}`.trim(),
    },
  });

  ref.afterClosed().subscribe(async (result) => {
    if (!result?.saved) return;

    try {
      this.loading.set(true);
      this.error.set(null);

      await this.createAdditionalCharge({
        parentUid: c.parent_uid,
        amountAgorot: result.amountAgorot,
        description: result.description,
      });

      await this.loadCharges();
         if (this.detailsOpenFor() === c.id) {
            await this.openChargeDetails(c.id);
    }
    } catch (e: any) {
      this.error.set(e?.message ?? 'שגיאה ביצירת חיוב נוסף');
    } finally {
      this.loading.set(false);
    }
  });
}
private async createAdditionalCharge(args: {
  parentUid: string;
  amountAgorot: number;
  description: string;
}) {
  const now = new Date();
  const isoNow = now.toISOString();

  const billingMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);

  const sb = dbTenant();

  // 1. בדיקה אם קיים כבר חיוב לחודש
  const { data: existing, error: fetchErr } = await sb
    .from('charges')
    .select('id, amount_agorot, description')
    .eq('parent_uid', args.parentUid)
    .eq('billing_month', billingMonth)
    .maybeSingle();

  if (fetchErr) throw fetchErr;

  if (existing) {
    // 2. עדכון חיוב קיים
    const { error: updateErr } = await sb
      .from('charges')
      .update({
        amount_agorot: existing.amount_agorot + args.amountAgorot,
        description: (existing.description || '') + ' | ' + args.description,
        updated_at: isoNow,
      })
      .eq('id', existing.id);

    if (updateErr) throw updateErr;

  } else {
    // 3. יצירת חיוב חדש
    const { error: insertErr } = await sb
      .from('charges')
      .insert({
        parent_uid: args.parentUid,
        amount_agorot: args.amountAgorot,
        currency: 'ILS',
        status: 'pending',
        description: args.description,
        billing_month: billingMonth,
        created_at: isoNow,
        updated_at: isoNow,
        office_note: 'חיוב נוסף שהוזן ידנית ע"י המזכירה',
      });

    if (insertErr) throw insertErr;
  }
}
}
