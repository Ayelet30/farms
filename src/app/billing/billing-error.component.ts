// app/billing/billing-error.component.ts
import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  standalone: true,
  selector: 'app-billing-error',
  template: `
  <div class="card">
    <h2>אירעה שגיאה בתשלום</h2>
    <p>ייתכן שהעסקה בוטלה או נכשלה. נסי שוב או פני לתמיכה.</p>
    <button (click)="goBack()">חזרה לאמצעי התשלום</button>
  </div>
  `
})
export class BillingErrorComponent {
  constructor(private router: Router) {}
  goBack(){ this.router.navigate(['/parent/payments']); }
}
