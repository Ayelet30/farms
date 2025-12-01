import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-parent-home',
  templateUrl: './parent-home.html',
  styleUrls: ['./parent-home.css'],
})
export class ParentHomeComponent {
  constructor(private router: Router) {}

  goTo(path: string) {
    this.router.navigate(['/parent', path]);
  }
}
