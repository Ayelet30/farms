import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HeaderComponent } from '../shared/header/header';
import { SliderComponent } from '../shared/slider/slider';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, HeaderComponent, SliderComponent],
  templateUrl: './layout.html',
  styleUrls: ['./layout.scss']
})
// layout.ts
export class LayoutComponent {
  menuCollapsed = true; // סגור כברירת מחדל
  hoveringMenu = false;

  private readonly MQ = window.matchMedia('(max-width: 1023.98px)');

  // swipe
  private touchStartX = 0;
  private touchStartY = 0;
  private tracking = false;

  ngOnInit(){
    const apply = () => {
      // מובייל: סגור
      if (this.MQ.matches) this.menuCollapsed = true;
      // דסקטופ: להשאיר Rail פתוח/מצומצם? כאן נשאיר "מצומצם" (כלומר סגור = rail)
      if (!this.MQ.matches) this.menuCollapsed = true;
    };
    apply();
    this.MQ.addEventListener?.('change', apply);
  }

  onCollapsedChange(v: boolean) {
    this.menuCollapsed = v;
  }

  // ===== Hover open (Desktop) =====
  openFromHover(){
    if (this.MQ.matches) return; // לא במובייל
    this.menuCollapsed = false;  // פותח (drawer-open)
  }

  closeFromHover(){
    if (this.MQ.matches) return;
    // אל תסגור אם העכבר עדיין בתוך התפריט
    setTimeout(() => {
      if (!this.hoveringMenu) this.menuCollapsed = true;
    }, 120);
  }

  // ===== Swipe open (Mobile) =====
  onTouchStart(e: TouchEvent){
    if (!this.MQ.matches) return;

    const t = e.touches[0];
    this.touchStartX = t.clientX;
    this.touchStartY = t.clientY;

    // מתחילים tracking רק אם נגעו ממש קרוב לימין (RTL: תפריט מימין)
    const edgePx = 24;
    const w = window.innerWidth;
    this.tracking = (this.touchStartX >= (w - edgePx));
  }

  onTouchMove(e: TouchEvent){
    if (!this.MQ.matches || !this.tracking) return;

    const t = e.touches[0];
    const dx = t.clientX - this.touchStartX;
    const dy = t.clientY - this.touchStartY;

    // אם גלילה אנכית – לוותר
    if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx)) {
      this.tracking = false;
      return;
    }

    // החלקה מימין לשמאל => dx שלילי
    if (dx < -40) {
      this.menuCollapsed = false; // פתיחה
      this.tracking = false;
    }
  }

  onTouchEnd(){
    this.tracking = false;
  }
}


