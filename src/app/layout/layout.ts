import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterModule } from '@angular/router';
import { HeaderComponent } from '../shared/header/header';
import { SliderComponent } from '../shared/slider/slider';
import { AccessibilityComponent } from '../pages/accessibility/accessibility.component';
import { PrivacyPolicyComponent } from '../pages/privacy-policy/privacy-policy.component';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, HeaderComponent, SliderComponent, AccessibilityComponent, PrivacyPolicyComponent],
  templateUrl: './layout.html',
  styleUrls: ['./layout.scss']
})
export class LayoutComponent {
  menuCollapsed = false; // פתוח כברירת מחדל
  hoveringMenu = false;

  private readonly MQ = window.matchMedia('(max-width: 1023.98px)');

  private touchStartX = 0;
  private touchStartY = 0;
  private tracking = false;

  isAccessibilityOpen = false;
  isPrivacyOpen = false;

openAccessibilityModal(): void {
  this.isAccessibilityOpen = true;
  document.body.style.overflow = 'hidden';
}

closeAccessibilityModal(): void {
  this.isAccessibilityOpen = false;
  document.body.style.overflow = '';
}

openPrivacyModal(): void {
  this.isPrivacyOpen = true;
  document.body.style.overflow = 'hidden';
}

closePrivacyModal(): void {
  this.isPrivacyOpen = false;
  document.body.style.overflow = '';
}

  constructor(private router: Router) {}

  ngOnInit() {
    const apply = () => {
      if (this.MQ.matches) {
        // מובייל
        this.menuCollapsed = true;
      } else {
        // דסקטופ
        this.menuCollapsed = false;
      }
    };

    apply();
    this.MQ.addEventListener?.('change', apply);
  }


  onCollapsedChange(v: boolean) {
    this.menuCollapsed = v;
  }

  openFromHover() {
    if (this.MQ.matches) return;
    this.menuCollapsed = false;
  }

  closeFromHover() {
    if (this.MQ.matches) return;
    setTimeout(() => {
      if (!this.hoveringMenu) this.menuCollapsed = true;
    }, 120);
  }

  onTouchStart(e: TouchEvent) {
    if (!this.MQ.matches) return;

    const t = e.touches[0];
    this.touchStartX = t.clientX;
    this.touchStartY = t.clientY;

    const edgePx = 24;
    const w = window.innerWidth;
    this.tracking = (this.touchStartX >= (w - edgePx));
  }

  onTouchMove(e: TouchEvent) {
    if (!this.MQ.matches || !this.tracking) return;

    const t = e.touches[0];
    const dx = t.clientX - this.touchStartX;
    const dy = t.clientY - this.touchStartY;

    if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx)) {
      this.tracking = false;
      return;
    }

    if (dx < -40) {
      this.menuCollapsed = false;
      this.tracking = false;
    }
  }

  onTouchEnd() {
    this.tracking = false;
  }
}