import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParentMessagesComponent } from './parent-messages';

describe('ParentMessage', () => {
  let component: ParentMessagesComponent;
  let fixture: ComponentFixture<ParentMessagesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ParentMessagesComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ParentMessagesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
