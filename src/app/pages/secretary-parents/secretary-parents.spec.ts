import { ComponentFixture, TestBed } from '@angular/core/testing';

import {SecretaryParentsComponent} from './secretary-parents';

describe('SecretaryParents', () => {
  let component: SecretaryParentsComponent;
  let fixture: ComponentFixture<SecretaryParentsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SecretaryParentsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SecretaryParentsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
