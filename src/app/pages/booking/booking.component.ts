import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { BookingDataService, FarmOption } from '../../services/booking-data.service';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { OneTimePaymentComponent } from '../../billing/one-time-payment/one-time-payment.component'; // להתאים נתיב


export type BookingPayload = {
  type: string;          // סוג רכיבה (western / therapy ...)
  productName: string;   // שם מוצר לתצוגה
  farmId: string;
  farmName: string;
  fullName: string;
  phone: string;
  email: string;
  amountAgorot: number;  // כרגע 1 ₪ קבוע

  // שדות חדשים
  age?: number | null;
  weightKg?: number | null;
  heightCm?: number | null;
  notes?: string | null;
};

@Component({
  standalone: true,
  selector: 'app-booking',
  imports: [CommonModule, FormsModule, MatDialogModule],
  templateUrl: './booking.component.html',
  styleUrls: ['./booking.component.scss'],
})
export class BookingComponent implements OnInit {

  type = '';
  productName = 'רכיבה חד־פעמית';
  amountAgorot = 100; // 1 ₪ כרגע קבוע

  farms: FarmOption[] = [];

  model: {
    farmId: string;
    fullName: string;
    phone: string;
    email: string;
    age: number | null;
    weightKg: number | null;
    heightCm: number | null;
    notes: string | null;
  } = {
    farmId: '',
    fullName: '',
    phone: '',
    email: '',
    age: null,
    weightKg: null,
    heightCm: null,
    notes: null,
  };

  loadingFarms = false;
  farmsError: string | null = null;

  successMessage: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private bookingData: BookingDataService,
    private dialog: MatDialog,
  ) {}

  async ngOnInit(): Promise<void> {
    // סוג הרכיבה מה-URL: /booking/western
    this.type = this.route.snapshot.paramMap.get('type') ?? 'western';

    // אפשר מיפוי לפי type – כרגע 2 דוגמאות
    if (this.type === 'western') {
      this.productName = 'רכיבה מערבית';
    } else if (this.type === 'therapy') {
      this.productName = 'רכיבה טיפולית';
    } else {
      this.productName = 'רכיבה חד־פעמית';
    }

    // אם חזרנו מדף התשלום עם אישור – נציג הודעה
    const state: any = history.state;
    if (state?.tx) {
      this.successMessage =
        'התשלום בוצע בהצלחה! מספר אסמכתא: ' +
        (state.tx?.confirmation || state.tx?.index || '');
      // כאן אפשר לשמור ל-DB:
      // this.saveBookingToDb(state.booking, state.tx);
    }

    // טעינת חוות מה-DB לפי סוג הרכיבה
    await this.loadFarms();
  }

  private async loadFarms(): Promise<void> {
    this.loadingFarms = true;
    this.farmsError = null;
    try {
      this.farms = await this.bookingData.loadFarmsByRidingType(this.type);

      // אם אין חוות שמחזירות את הסוג הזה – אפשר להציג הודעה
      if (!this.farms.length) {
        this.farmsError = 'לא נמצאו חוות שמציעות את סוג הרכיבה הזה.';
      }
    } catch (err: any) {
      this.farmsError = 'שגיאה בטעינת רשימת החוות. נסי שוב מאוחר יותר.';
    } finally {
      this.loadingFarms = false;
    }
  }

  get canSubmit(): boolean {
    return !!(
      this.model.farmId &&
      this.model.fullName &&
      this.model.phone &&
      this.model.email
    );
  }

    onSubmit(): void {
    if (!this.canSubmit) return;

    const farm = this.farms.find(f => f.id === this.model.farmId);
    if (!farm) return;

    const booking: BookingPayload = {
      type: this.type,
      productName: this.productName,
      farmId: farm.id,
      farmName: farm.name,
      fullName: this.model.fullName,
      phone: this.model.phone,
      email: this.model.email,
      amountAgorot: this.amountAgorot,
      age: this.model.age,
      weightKg: this.model.weightKg,
      heightCm: this.model.heightCm,
      notes: this.model.notes,
    };

    const dialogRef = this.dialog.open(OneTimePaymentComponent, {
      width: '480px',
      maxWidth: '95vw',
      disableClose: true,
      data: { booking },
    });

    dialogRef.afterClosed().subscribe(tx => {
      if (tx) {
        // תשלום הצליח
        this.successMessage =
          'התשלום בוצע בהצלחה! מספר אסמכתא: ' +
          (tx.confirmation || tx.index || '');
        // כאן אחר כך תוכלי לקרוא לשמירה ל-DB
      }
    });
  }

  goHome(): void {
    // להתאים לנתיב ה"בית" אצלך – אם זה '/', תכתבי this.router.navigate(['/']);
    this.router.navigate(['/home']);
  }

  // דוגמה למקום שבו תשמרי ל-DB (תממשי כשיהיה לך API)
  // private async saveBookingToDb(booking: BookingPayload, tx: any) {
  //   await this.myBookingService.save({ booking, tx });
  // }
}
