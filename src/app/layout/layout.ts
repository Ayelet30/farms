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
  menuCollapsed = false;

  onCollapsedChange(v: boolean) {
    this.menuCollapsed = v;
  }
}

