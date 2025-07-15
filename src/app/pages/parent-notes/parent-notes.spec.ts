import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParentNotes } from './parent-notes';

describe('ParentNotes', () => {
  let component: ParentNotes;
  let fixture: ComponentFixture<ParentNotes>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ParentNotes]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ParentNotes);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
