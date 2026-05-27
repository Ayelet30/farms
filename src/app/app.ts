import { Component, inject, OnInit } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  private router = inject(Router);
  protected title = 'Smart Farm';

  constructor() { }
  ngOnInit(): void {
    const path = window.location.pathname.replace(/^\/+/, '');

    const isPublicSignup =
      path.startsWith('register/') ||
      path.startsWith('register-independent/');

    if (isPublicSignup) return;

    this.router.navigateByUrl('/', { replaceUrl: true });
  }
}
