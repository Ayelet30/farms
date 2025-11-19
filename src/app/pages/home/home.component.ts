import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { LoginComponent } from '../login/login.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent {
  constructor(private router: Router,
    private dialog: MatDialog
  ) {}

  goToLogin() {
    this.dialog.open(LoginComponent, {
      width: '350px',
      panelClass: 'custom-login-dialog'
    });
  }

  openBooking(type: string) {
    if (type == 'therapeutic')
    {
        this.goToLogin();
        return;
    }
    else{
      this.router.navigate(['/booking', type]);
    }
    
  }
}
