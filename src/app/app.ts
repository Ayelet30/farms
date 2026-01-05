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

  constructor() {}

  ngOnInit(): void {
    const path = window.location.pathname.replace(/^\/+/, ''); // בלי /
    const isRegister = path.startsWith('register/');           // register/:farm

    // אם זה קישור חיצוני ל- register/:farm — לא עושים redirect
    if (isRegister) return;

    // אחרת: כל רענון/טעינה -> בית
    this.router.navigateByUrl('/', { replaceUrl: true });
  }
}
