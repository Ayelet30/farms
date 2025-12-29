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

import { createParentCredit, getCurrentFarmMetaSync } from '../../services/supabaseClient.service';

import {
  PaymentsService,
  ParentChargeRow,
} from '../../services/payments.service';
import { dbTenant } from '../../services/supabaseClient.service';
import { TranzilaService } from '../../services/tranzila.service';

@Component({
  selector: 'app-secretary-parent-billing',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './secretary-parent-billing.component.html',
  styleUrls: ['./secretary-parent-billing.component.scss'],
})
export class SecretaryParentBillingComponent implements OnInit {

  private tranzila = inject(TranzilaService);
  
  // === פילטרים ===
  parentNameFilter = signal<string>('');

  // נתונים
  charges = signal<ParentChargeRow[]>([]);

  // סטטוסים
  loading = signal(false);
  error = signal<string | null>(null);

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
  visibleCharges = computed(() =>
    this.activeTab() === 'open' ? this.openCharges() : this.charges()
  );

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

  /** אם יש בחירה – מה ה־parent_uid שלה, ואם יש יותר מאחד יהיה null */
  selectedParentUid = computed<string | null>(() => {
    const ids = this.selectedChargeIds();
    if (!ids.size) return null;

    let parent: string | null = null;
    for (const c of this.openCharges()) {
      if (ids.has(c.id)) {
        if (parent == null) {
          parent = c.parent_uid;
        } else if (parent !== c.parent_uid) {
          return null; // מעורבבים הורים שונים
        }
      }
    }
    return parent;
  });

  // === lifecycle ===

  async ngOnInit() {
    await this.loadCharges();
  }

  async loadCharges() {
    const { thtk } = await this.tranzila.getHandshakeToken();
      this.thtk = thtk;
    try {
      this.loading.set(true);
      this.error.set(null);

      const parentUid = this.parentNameFilter().trim() || null;

      const { rows } = await this.payments.listParentCharges({
        parentUid,
        limit: 200,
      });

      this.charges.set(rows);
      this.selectedChargeIds.set(new Set());
    } catch (e: any) {
      console.error('[ParentBilling] load error', e);
      this.error.set(e?.message ?? 'שגיאה בטעינת החיובים');
    } finally {
      this.loading.set(false);
    }
  }

  // שינוי סינון UID
  async onParentNameFilterChange(name: string) {
    this.parentNameFilter.set(name);
    await this.loadCharges();
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
  console.log("!!!!!!!!!!!");
  if (!this.anySelected()) return;

  const parentUid = this.selectedParentUid();
  if (!parentUid) {
    this.error.set('ניתן לחייב בבת אחת רק הורה אחד...');
    return;
  }

  try {
    this.loading.set(true);
    this.error.set(null);

    const ids = Array.from(this.selectedChargeIds());

     const farm = getCurrentFarmMetaSync();
    const schema = farm?.schema_name ?? undefined;
    console.log('Charging parent charges', { parentUid, ids, schema });
    await this.tranzila.chargeSelectedChargesForParent({
      tenantSchema: schema?? farm?.schema_name ?? 'public',
      parentUid,
      chargeIds: ids,
      secretaryEmail: 'ayelethury@gmail.com', // או מהמזכירה המחוברת
    });

    await this.loadCharges();
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
  this.creditParentUid.set(c.parent_uid);
  this.creditParentName.set(c.parent_name ?? '');
  this.creditRelatedChargeId.set(c.id); // זיכוי על חיוב מסוים
  this.creditSuccess.set(null);
  this.creditError.set(null);
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
      .from('lesson_billing_items')
      .select('occur_date,start_datetime,child_id,unit_price_agorot,quantity,amount_agorot')
      .eq('charge_id', chargeId)
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
    console.log('🟣 runbilling start', { day, billingDate, count: list.length });

    // לעבור אחד-אחד ולהפעיל RPC
    let ok = 0;
    let failed = 0;

    for (const p of list) {
      const { error: rpcError } = await dbTenant().rpc('create_monthly_charge_for_parent', {
        p_parent_uid: p.uid,
        p_billing_date: billingDate,
      });

      if (rpcError) {
        failed++;
        console.error(`❌ parent ${p.uid} failed`, rpcError);
      } else {
        ok++;
        console.log(`✅ created charge for ${p.uid}`);
      }
    }

    console.log('🟢 runbilling done', { ok, failed });

    // רענון מסך החיובים (כדי לראות את מה שנוצר)
    await this.loadCharges();

  } catch (e: any) {
    console.error('[ParentBilling] runbilling error', e);
    this.error.set(e?.message ?? 'שגיאה בהרצת חיוב יזום');
  } finally {
    this.loading.set(false);
  }
}

}
