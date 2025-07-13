import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParentChildren } from './parent-children';

describe('ParentChildren', () => {
  let component: ParentChildren;
  let fixture: ComponentFixture<ParentChildren>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ParentChildren]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ParentChildren);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
