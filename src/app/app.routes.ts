import { Routes } from '@angular/router';
import { RoleGuard } from './shared/guards/role-guard';

export const routes: Routes = [
    { path: '', redirectTo: 'home', pathMatch: 'full' },
    { path: 'home', loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent) },
    { path: 'login', loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent) },
    { path: 'parent', loadComponent: () => import('./pages/parent/parent.component').then(m => m.ParentComponent), canActivate: [RoleGuard], data: { role: 'parent' } },
    { path: 'guide', loadComponent: () => import('./pages/guide/guide.component').then(m => m.GuideComponent), canActivate: [RoleGuard], data: { role: 'guide' } },
    { path: 'admin', loadComponent: () => import('./pages/admin/admin.component').then(m => m.AdminComponent), canActivate: [RoleGuard], data: { role: 'admin' } },
    { path: 'booking/:type', loadComponent: () => import('./pages/booking/booking.component').then(m => m.BookingComponent)},
    { path: '**', redirectTo: 'home' }
];
