import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParentChildrenComponent } from './parent-children';

describe('ParentChildren', () => {
  let component: ParentChildrenComponent;
  let fixture: ComponentFixture<ParentChildrenComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ParentChildrenComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ParentChildrenComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
