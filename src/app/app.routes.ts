import { Routes } from '@angular/router';
import { RoleGuard } from './shared/guards/role-guard';
import { LayoutComponent } from './layout/layout';
import { ParentPaymentsComponent } from './pages/parent-payments/parent-payments.component';
// import { BillingSuccessComponent } from './billing/billing-success.component';
// import { BillingErrorComponent } from './billing/billing-error.component';

export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: 'home', loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent) },
  // { path: 'login', loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent) },

  // ---------------------------------
  // 👨‍👩‍👧 אזור הורה
  // ---------------------------------
  {
    path: 'parent',
    loadComponent: () => import('./layout/layout').then(m => m.LayoutComponent),
    canActivate: [RoleGuard],
    data: { role: 'parent' },
    children: [
      { path: 'children', loadComponent: () => import('./pages/parent-children/parent-children').then(m => m.ParentChildrenComponent) },
      { path: 'schedule', loadComponent: () => import('./pages/schedule/parent-schedule/parent-schedule').then(m => m.ParentScheduleComponent) },
      { path: 'activity-summary', loadComponent: () => import('./pages/parent-activity-summary/parent-activity-summary').then(m => m.ParentActivitySummaryComponent) },
      { path: 'payments', loadComponent: () => import('./pages/parent-payments/parent-payments.component').then(m => m.ParentPaymentsComponent) },
      // { path: 'billing/success', component: BillingSuccessComponent },
      // { path: 'billing/error', component: BillingErrorComponent },
      { path: 'messages', loadComponent: () => import('./pages/messages/parent-messages/parent-messages').then(m => m.ParentMessagesComponent) },
      { path: 'details', loadComponent: () => import('./pages/parent-details/parent-details').then(m => m.ParentDetailsComponent) },
      // { path: '', redirectTo: 'children', pathMatch: 'full' }
    ]
  },

  // ---------------------------------
  // 🧑‍🏫 אזור מדריך
  // ---------------------------------
  {
    path: 'instructor',
    loadComponent: () => import('./layout/layout').then(m => m.LayoutComponent),
    canActivate: [RoleGuard],
    data: { role: 'instructor' },
    children: [
      { path: 'schedule', loadComponent: () => import('./pages/schedule/instructor-schedule/instructor-schedule').then(m => m.InstructorScheduleComponent) },
      { path: 'monthly-summary', loadComponent: () => import('./pages/monthly-summary/monthly-summary').then(m => m.MonthlySummaryComponent) }, // ✅ חדש
      { path: '', loadComponent: () => import('./pages/guide/guide.component').then(m => m.GuideComponent) }
    ]
  },

  // ---------------------------------
  // 🧾 אזור מזכירה
  // ---------------------------------
  {
    path: 'secretary',
    loadComponent: () => import('./layout/layout').then(m => m.LayoutComponent),
    canActivate: [RoleGuard],
    data: { role: 'secretary' },
    children: [
      { path: 'parents', loadComponent: () => import('./pages/secretary-parents/secretary-parents').then(m => m.SecretaryParentsComponent) },
      { path: 'regulations', loadComponent: () => import('./admin/agreements-admin.component/agreements-admin.component').then(m => m.AgreementsAdminComponent) },
      { path: 'children', loadComponent: () => import('./pages/secretary-children/secretary-children.component').then(m => m.SecretaryChildrenComponent) },
      { path: 'schedule', loadComponent: () => import('./pages/schedule/secretary-schedule/secretary-schedule').then(m => m.SecretaryScheduleComponent) },
      { path: 'messages', loadComponent: () => import('./pages/messages/secretary-messages/secretary-messages').then(m => m.SecretaryMessagesComponent) },
    ]
  },

  // ---------------------------------
  // 👑 אזור אדמין
  // ---------------------------------
  {
    path: 'admin',
    loadComponent: () => import('./layout/layout').then(m => m.LayoutComponent),
    canActivate: [RoleGuard],
    data: { role: 'admin' },
    children: [
      { path: '', loadComponent: () => import('./pages/admin/admin.component').then(m => m.AdminComponent) }
    ]
  },

  // ---------------------------------
  // 🔗 מסלולים כלליים
  // ---------------------------------
  { path: 'booking/:type', loadComponent: () => import('./pages/booking/booking.component').then(m => m.BookingComponent) },
  { path: '**', redirectTo: 'home' }
];
