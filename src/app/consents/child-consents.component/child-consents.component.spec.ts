import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChildConsentsComponent } from './child-consents.component';

describe('ChildConsentsComponent', () => {
  let component: ChildConsentsComponent;
  let fixture: ComponentFixture<ChildConsentsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChildConsentsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ChildConsentsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
