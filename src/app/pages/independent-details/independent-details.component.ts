import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
    dbTenant,
    getCurrentUserData,
} from '../../services/legacy-compat';

@Component({
    selector: 'app-independent-details',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './independent-details.component.html',
    styleUrls: ['./independent-details.component.scss'],
})
export class IndependentDetailsComponent
    implements OnInit, OnDestroy {

    independent: any = null;

    loading = true;
    isEditing = false;
    error?: string;

    editableIndependent: any = {
        first_name: '',
        last_name: '',
        phone: '',
        email: '',
        emergency_contact_name: '',
        emergency_contact_phone: '',
        notes: '',
    };

    phoneError = '';
    emailError = '';

    infoMessage: string | null = null;
    private infoTimer: ReturnType<typeof setTimeout> | null = null;

    showConfirmDialog = false;

    async ngOnInit() {
        try {
            const user = await getCurrentUserData();

            if (!user?.uid) {
                this.error = 'משתמש לא מחובר';
                this.loading = false;
                return;
            }

            const dbc = dbTenant();

            const { data, error } = await dbc
                .from('independent_riders')
                .select(`
          uid,
          first_name,
          last_name,
          phone,
          email,
          id_number,
          birth_date,
          emergency_contact_name,
          emergency_contact_phone,
          notes,
          status
        `)
                .eq('uid', user.uid)
                .single();

            if (error) {
                this.error = error.message;
                this.loading = false;
                return;
            }

            this.independent = data;

            this.editableIndependent = {
                first_name: data.first_name ?? '',
                last_name: data.last_name ?? '',
                phone: data.phone ?? '',
                email: data.email ?? '',
                emergency_contact_name:
                    data.emergency_contact_name ?? '',
                emergency_contact_phone:
                    data.emergency_contact_phone ?? '',
                notes: data.notes ?? '',
            };

        } catch (e: any) {
            this.error = e?.message ?? 'שגיאה לא צפויה';
        } finally {
            this.loading = false;
        }
    }

    ngOnDestroy() {
        if (this.infoTimer) clearTimeout(this.infoTimer);
    }

    enableEditing() {
        this.isEditing = true;
    }

    cancelEdit() {
        this.isEditing = false;

        this.editableIndependent = {
            first_name: this.independent.first_name ?? '',
            last_name: this.independent.last_name ?? '',
            phone: this.independent.phone ?? '',
            email: this.independent.email ?? '',
            emergency_contact_name:
                this.independent.emergency_contact_name ?? '',
            emergency_contact_phone:
                this.independent.emergency_contact_phone ?? '',
            notes: this.independent.notes ?? '',
        };
    }

    onSaveClick() {
        if (!this.validate()) return;

        this.showConfirmDialog = true;
    }

    cancelSaveDialog() {
        this.showConfirmDialog = false;
    }

    confirmSave() {
        this.showConfirmDialog = false;
        this.save();
    }

    private validate(): boolean {

        const phoneRegex = /^05\d{8}$/;

        if (
            this.editableIndependent.phone &&
            !phoneRegex.test(this.editableIndependent.phone)
        ) {
            this.phoneError =
                'מספר טלפון לא תקין';
            return false;
        }

        this.phoneError = '';
        const email = (this.editableIndependent.email || '').trim().toLowerCase();

        const emailRegex =
            /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

        if (email && !emailRegex.test(email)) {
            this.emailError = 'כתובת מייל לא תקינה';
            return false;
        }

        if (email.endsWith('@gmail.co') || email.endsWith('@gmail.c')) {
            this.emailError = 'נראה שהתכוונת ל־gmail.com';
            return false;
        }

        this.emailError = '';

        return true;
    }

    async save() {
        try {

            const dbc = dbTenant();

            const { error } = await dbc
                .from('independent_riders')
                .update({
                    first_name:
                        this.editableIndependent.first_name,
                    last_name:
                        this.editableIndependent.last_name,
                    phone:
                        this.editableIndependent.phone,
                    email:
                        this.editableIndependent.email,
                    emergency_contact_name:
                        this.editableIndependent.emergency_contact_name,
                    emergency_contact_phone:
                        this.editableIndependent.emergency_contact_phone,
                    notes:
                        this.editableIndependent.notes,
                })
                .eq('uid', this.independent.uid);

            if (error) {
                this.error = error.message;
                return;
            }

            this.independent = {
                ...this.independent,
                ...this.editableIndependent,
            };

            this.isEditing = false;

            this.showInfo('הפרטים נשמרו בהצלחה');

        } catch (e: any) {
            this.error =
                e?.message ?? 'שגיאה בשמירה';
        }
    }

    private showInfo(msg: string, ms = 5000) {
        this.infoMessage = msg;

        if (this.infoTimer) {
            clearTimeout(this.infoTimer);
        }

        this.infoTimer = setTimeout(() => {
            this.infoMessage = null;
        }, ms);
    }
}