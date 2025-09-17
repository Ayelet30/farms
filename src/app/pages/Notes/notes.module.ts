import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// רק הייבוא של המודולים הנדרשים
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';  // אם אתה משתמש ב-mat-select
import { MatListModule } from '@angular/material/list';
import { MatChipsModule } from '@angular/material/chips'; // אם אתה משתמש ב-mat-chip

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,  // הוספת MatSelectModule אם אתה משתמש בו
    MatListModule,
    MatChipsModule,  // הוספת MatChipsModule אם אתה משתמש בו
  ],
  exports: [
    // לא נדרשת הצהרה על NoteComponent פה כשזה רכיב עצמאי
  ]
})
export class NotesModule { }
