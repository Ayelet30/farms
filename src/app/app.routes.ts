import { Routes } from '@angular/router';
import { RoleGuard } from './shared/guards/role-guard';
import { LayoutComponent } from './layout/layout';


export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: 'home', loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent) },
  // { path: 'login', loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent) },
  {
    path: 'parent',
    loadComponent: () => import('./layout/layout').then(m => m.LayoutComponent),
    canActivate: [RoleGuard],
    data: { role: 'parent' },
    children: [
      { path: 'children', loadComponent: () => import('./pages/parent-children/parent-children').then(m => m.ParentChildrenComponent) },
      { path: 'schedule', loadComponent: () => import('./pages/parent-schedule/parent-schedule').then(m => m.ParentScheduleComponent) },
    //   { path: 'summary', loadComponent: () => import('./pages/parent/parent-summary/parent-summary.component').then(m => m.ParentSummaryComponent) },
    //   { path: 'payments', loadComponent: () => import('./pages/parent/parent-payments/parent-payments.component').then(m => m.ParentPaymentsComponent) },
      { path: 'notes', loadComponent: () => import('./pages/parent-notes/parent-notes').then(m => m.ParentNotesComponent) },
      { path: 'details', loadComponent: () => import('./pages/parent-details/parent-details').then(m => m.ParentDetailsComponent) },
      //   { path: '', redirectTo: 'children', pathMatch: 'full' }
    ]
  },
  {
    path: 'instructor',
    loadComponent: () => import('./layout/layout').then(m => m.LayoutComponent),
    canActivate: [RoleGuard],
    data: { role: 'instructor' },
    children: [
      { path: 'schedule', loadComponent: () => import('./pages/schedule/instructor-schedule/instructor-schedule').then(m => m.InstructorScheduleComponent) },
    ]
  },
  {
    path: 'secretary',
    loadComponent: () => import('./layout/layout').then(m => m.LayoutComponent),
    canActivate: [RoleGuard],
    data: { role: 'secretary' },
    children: [
      { path: 'parents', loadComponent: () => import('./pages/secretary-parents/secretary-parents').then(m => m.SecretaryParentsComponent) },
    ]
  },
  { path: 'admin', loadComponent: () => import('./pages/admin/admin.component').then(m => m.AdminComponent), canActivate: [RoleGuard], data: { role: 'admin' } },
  { path: 'booking/:type', loadComponent: () => import('./pages/booking/booking.component').then(m => m.BookingComponent) },
  { path: '**', redirectTo: 'home' },
  {
    path: 'instructor',
    loadComponent: () => import('./layout/layout').then(m => m.LayoutComponent),
    canActivate: [RoleGuard],
    data: { role: 'instructor' },
    children: [
      { path: '', loadComponent: () => import('./pages/guide/guide.component').then(m => m.GuideComponent) }
    ]
  },
  {
    path: 'admin',
    loadComponent: () => import('./layout/layout').then(m => m.LayoutComponent),
    canActivate: [RoleGuard],
    data: { role: 'admin' },
    children: [
      { path: '', loadComponent: () => import('./pages/admin/admin.component').then(m => m.AdminComponent) }
    ]
  }

];
