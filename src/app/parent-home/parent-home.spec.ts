import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParentHomeComponent } from './parent-home';

describe('ParentHome', () => {
  let component: ParentHomeComponent;
  let fixture: ComponentFixture<ParentHomeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ParentHomeComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ParentHomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
