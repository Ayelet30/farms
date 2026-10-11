import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminBillingService } from '../../services/admin-billing';

type PaymentType = 'one_time' | 'monthly' | 'credit';

@Component({
  selector: 'app-admin-billing',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-billing.html',
  styleUrl: './admin-billing.css',
})
export class AdminBillingComponent implements OnInit {
  loading = signal(false);
  error = signal<string | null>(null);
  success = signal<string | null>(null);

  farmRows = signal<any[]>([]);
  customers = signal<any[]>([]);
  selectedFarmId = '';
  payments = signal<any[]>([]);

  showCustomerForm = false;
  showChargeForm = false;

  selectedFarmName = '';

  newCustomer = {
    farm_id: '',
    farm_name: '',
    contact_name: '',
    email: '',
    phone: '',
    business_id: '',
  };

  manualPaymentForm = {
  farm_id: '',
  customer_id: '',
  farm_name: '',
  email: '',
  amount: 0,
  description: '',
  payment_type: 'setup' as 'setup' | 'one_time' | 'monthly' | 'credit',
  manual_payment_method: 'העברה בנקאית',
  receipt_url: '',
  receipt_file_name: '',
};

showManualPaymentForm = false;

  paymentForm = {
    customer_id: '',
    amount: 0,
    description: '',
    payment_type: 'one_time' as PaymentType,
    billing_day: 1,
  };

  constructor(private billing: AdminBillingService) {}

  async ngOnInit() {
    await this.loadData();
  }

  async loadData() {
  this.loading.set(true);
  this.error.set(null);

  try {
    const [payments, rows] = await Promise.all([
      this.billing.getPayments(),
      this.billing.getFarmBillingRows(),
    ]);

    this.payments.set(payments);
    this.farmRows.set(rows);
    this.customers.set(
      rows
        .filter((r: any) => r.customer_id)
        .map((r: any) => ({
          id: r.customer_id,
          farm_name: r.farm_name,
          email: r.email,
        }))
    );
  } catch (e: any) {
    this.error.set(e.message || 'שגיאה בטעינת נתונים');
  } finally {
    this.loading.set(false);
  }
}

  statusText(status: string | null) {
    switch (status) {
      case 'paid':
        return 'שולם';
      case 'failed':
        return 'נכשל';
      case 'pending':
        return 'פתוח';
      case 'cancelled':
        return 'בוטל';
      default:
        return 'לא קיים';
    }
  }

  paymentTypeText(type: string | null) {
    switch (type) {
      case 'one_time':
        return 'חד פעמי';
      case 'monthly':
        return 'חודשי';
      case 'credit':
        return 'זיכוי';
      default:
        return '-';
    }
  }

  resetCustomerForm() {
    this.newCustomer = {
      farm_id: '',
      farm_name: '',
      contact_name: '',
      email: '',
      phone: '',
      business_id: '',
    };
  }

  resetPaymentForm() {
    this.paymentForm = {
      customer_id: '',
      amount: 0,
      description: '',
      payment_type: 'one_time',
      billing_day: 1,
    };
    this.selectedFarmName = '';
    this.selectedFarmId = '';
  }

  async createCustomer() {
    if (!this.newCustomer.farm_name.trim()) {
      this.error.set('חסר שם חווה');
      return;
    }

    if (!this.newCustomer.email.trim()) {
      this.error.set('חסר אימייל לקבלות');
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    this.success.set(null);

    try {
      await this.billing.upsertCustomer(this.newCustomer);
      this.success.set('החווה נוספה למעקב חיובים');
      this.resetCustomerForm();
      this.showCustomerForm = false;
      await this.loadData();
    } catch (e: any) {
      this.error.set(e.message || 'שגיאה ביצירת חווה לחיוב');
    } finally {
      this.loading.set(false);
    }
  }

  openOneTimeCharge(row: any) {
    this.showChargeForm = true;
    this.selectedFarmName = row.farm_name;
    this.selectedFarmId = row.farm_id;

    this.paymentForm = {
      customer_id: row.customer_id,
      amount: 0,
      description: `חיוב חד פעמי - ${row.farm_name}`,
      payment_type: 'one_time',
      billing_day: 1,
    };
  }

  openMonthlyCharge(row: any) {
    this.showChargeForm = true;
    this.selectedFarmName = row.farm_name;
    this.selectedFarmId = row.farm_id;

    this.paymentForm = {
      customer_id: row.customer_id,
      amount: row.monthly_amount_agorot ? row.monthly_amount_agorot / 100 : 0,
      description: `תשלום חודשי - ${row.farm_name}`,
      payment_type: 'monthly',
      billing_day: row.billing_day || 1,
    };
  }

  openManualPayment(row: any, type: 'setup' | 'one_time' | 'monthly' | 'credit' = 'setup') {
  this.showManualPaymentForm = true;

  this.manualPaymentForm = {
    farm_id: row.farm_id,
    customer_id: row.customer_id || '',
    farm_name: row.farm_name,
    email: row.email || '',
    amount: 0,
    description: type === 'setup'
      ? `תשלום התקנה - ${row.farm_name}`
      : `תשלום ידני - ${row.farm_name}`,
    payment_type: type,
    manual_payment_method: 'העברה בנקאית',
    receipt_url: '',
    receipt_file_name: '',
  };
}

async markPaidManually() {
  this.loading.set(true);
  this.error.set(null);
  this.success.set(null);

  try {
    await this.billing.markPaidManually({
      farm_id: this.manualPaymentForm.farm_id,
      customer_id: this.manualPaymentForm.customer_id || null,
      farm_name: this.manualPaymentForm.farm_name,
      email: this.manualPaymentForm.email || null,
      amount_agorot: Math.round(Number(this.manualPaymentForm.amount) * 100),
      description: this.manualPaymentForm.description,
      payment_type: this.manualPaymentForm.payment_type,
      manual_payment_method: this.manualPaymentForm.manual_payment_method,
      receipt_url: this.manualPaymentForm.receipt_url || null,
      receipt_file_name: this.manualPaymentForm.receipt_file_name || null,
    });

    this.success.set('התשלום סומן כשולם ידנית');
    this.showManualPaymentForm = false;
    await this.loadData();
  } catch (e: any) {
    this.error.set(e.message || 'שגיאה בסימון תשלום ידני');
  } finally {
    this.loading.set(false);
  }
}

  openCredit(row: any) {
    this.showChargeForm = true;
    this.selectedFarmName = row.farm_name;
    this.selectedFarmId = row.farm_id;

    this.paymentForm = {
      customer_id: row.customer_id,
      amount: 0,
      description: `זיכוי - ${row.farm_name}`,
      payment_type: 'credit',
      billing_day: 1,
    };
  }

  async createPaymentLink() {
    if (!this.paymentForm.customer_id) {
      this.error.set('חסר לקוח לחיוב');
      return;
    }

    if (!this.paymentForm.amount || Number(this.paymentForm.amount) <= 0) {
      this.error.set('חסר סכום תקין');
      return;
    }

    if (!this.paymentForm.description.trim()) {
      this.error.set('חסר תיאור חיוב');
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    this.success.set(null);

    try {
      const amountAgorot = Math.round(Number(this.paymentForm.amount) * 100);

      const result = await this.billing.createPaymentLink({
        farm_id: this.selectedFarmId,
        customer_id: this.paymentForm.customer_id || null,
        amount_agorot: amountAgorot,
        description: this.paymentForm.description,
        payment_type: this.paymentForm.payment_type,
        billing_day: this.paymentForm.billing_day,
      });

      if (result?.paymentUrl) {
        window.open(result.paymentUrl, '_blank');
      }

      this.success.set('קישור התשלום נוצר בהצלחה');
      this.showChargeForm = false;
      this.resetPaymentForm();
      await this.loadData();
    } catch (e: any) {
      this.error.set(e.message || 'שגיאה ביצירת קישור תשלום');
    } finally {
      this.loading.set(false);
    }
  }

  async resendReceipt(paymentId: string) {
    this.loading.set(true);
    this.error.set(null);
    this.success.set(null);

    try {
      await this.billing.resendReceipt(paymentId);
      this.success.set('הקבלה נשלחה שוב בהצלחה');
    } catch (e: any) {
      this.error.set(e.message || 'שגיאה בשליחת קבלה');
    } finally {
      this.loading.set(false);
    }
  }
}