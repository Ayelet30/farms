import { Routes } from '@angular/router';
import { RoleGuard } from './shared/guards/role-guard';
import { TenantReadyGuard } from './shared/guards/tenant-ready.guard';
import { LayoutComponent } from './layout/layout';
import { ParentPaymentsComponent } from './pages/parent-payments/parent-payments.component';
import { OneTimePaymentComponent } from './billing/one-time-payment/one-time-payment.component';
import { ParentHomeComponent } from './parent-home/parent-home';
// import { BillingSuccessComponent } from './billing/billing-success.component';
// import { BillingErrorComponent } from './billing/billing-error.component';

export const routes: Routes = [

  { path: '', redirectTo: 'home', pathMatch: 'full' },

  { path: 'home', loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent) },
  {
    path: 'accessibility',
    loadComponent: () =>
      import('./pages/accessibility/accessibility.component')
        .then(m => m.AccessibilityComponent)
  },

  {
    path: 'privacy-policy',
    loadComponent: () =>
      import('./pages/privacy-policy/privacy-policy.component')
        .then(m => m.PrivacyPolicyComponent)
  },

  {
    path: 'checkout/ride/:productId',
    component: OneTimePaymentComponent,
  },

  {
    path: 'register-independent/:farm',
    loadComponent: () =>
      import('./independent-signup/independent-signup.component')
        .then(m => m.IndependentPublicSignupComponent),
  },

  {
    path: 'register/:farm',
    loadComponent: () => import('./parent-signup/parent-signup.component')
      .then(m => m.ParentPublicSignupComponent)
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
      { path: '', component: ParentHomeComponent },
      { path: 'children', loadComponent: () => import('./pages/parent-children/parent-children').then(m => m.ParentChildrenComponent) },
      { path: 'schedule', loadComponent: () => import('./pages/schedule/parent-schedule/parent-schedule').then(m => m.ParentScheduleComponent) },
      { path: 'appointment', loadComponent: () => import('./appointment-scheduler/appointment-scheduler.component').then(m => m.AppointmentSchedulerComponent) },
      { path: 'activity-summary', loadComponent: () => import('./pages/parent-activity-summary/parent-activity-summary').then(m => m.ParentActivitySummaryComponent) },
      { path: 'waitlist', loadComponent: () => import('./waitlist/waitlist-my.page').then(m => m.WaitlistMyPage) },
      { path: 'payments', loadComponent: () => import('./pages/parent-payments/parent-payments.component').then(m => m.ParentPaymentsComponent) },
      { path: 'messages', loadComponent: () => import('./pages/messages/parent-messages/parent-messages').then(m => m.ParentMessagesComponent) },
      { path: 'details', loadComponent: () => import('./pages/parent-details/parent-details').then(m => m.ParentDetailsComponent) },
      {
        path: 'requests',
        loadComponent: () =>
          import('./secretarial-requests-page/secretarial-requests-page.component')
            .then(m => m.SecretarialRequestsPageComponent)
      },
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
            .then(m => m.MonthlySummaryComponent),
        data: {
          monthlyTitle: 'הסיכום החודשי שלי',
          yearlyTitle: 'הסיכום השנתי שלי',
        },
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./pages/instructor-settings/instructor-settings')
            .then(m => m.InstructorSettingsComponent)
      },

      {
        path: 'availability',
        loadComponent: () =>
          import('./pages/availability-tab/availability-tab')
            .then(m => m.AvailabilityTabComponent)
      },
      {
        path: 'requests',
        loadComponent: () =>
          import('./secretarial-requests-page/secretarial-requests-page.component')
            .then(m => m.SecretarialRequestsPageComponent)
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
        path: 'instructors',
        loadComponent: () =>
          import('./pages/secretary-instructors/secretary-instructors.component')
            .then(m => m.SecretaryInstructorsComponent)
      },
      {
        path: 'independent-riders',
        loadComponent: () =>
          import('./pages/secretary-independent-riders/secretary-independent-riders')
            .then(m => m.SecretaryIndependentRidersComponent),
      },
      {
        path: 'horses',
        loadComponent: () =>
          import('./pages/secretary-horses/secretary-horses.component')
            .then(m => m.SecretaryHorsesComponent)
      },
      {
        path: 'arenas',
        loadComponent: () =>
          import('./pages/secretary-arenas/secretary-arenas.component')
            .then(m => m.SecretaryArenasComponent)
      },
      {
        path: 'rider-services',
        loadComponent: () =>
          import('./pages/secretary-rider-services/secretary-rider-services')
            .then(m => m.SecretaryRiderServicesComponent)
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
        path: 'rider-service-tasks',
        loadComponent: () =>
          import('./pages/secretary-rider-service-tasks/secretary-rider-service-tasks')
            .then(m => m.SecretaryRiderServiceTasksComponent)
      },
      {
        path: 'rider-billing',
        loadComponent: () =>
          import('./pages/secretary-rider-billing/secretary-rider-billing.component')
            .then(m => m.SecretaryRiderBillingComponent),
      },
      {
        path: 'claims',
        loadComponent: () =>
          import('./pages/claims-page/claims-page.component')
            .then(m => m.ClaimsPageComponent)
      },
      {
        path: 'waitlist',
        loadComponent: () =>
          import('./waitlist/waitlist-board.page')
            .then(m => m.WaitlistBoardPage)
      },
      {
        path: 'monthly-summary',
        loadComponent: () =>
          import('./pages/monthly-summary/monthly-summary')
            .then(m => m.MonthlySummaryComponent),
        data: {
          monthlyTitle: 'הסיכום החודשי של החווה',
          yearlyTitle: 'הסיכום השנתי של החווה',
        },
      },
      {
        path: 'requests',
        loadComponent: () =>
          import('./secretarial-requests-page/secretarial-requests-page.component')
            .then(m => m.SecretarialRequestsPageComponent)
      },
      {
        path: 'payments',
        loadComponent: () =>
          import('./pages/secretary-payments/secretary-payments.component')
            .then(m => m.SecretaryPaymentsComponent)
      },
      {
        path: 'billing',
        loadComponent: () =>
          import('./pages/secretary-parent-billing/secretary-parent-billing.component')
            .then(m => m.SecretaryParentBillingComponent)
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./pages/farm-settings/farm-settings.component')
            .then(m => m.FarmSettingsComponent)
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
    data: { role: 'admin' },
    children: [
      {
        path: 'email',
        loadComponent: () =>
          import('../admin-email/admin-email.page').then(m => m.AdminEmailPage)
      },
      {
        path: 'clalit',
        loadComponent: () =>
          import('../admin-clalit/admin-clalit.page').then(m => m.AdminClalitPage)
      },
      {
        path: 'hmo-integrations',
        loadComponent: () =>
          import('../admin-hmo/admin-hmo-integrations.page').then(m => m.AdminHmoIntegrationsPage)
      },
      {
      path: 'billing',
      loadComponent: () =>
        import('./admin/admin-billing/admin-billing')
          .then(m => m.AdminBillingComponent)
    }
      // {
      //   path: 'addChildren',
      //   loadComponent: () =>
      //     import('../admin-addCChildren/admin-addChildren.page').then(m => m.AdminAddChildrenPage)
      // },

    ]
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
  {
    path: 'independent',
    loadComponent: () =>
      import('./layout/layout').then(m => m.LayoutComponent),
    canActivate: [RoleGuard, TenantReadyGuard],
    data: { role: 'independent' },
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/independent-home/independent-home.component')
            .then(m => m.IndependentHomeComponent),
      },

      {
        path: 'appointment',
        loadComponent: () =>
          import('./pages/independent-service-request/independent-service-request.component')
            .then(m => m.IndependentServiceRequestComponent),
      },
      {
        path: 'my-services',
        loadComponent: () =>
          import('./pages/independent-my-services/independent-my-services')
            .then(m => m.IndependentMyServicesComponent)
      },
      // {
      //   path: 'billing',
      //   loadComponent: () =>
      //     import('./pages/independent-billing/independent-billing.component')
      //       .then(m => m.IndependentBillingComponent),
      // },
      {
        path: 'requests',
        loadComponent: () =>
          import('./secretarial-requests-page/secretarial-requests-page.component')
            .then(m => m.SecretarialRequestsPageComponent),
      },
      {
        path: 'details',
        loadComponent: () =>
          import('./pages/independent-details/independent-details.component')
            .then(m => m.IndependentDetailsComponent),
      },
      {
        path: 'horses',
        loadComponent: () =>
          import('./pages/independent-horses/independent-horses.component')
            .then(m => m.IndependentHorsesComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'home' },
];
