import { Injectable, inject } from '@angular/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { CurrentUserService } from '../core/auth/current-user.service';
import { SUPABASE } from '../core/supabase.token';

export interface CreateAgreementDto {
  tenantSchema: string;
  code: string;
  title: string;
  scope: 'per_child' | 'per_parent';
  language?: string;
  requiresResignOnMajor?: boolean;
  renewalIso?: string | null;
  renewalNotifyDays?: number | null;
}

export interface AddVersionDto {
  tenantSchema: string;
  agreementCode: string;
  severity: 'minor' | 'major';
  bodyMd?: string | null;
  storagePath?: string | null;
  effectiveFrom?: string; // ISO
  publishNow?: boolean;
}

@Injectable({ providedIn: 'root' })
export class AgreementsAdminService {
  private supabase = inject<SupabaseClient>(SUPABASE);

  // ===== Storage =====
  async uploadPdf(tenantSchema: string, agreementCode: string, versionHint: number | 'next', file: File) {
    const fileName = versionHint === 'next' ? 'next.pdf' : `v${versionHint}.pdf`;
    const path = `tenants/${tenantSchema}/agreements/${agreementCode}/${fileName}`;
    const { data, error } = await this.supabase.storage.from('agreements').upload(path, file, { upsert: true });
    if (error) throw error;
    return data.path; // שמרי אותו כ-storage_path בגרסה
  }

  // ===== RPCs =====
  async createAgreement(dto: CreateAgreementDto) {
    const { data, error } = await this.supabase.rpc('admin_create_agreement', {
      tenant_schema: dto.tenantSchema,
      p_code: dto.code,
      p_title: dto.title,
      p_scope: dto.scope,
      p_language: dto.language ?? 'he',
      p_requires_resign_on_major: dto.requiresResignOnMajor ?? true,
      p_renewal_iso8601: dto.renewalIso ?? null,
      p_renewal_notify_days: dto.renewalNotifyDays ?? null
    });
    if (error) throw error;
    return data as string; // agreement_id
  }

  async addVersion(dto: AddVersionDto) {
    const { data, error } = await this.supabase.rpc('admin_add_version', {
      tenant_schema: dto.tenantSchema,
      p_agreement_code: dto.agreementCode,
      p_severity: dto.severity,
      p_body_md: dto.bodyMd ?? null,
      p_storage_path: dto.storagePath ?? null,
      p_effective_from: dto.effectiveFrom ?? null,
      p_publish_now: dto.publishNow ?? true
    });
    if (error) throw error;
    return data as string; // version_id
  }

  async setTarget(tenantSchema: string, agreementCode: string, target: {
    activityTag?: string | null;
    minChildAge?: number | null;
    maxChildAge?: number | null;
    required?: boolean;
  }) {
    const { error } = await this.supabase.rpc('admin_set_target', {
      tenant_schema: tenantSchema,
      p_agreement_code: agreementCode,
      p_activity_tag: target.activityTag ?? null,
      p_min_child_age: target.minChildAge ?? null,
      p_max_child_age: target.maxChildAge ?? null,
      p_required: target.required ?? true
    });
    if (error) throw error;
  }

  async publishVersion(tenantSchema: string, agreementCode: string, version: number) {
    const { data, error } = await this.supabase.rpc('admin_publish_version', {
      tenant_schema: tenantSchema, p_agreement_code: agreementCode, p_version: version
    });
    if (error) throw error;
    return data as string; // version_id
  }

  async archiveAgreement(tenantSchema: string, agreementCode: string) {
    const { error } = await this.supabase.rpc('admin_archive_agreement', {
      tenant_schema: tenantSchema, p_agreement_code: agreementCode
    });
    if (error) throw error;
  }

  // ===== שאילתות UI (קריאה ישירה מהסכמה) =====
  async listAgreements(tenantSchema: string) {
    const db = this.supabase.schema(tenantSchema);
    const { data, error } = await db
      .from('agreements')
      .select('id, code, title, scope, status, current_version_id, updated_at')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async listVersions(tenantSchema: string, agreementId: string) {
    const db = this.supabase.schema(tenantSchema);
    const { data, error } = await db
      .from('agreement_versions')
      .select('id, version, severity, storage_path, effective_from, effective_until, created_at')
      .eq('agreement_id', agreementId)
      .order('version', { ascending: false });
    if (error) throw error;
    return data;
  }
}
