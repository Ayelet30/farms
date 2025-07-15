import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { LogoutConfirmationComponent } from '../../logout-confirmation/logout-confirmation';
import { getCurrentUserData, getSupabaseClient, logout } from '../../services/supabase.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './header.html',
  styleUrls: ['./header.css']
})
export class HeaderComponent {
  isLoggedIn = false;
  parentName: string = '';
    supabase = getSupabaseClient();
  
  


async ngOnInit() {
  const user = await getCurrentUserData();
  this.isLoggedIn = !!user;
}


  constructor(private router: Router, private dialog: MatDialog) {
    this.checkLogin();
  }

  async checkLogin() {
  const user = await getCurrentUserData();
  this.isLoggedIn = !!user;

  if (user?.uid) {
    const { data, error } = await this.supabase
      .from('parents') 
      .select('full_name') 
      .eq('uid', user.uid)
      .single();

    if (data?.full_name) {
      this.parentName = data.full_name;
    }
  }
}


  handleLoginLogout() {
    if (this.isLoggedIn) {
      const dialogRef = this.dialog.open(LogoutConfirmationComponent, {
        width: '320px',
        disableClose: true
      });

      dialogRef.afterClosed().subscribe(result => {
        if (result === true) {
          logout();
          this.router.navigate(['/home']);
        }
      });
    } else {
      this.router.navigate(['/login']);
    }
  }
}
