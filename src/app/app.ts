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
    // כל טעינה/רענון -> חוזרים לבית (מחליף את ה-URL כדי שלא "יחזור אחורה" לנתיב הישן)
    this.router.navigateByUrl('/', { replaceUrl: true });
  }
}
