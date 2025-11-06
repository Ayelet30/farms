import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgreementsAdminService } from '../../services/agreements-admin.service';
import { ensureTenantContextReady, getCurrentFarmMetaSync } from '../../services/legacy-compat';
import { CurrentUserService } from '../../core/auth/current-user.service';
import { SupabaseTenantService } from '../../services/supabase-tenant.service';

@Component({
  selector: 'agreements-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './agreements-admin.component.html',
  styleUrls: ['./agreements-admin.component.css']
})
export class AgreementsAdminComponent implements OnInit {

  tenantSchema?: string; // ייקבע אחרי bootstrap

  constructor(
    private cuSvc: CurrentUserService,
    private svc: AgreementsAdminService
  ) {}

  agreements = signal<any[]>([]);
  busy = signal(false);

  newAgreement = {
    code: '',
    title: '',
    scope: 'per_child' as 'per_child' | 'per_parent',
    renewalIso: '',
    renewalNotifyDays: 14
  };

  newVersion = {
    severity: 'major' as 'major' | 'minor',
    effective_from: '',
    body_md: '',
    pdfPath: '' as string | null,
    publish_now: true
  };

  target = {
    activityTag: '',
    minChildAge: null as number | null,
    maxChildAge: null as number | null,
    required: true
  };

  async ngOnInit() {
    try {
      await ensureTenantContextReady();                // מוודא שיש טננט פעיל + JWT
      const farm = getCurrentFarmMetaSync();
      this.tenantSchema = farm?.schema_name ?? undefined;
      if (!this.tenantSchema) throw new Error('Tenant schema not set');
      await this.refresh();
    } catch (e) {
      console.error(e); // נווטי למסך בחירת חווה/שגיאה
    }
  }

  async refresh() {
    if (!this.tenantSchema) return;
    const list = await this.svc.listAgreements(this.tenantSchema);
    this.agreements.set(list.map(x => ({ ...x, _open: false, _versions: [] })));
  }

  async createAgreement() {
    if (!this.tenantSchema) return;
    this.busy.set(true);
    try {
      await this.svc.createAgreement({
        tenantSchema: this.tenantSchema,
        code: this.newAgreement.code.trim(),
        title: this.newAgreement.title.trim(),
        scope: this.newAgreement.scope,
        renewalIso: this.newAgreement.renewalIso || null,
        renewalNotifyDays: this.newAgreement.renewalNotifyDays ?? null
      });
      this.newAgreement = { code: '', title: '', scope: 'per_child', renewalIso: '', renewalNotifyDays: 14 };
      await this.refresh();
    } finally {
      this.busy.set(false);
    }
  }

  async toggleAccordion(a: any) {
    a._open = !a._open;
    if (a._open && (!a._versions || !a._versions.length) && this.tenantSchema) {
      a._versions = await this.svc.listVersions(this.tenantSchema, a.id);
    }
  }

  async onPdfPick(ev: any, code: string) {
    if (!this.tenantSchema) return;
    const file: File | undefined = ev?.target?.files?.[0];
    if (!file) return;
    const path = await this.svc.uploadPdf(this.tenantSchema, code, 'next', file);
    this.newVersion.pdfPath = path;
  }

  async addVersion(code: string) {
    if (!this.tenantSchema) return;
    await this.svc.addVersion({
      tenantSchema: this.tenantSchema,
      agreementCode: code,
      severity: this.newVersion.severity,
      bodyMd: this.newVersion.body_md || null,
      storagePath: this.newVersion.pdfPath || null,
      effectiveFrom: this.newVersion.effective_from ? new Date(this.newVersion.effective_from).toISOString() : null as any,
      publishNow: this.newVersion.publish_now
    });
    this.newVersion = { severity: 'major', effective_from: '', body_md: '', pdfPath: '', publish_now: true };
    await this.refresh();
  }

  async publishVersion(code: string, version: number) {
    if (!this.tenantSchema) return;
    await this.svc.publishVersion(this.tenantSchema, code, version);
    await this.refresh();
  }

  async archiveAgreement(code: string) {
    if (!this.tenantSchema) return;
    await this.svc.archiveAgreement(this.tenantSchema, code);
    await this.refresh();
  }

  async saveTarget(code: string) {
    if (!this.tenantSchema) return;
    await this.svc.setTarget(this.tenantSchema, code, this.target);
  }
}
