import { Routes } from '@angular/router';
import { RoleGuard } from './shared/guards/role-guard';
import { TenantReadyGuard } from './shared/guards/tenant-ready.guard';
import { LayoutComponent } from './layout/layout';
import { ParentPaymentsComponent } from './pages/parent-payments/parent-payments.component';
import { OneTimePaymentComponent } from './billing/one-time-payment/one-time-payment.component';
// import { BillingSuccessComponent } from './billing/billing-success.component';
// import { BillingErrorComponent } from './billing/billing-error.component';

export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },

  { path: 'home', loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent) },

  {
    path: 'checkout/ride/:productId',
    component: OneTimePaymentComponent,
  },

  { path: 'booking/:type', loadComponent: () => import('./pages/booking/booking.component').then(m => m.BookingComponent) },


  /* ------------------------------------
     הורה
  ------------------------------------ */
  {
    path: 'parent',
    loadComponent: () =>
      import('./layout/layout').then(m => m.LayoutComponent),
    canActivate: [RoleGuard, TenantReadyGuard],
    data: { role: 'parent' },
    children: [
      { path: 'children', loadComponent: () => import('./pages/parent-children/parent-children').then(m => m.ParentChildrenComponent) },
      { path: 'schedule', loadComponent: () => import('./pages/schedule/parent-schedule/parent-schedule').then(m => m.ParentScheduleComponent) },
      { path: 'appointment', loadComponent: () => import('./appointment-scheduler/appointment-scheduler.component').then(m => m.AppointmentSchedulerComponent) },
      { path: 'activity-summary', loadComponent: () => import('./pages/parent-activity-summary/parent-activity-summary').then(m => m.ParentActivitySummaryComponent) },
      { path: 'payments', loadComponent: () => import('./pages/parent-payments/parent-payments.component').then(m => m.ParentPaymentsComponent) },
      { path: 'messages', loadComponent: () => import('./pages/messages/parent-messages/parent-messages').then(m => m.ParentMessagesComponent) },
      { path: 'details', loadComponent: () => import('./pages/parent-details/parent-details').then(m => m.ParentDetailsComponent) },
    ]
  },

  /* ------------------------------------
     מדריך
  ------------------------------------ */
  {
    path: 'instructor',
    loadComponent: () =>
      import('./layout/layout').then(m => m.LayoutComponent),
    canActivate: [RoleGuard, TenantReadyGuard],
    data: { role: 'instructor' },
    children: [
      {
        path: 'schedule',
        loadComponent: () =>
          import('./pages/schedule/instructor-schedule/instructor-schedule')
            .then(m => m.InstructorScheduleComponent)
      },
      {
        path: 'monthly-summary',
        loadComponent: () =>
          import('./pages/monthly-summary/monthly-summary')
            .then(m => m.MonthlySummaryComponent)
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./pages/instructor-settings/instructor-settings')
            .then(m => m.InstructorSettingsComponent)
      },

      /* ⭐⭐⭐ חדש — העדפות זמינות ⭐⭐⭐ */
      {
        path: 'availability',
        loadComponent: () =>
          import('./pages/availability-tab/availability-tab')
            .then(m => m.AvailabilityTabComponent)
      },

      {
        path: '',
        loadComponent: () =>
          import('./pages/guide/guide.component')
            .then(m => m.GuideComponent)
      },
    ]
  },

  /* ------------------------------------
     מזכירה
  ------------------------------------ */
  {
    path: 'secretary',
    loadComponent: () =>
      import('./layout/layout').then(m => m.LayoutComponent),
    canActivate: [RoleGuard, TenantReadyGuard],
    data: { role: 'secretary' },
    children: [
      {
        path: 'parents',
        loadComponent: () =>
          import('./pages/secretary-parents/secretary-parents')
            .then(m => m.SecretaryParentsComponent)
      },
      {
        path: 'regulations',
        loadComponent: () =>
          import('./admin/agreements-admin.component/agreements-admin.component')
            .then(m => m.AgreementsAdminComponent)
      },
      {
        path: 'children',
        loadComponent: () =>
          import('./pages/secretary-children/secretary-children.component')
            .then(m => m.SecretaryChildrenComponent)
      },
      {
        path: 'schedule',
        loadComponent: () =>
          import('./pages/schedule/secretary-schedule/secretary-schedule')
            .then(m => m.SecretaryScheduleComponent)
      },
      { path: 'appointment', loadComponent: () => import('./appointment-scheduler/appointment-scheduler.component').then(m => m.AppointmentSchedulerComponent) },
      {
        path: 'messages',
        loadComponent: () =>
          import('./pages/messages/secretary-messages/secretary-messages')
            .then(m => m.SecretaryMessagesComponent)
      },
      {
        path: 'requests',
        loadComponent: () =>
          import('./secretarial-requests-page/secretarial-requests-page.component')
            .then(m => m.SecretarialRequestsPageComponent)
      },
    ]
  },

  /* ------------------------------------
     אדמין
  ------------------------------------ */
  {
    path: 'admin',
    loadComponent: () =>
      import('./pages/admin/admin.component').then(m => m.AdminComponent),
    canActivate: [RoleGuard, TenantReadyGuard],
    data: { role: 'admin' }
  },

  /* ------------------------------------
     דף הזמנות
  ------------------------------------ */
  {
    path: 'booking/:type',
    loadComponent: () =>
      import('./pages/booking/booking.component')
        .then(m => m.BookingComponent)
  },

  { path: '**', redirectTo: 'home' },
];
