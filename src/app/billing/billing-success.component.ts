// app/billing/billing-success.component.ts
import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  standalone: true,
  selector: 'app-billing-success',
  template: `
  <div class="card">
    <h2>התשלום נשמר בהצלחה</h2>
    <p>אם הגעת לכאן אחרי הוספת אמצעי תשלום – הטוקן נשמר בפרופיל שלך.</p>
    <button (click)="goBack()">חזרה לאמצעי התשלום</button>
  </div>
  `
})
export class BillingSuccessComponent {
  constructor(private router: Router) {}
  goBack(){ this.router.navigate(['/parent/payments']); }
}
