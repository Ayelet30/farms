import { Component } from '@angular/core';
import { CommonModule } from '@angular/common'; 
import { signOut } from 'firebase/auth';
import { Router } from '@angular/router';
import { inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { LogoutConfirmationComponent } from '../../logout-confirmation/logout-confirmation';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ParentChildrenComponent } from '../parent-children/parent-children';
import { ParentDetailsComponent } from "../parent-details/parent-details";


@Component({
  selector: 'app-parent',
  standalone: true,
  imports: [CommonModule, MatDialogModule, ParentChildrenComponent, ParentDetailsComponent], 
  templateUrl: './parent.component.html',
  styleUrls: ['./parent.component.scss']
})
export class ParentComponent {
  selectedSection: string = 'children';

  constructor(
    private auth: Auth,
    private router: Router,
    private dialog: MatDialog
  ) {
    console.log("&&&&&&&&&");
  }
  async logout() {
    const dialogRef = this.dialog.open(LogoutConfirmationComponent, {
      width: '320px',
      panelClass: 'custom-login-dialog'
    });

    const confirmed = await dialogRef.afterClosed().toPromise();
    if (confirmed) {
      await signOut(this.auth);
      this.router.navigate(['/']);
    }
  }

  selectSection(section: string) {
    this.selectedSection = section;
    console.log("!!!!!!!!!!!!!!!!!!!!1" + this.selectedSection); 
  }
}
