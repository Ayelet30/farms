import { Injectable, inject } from '@angular/core';
import { SupabaseClient } from '@supabase/supabase-js';

export type AgreementScope = 'per_child' | 'per_parent';

export interface RequiredAgreement {
  agreement_id: string;
  agreement_code: string;
  title: string;
  scope: AgreementScope;
  version_id: string;
  body_md?: string | null;
  storage_path?: string | null;
  accepted: boolean;
}

@Injectable({ providedIn: 'root' })
export class AgreementsService {
  private supabase = inject(SupabaseClient);

  async getRequiredForChild(tenantSchema: string, childId: string, parentUid: string, activityTag?: string) {
    const { data, error } = await this.supabase.rpc('get_required_agreements', {
      tenant_schema: tenantSchema,
      child: childId,
      parent: parentUid,
      activity_tag: activityTag ?? null
    });

    if (error) throw error;
    return (data || []) as RequiredAgreement[];
  }

  async acceptAgreement(tenantSchema: string, payload: {
    versionId: string;
    parentUid: string;
    childId?: string | null;
    firstNameSnapshot?: string | null;
    lastNameSnapshot?: string | null;
    roleSnapshot?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    signaturePath?: string | null;
  }) {
    const db = this.supabase.schema(tenantSchema);
    const { data, error } = await db
      .from('user_agreement_acceptances')
      .insert({
        agreement_version_id: payload.versionId,
        parent_user_id: payload.parentUid,
        child_id: payload.childId ?? null,
        first_name_snapshot: payload.firstNameSnapshot ?? null,
        last_name_snapshot: payload.lastNameSnapshot ?? null,
        role_snapshot: payload.roleSnapshot ?? 'parent',
        ip: payload.ip ?? null,
        user_agent: payload.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : null),
        signature_path: payload.signaturePath ?? null
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}
