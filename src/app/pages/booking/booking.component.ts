import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

type FarmOption = {
  id: string;
  name: string;
};

export type BookingPayload = {
  type: string;          // סוג רכיבה (western / therapy ...)
  productName: string;   // שם מוצר לתצוגה
  farmId: string;
  farmName: string;
  fullName: string;
  phone: string;
  email: string;
  amountAgorot: number;  // כרגע 1 ₪ קבוע
};

@Component({
  standalone: true,
  selector: 'app-booking',
  imports: [CommonModule, FormsModule],
  templateUrl: './booking.component.html',
  styleUrls: ['./booking.component.scss'],
})
export class BookingComponent implements OnInit {

  type = '';
  productName = 'רכיבה חד־פעמית';
  amountAgorot = 100; // 1 ₪ כרגע קבוע

  farms: FarmOption[] = [
    { id: 'bereshit', name: 'חוות בראשית' },
    { id: 'psagot', name: 'חוות פסגות' },
    { id: 'retorno', name: 'חוות רטורנו' },
  ];

  model: {
    farmId: string;
    fullName: string;
    phone: string;
    email: string;
  } = {
    farmId: '',
    fullName: '',
    phone: '',
    email: '',
  };

  successMessage: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit(): void {
    // סוג הרכיבה מה-URL: /booking/western
    this.type = this.route.snapshot.paramMap.get('type') ?? 'western';

    // אפשר מיפוי לפי type – כרגע 2 דוגמאות
    if (this.type === 'western') {
      this.productName = 'רכיבה מערבית';
    } else if (this.type === 'therapy') {
      this.productName = 'רכיבה טיפולית';
    }

    // אם חזרנו מדף התשלום עם אישור – נציג הודעה ונוכל לשמור ל-DB כאן
    const state: any = history.state;
    if (state?.tx) {
      this.successMessage = 'התשלום בוצע בהצלחה! מספר אסמכתא: ' + (state.tx?.confirmation || state.tx?.index || '');
      // כאן המקום לקרוא לפונקציה ששומרת ב-DB:
      // this.saveBookingToDb(state.booking, state.tx);
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

  onSubmit() {
    if (!this.canSubmit) return;

    const farm = this.farms.find(f => f.id === this.model.farmId)!;

    const booking: BookingPayload = {
      type: this.type,
      productName: this.productName,
      farmId: farm.id,
      farmName: farm.name,
      fullName: this.model.fullName,
      phone: this.model.phone,
      email: this.model.email,
      amountAgorot: this.amountAgorot,
    };

    // מעבר לדף התשלום עם ה-state
    this.router.navigate(['/checkout/ride', this.type], {
      state: { booking },
    });
  }

  // דוגמה למקום שבו תשמרי ל-DB (תממשי כשיהיה לך API)
  // private async saveBookingToDb(booking: BookingPayload, tx: any) {
  //   await this.myBookingService.save({ booking, tx });
  // }
}
