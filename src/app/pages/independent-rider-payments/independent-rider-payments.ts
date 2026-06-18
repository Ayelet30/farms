// // src/app/pages/independent-rider-payments/independent-rider-payments.component.ts

// import { Component, OnInit, AfterViewInit, signal } from '@angular/core';
// import { CommonModule } from '@angular/common';
// import { FormsModule } from '@angular/forms';

// import { TranzilaService } from '../../services/tranzila.service';
// import {
//   PaymentsService,
//   type IndependentRiderPaymentProfile,
// } from '../../services/payments.service';

// import { CurrentUserService } from '../../core/auth/current-user.service';
// import { getCurrentFarmMetaSync } from '../../services/supabaseClient.service';
// import { TenantBootstrapService } from '../../services/tenant-bootstrap.service';
// import { ParentPaymentsDbService } from '../../services/parent-payments-db.service';

// declare const TzlaHostedFields: any;

// type HostedFieldsInstance = {
//   charge: (params: any, cb: (err: any, resp: any) => void) => void;
//   onEvent?: (eventName: string, cb: (...args: any[]) => void) => void;
// };

// type ProfileVM = {
//   id: string;
//   brand: string | null;
//   last4: string | null;
//   is_default: boolean;
//   created_at: string;
//   expiry_month?: number | null;
//   expiry_year?: number | null;
// };

// type InvoiceVM = {
//   id: string;
//   amountNis: string;
//   date: string;
//   invoice_url: string;
//   method: string | null;
// };

// export type SaveIndependentRiderPaymentMethodResult =
//   | { ok: true; is_default: boolean }
//   | {
//     ok: false;
//     error: string;
//     message?: string;
//     existingRiderUid?: string;
//     existingProfileId?: string;
//     last4?: string | null;
//     brand?: string | null;
//   };

// @Component({
//   selector: 'app-independent-rider-payments',
//   standalone: true,
//   imports: [CommonModule, FormsModule],
//   templateUrl: './independent-rider-payments.html',
//   styleUrls: ['./independent-rider-payments.css'],
// })
// export class IndependentRiderPaymentsComponent implements OnInit, AfterViewInit {
//   riderUid = '';
//   riderEmail = '';

//   loading = signal(true);
//   error = signal<string | null>(null);

//   profiles = signal<ProfileVM[]>([]);
//   invoices = signal<InvoiceVM[]>([]);

//   addCardOpen = signal(false);
//   savingToken = signal(false);
//   tokenSaved = signal(false);
//   tokenError = signal<string | null>(null);

//   private hfAdd: HostedFieldsInstance | null = null;
//   private thtkAdd: string | null = null;
//   private hfInitTried = false;
//   private terminalNameAdd: string | null = null;
//   private savedToken: {
//     token: string;
//     last4: string | null;
//     brand: string | null;
//     expiryMonth?: string | null;
//     expiryYear?: string | null;
//   } | null = null;

//   constructor(
//     private tranzila: TranzilaService,
//     private payments: PaymentsService,
//     private cu: CurrentUserService,
//     private tenantBoot: TenantBootstrapService,
//     private ppDb: ParentPaymentsDbService,
//   ) {
//     const cur = this.cu.current;
//     this.riderUid = cur?.uid ?? '';
//     this.riderEmail = cur?.email ?? '';
//   }

//   async ngOnInit() {
//     try {
//       if (!this.riderUid) throw new Error('לא זוהה רוכב מחובר');
//       await this.refreshAll();
//     } catch (e: any) {
//       this.error.set(e?.message ?? 'שגיאה בטעינת אמצעי התשלום');
//     } finally {
//       this.loading.set(false);
//     }
//   }

//   async ngAfterViewInit() {
//     // לא מאתחלים Hosted Fields כאן, רק כשפותחים את המודל.
//   }

//   async refreshAll() {
//     await Promise.all([
//       this.refreshProfiles(),
//       this.refreshInvoices(),
//     ]);
//   }

//   private async refreshProfiles() {
//     try {
//       const rows = await this.payments.listIndependentRiderProfiles(this.riderUid);

//       this.profiles.set(
//         (rows ?? []).map((x: IndependentRiderPaymentProfile) => ({
//           id: x.id,
//           brand: x.brand,
//           last4: x.last4,
//           is_default: x.is_default,
//           created_at: new Date(x.created_at).toLocaleString('he-IL'),
//           expiry_month: x.expiry_month ?? null,
//           expiry_year: x.expiry_year ?? null,
//         })),
//       );
//     } catch (e: any) {
//       this.error.set(e?.message ?? 'שגיאה בטעינת כרטיסים');
//     }
//   }

//   private async refreshInvoices() {
//     try {
//       const dbc = this.ppDb.db();

//       const { data, error } = await dbc
//         .from('independent_rider_payments')
//         .select('id, amount, date, method, tranzila_invoice_url')
//         .eq('rider_uid', this.riderUid)
//         .not('tranzila_invoice_url', 'is', null)
//         .order('date', { ascending: false })
//         .limit(100);

//       if (error) throw error;

//       const rows = (data ?? []) as any[];

//       this.invoices.set(
//         rows.map((r) => ({
//           id: String(r.id),
//           amountNis: Number(r.amount ?? 0).toFixed(2) + ' ₪',
//           date: r.date ? new Date(r.date).toLocaleDateString('he-IL') : '-',
//           invoice_url: String(r.tranzila_invoice_url),
//           method: r.method ?? null,
//         })),
//       );
//     } catch (e: any) {
//       console.error('[independent rider invoices] load failed', e);
//       this.invoices.set([]);
//     }
//   }

//   async setDefault(profileId: string) {
//     try {
//       await this.payments.setDefaultIndependentRiderProfile(
//         profileId,
//         this.riderUid,
//       );

//       await this.refreshProfiles();
//     } catch (e: any) {
//       this.error.set(e?.message ?? 'שגיאה בהגדרת כרטיס ברירת מחדל');
//     }
//   }

//   openAddCardModal() {
//     this.addCardOpen.set(true);
//     this.tokenError.set(null);
//     this.tokenSaved.set(false);
//     this.savedToken = null;

//     queueMicrotask(() => this.ensureAddHostedFieldsReady());
//   }

//   closeAddCardModal() {
//     if (this.savingToken()) return;
//     this.addCardOpen.set(false);
//   }

//   private async ensureAddHostedFieldsReady() {
//     console.log('INIT HF');
//     if (this.hfAdd) return;
//     if (this.hfInitTried) return;

//     this.hfInitTried = true;

//     try {
//       const farm = getCurrentFarmMetaSync();
//       const tenantSchema = farm?.schema_name ?? null;

//       if (!tenantSchema) {
//         this.tokenError.set('לא זוהתה סכמת חווה');
//         return;
//       }
//       const handshake = await this.tranzila.getHandshakeToken(tenantSchema);
//       this.thtkAdd = handshake.thtk;
//       this.terminalNameAdd = handshake.terminal_name;

//       if (!TzlaHostedFields) {
//         this.tokenError.set('רכיב התשלום לא נטען');
//         return;
//       }

//       console.log('BEFORE TzlaHostedFields.create');

//       this.hfAdd = TzlaHostedFields.create({
//         sandbox: false,
//         fields: {
//           credit_card_number: {
//             selector: '#pm_credit_card_number',
//             placeholder: '4580 4580 4580 4580',
//             tabindex: 1,
//           },
//           cvv: {
//             selector: '#pm_cvv',
//             placeholder: '123',
//             tabindex: 2,
//           },
//           expiry: {
//             selector: '#pm_expiry',
//             placeholder: '12/26',
//             version: '1',
//           },
//         },
//         styles: {
//           input: {
//             height: '38px',
//             'line-height': '38px',
//             padding: '0 8px',
//             'font-size': '15px',
//             'box-sizing': 'border-box',
//           },
//           select: {
//             height: '38px',
//             'line-height': '38px',
//             padding: '0 8px',
//             'font-size': '15px',
//             'box-sizing': 'border-box',
//           },
//         },
//       });

//       console.log('AFTER TzlaHostedFields.create', this.hfAdd);

//       this.hfAdd?.onEvent?.('validityChange', () => { });
//     } catch (e: any) {
//       console.error('[independent rider pm] HF init error', e);
//       this.tokenError.set(e?.message ?? 'שגיאה באתחול שדות האשראי');
//     }
//   }

//   async tokenizeAndSaveCard() {
//     if (this.savingToken()) return;

//     this.tokenError.set(null);
//     this.tokenSaved.set(false);

//     if (!this.hfAdd || !this.thtkAdd) {
//       this.tokenError.set('שדות התשלום לא מוכנים');
//       return;
//     }

//     if (!this.riderUid) {
//       this.tokenError.set('לא זוהה רוכב מחובר');
//       return;
//     }

//     this.savingToken.set(true);

//     try {
//       await this.tenantBoot.ensureReady();

//       const farm = this.tenantBoot.getFarmMetaSync();
//       const tenantSchema = farm?.schema_name ?? undefined;

//       if (!tenantSchema) {
//         this.tokenError.set('לא זוהתה סכמת חווה');
//         return;
//       }

//       ['credit_card_number', 'expiry', 'cvv'].forEach((k) => {
//         const el = document.getElementById('pm_errors_for_' + k); if (el) el.textContent = '';
//       });

//       const dbc = this.ppDb.db();

//       const { data, error } = await dbc
//         .from('billing_terminals')
//         .select(
//           'terminal_name,tok_terminal_name,secret_key_charge,secret_key_charge_token',
//         )
//         .eq('provider', 'tranzila')
//         .eq('mode', 'prod')
//         .eq('active', true)
//         .order('is_default', { ascending: false })
//         .order('updated_at', { ascending: false })
//         .limit(1)
//         .maybeSingle();

//       if (error) throw error;

//       const terminalName = this.terminalNameAdd ?? 'moachapp';
//       this.hfAdd.charge(
//         {
//           terminal_name: terminalName,
//           thtk: this.thtkAdd,
//           currency_code: 'ILS',
//           amount: '1.00',
//           tran_mode: 'N',
//           tokenize: true,
//           response_language: 'hebrew',
//           requested_by_user: 'independent-rider-payments-tokenize',
//           email: this.riderEmail || undefined,
//           contact: this.riderEmail || undefined,
//         },
//         async (err: any, response: any) => {
//           try {
//             if (err?.messages?.length) {
//               err.messages.forEach((msg: any) => {
//                 const el = document.getElementById('pm_errors_for_' + msg.param); if (el) el.textContent = msg.message;
//               });

//               this.tokenError.set('שגיאה בפרטי הכרטיס');
//               return;
//             }

//             const tx = response?.transaction_response;

//             if (!tx?.success) {
//               this.tokenError.set(tx?.error || 'שמירת אמצעי תשלום נכשלה');
//               return;
//             }

//             const token = tx?.token;

//             if (!token) {
//               this.tokenError.set('לא התקבל טוקן מהסליקה');
//               return;
//             }

//             const last4 =
//               tx?.credit_card_last_4_digits ??
//               tx?.last_4 ??
//               (tx?.card_mask ? String(tx.card_mask).slice(-4) : null);

//             const brand = tx?.card_type_name ?? tx?.card_type ?? null;

//             this.savedToken = {
//               token: String(token),
//               last4: last4 ? String(last4) : null,
//               brand: brand ? String(brand) : null,
//               expiryMonth: tx?.expiry_month ?? null,
//               expiryYear: tx?.expiry_year ?? null,
//             };

//             const resultUnknown =
//               await this.tranzila.saveIndependentRiderPaymentMethod({
//                 riderUid: this.riderUid,
//                 tenantSchema,
//                 token: this.savedToken.token,
//                 last4: this.savedToken.last4,
//                 brand: this.savedToken.brand,
//                 expiryMonth: this.savedToken.expiryMonth,
//                 expiryYear: this.savedToken.expiryYear,
//               });

//             const result =
//               resultUnknown as SaveIndependentRiderPaymentMethodResult;

//             if (result && result.ok === false) {
//               this.tokenError.set(
//                 result.error ?? 'שגיאה בשמירת אמצעי תשלום במערכת',
//               );
//               return;
//             }

//             this.tokenSaved.set(true);

//             await this.refreshProfiles();

//             this.closeAddCardModal();
//           } catch (e: any) {
//             console.error('[save independent rider card] error', e);
//             this.tokenError.set(
//               e?.message ?? 'שגיאה בשמירת אמצעי תשלום במערכת',
//             );
//           } finally {
//             this.savingToken.set(false);
//           }
//         },
//       );
//     } catch (e: any) {
//       console.error('[tokenizeAndSaveCard] error', e);
//       this.tokenError.set(e?.message ?? 'שגיאה בשמירת אמצעי תשלום');
//       this.savingToken.set(false);
//     }
//   }

//   trackById(_i: number, x: { id: string }) {
//     return x.id;
//   }
// }