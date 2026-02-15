import { Component } from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-admin',
  imports: [RouterOutlet],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss'
})
export class AdminComponent {
  constructor(private router: Router) {}

  openEmailAdmin() {
    this.router.navigate(['/admin/email']);
  }



  openClalitAdmin() {
    this.router.navigate(['/admin/clalit']);
}
}
