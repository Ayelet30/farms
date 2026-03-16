import { Injectable } from '@angular/core';
import { getAuth } from 'firebase/auth';
import { requireTenant } from '../services/supabaseClient.service';
import { RequestType } from '../Types/detailes.model';

type RejectFlowMode = 'notifyOnly' | 'rejectAndNotify';

type EndpointConfig = {
  endpoint: string;
  mode: RejectFlowMode;
};

export type SystemRejectResult = {
  ok: boolean;
  mode: RejectFlowMode;
  endpoint: string;
  response: any;
};

@Injectable({ providedIn: 'root' })
export class RequestSystemRejectedMailService {
  private functionBase =
    'https://us-central1-bereshit-ac5d8.cloudfunctions.net';

  private endpointMap: Partial<Record<RequestType, EndpointConfig>> = {
    SINGLE_LESSON: {
      endpoint: 'notifySingleLessonRejected',
      mode: 'notifyOnly',
    },
    NEW_SERIES: {
      endpoint: 'notifySeriesRejected',
      mode: 'notifyOnly',
    },
    ADD_CHILD: {
      endpoint: 'rejectAddChildAndNotify',
      mode: 'rejectAndNotify',
    },
    DELETE_CHILD: {
      endpoint: 'rejectRemoveChildAndNotify',
      mode: 'rejectAndNotify',
    },
    INSTRUCTOR_DAY_OFF: {
      endpoint: 'rejectInstructorDayOffAndNotify',
      mode: 'rejectAndNotify',
    },
    CANCEL_OCCURRENCE: {
      endpoint: 'rejectCancelOccurrenceAndNotify',
      mode: 'rejectAndNotify',
    },
    FILL_IN: {
      endpoint: 'rejectFillInAndNotify',
      mode: 'rejectAndNotify',
    },
    MAKEUP_LESSON: {
      endpoint: 'rejectMakeupLessonAndNotify',
      mode: 'rejectAndNotify',
    },
  };

 getConfig(type: RequestType): EndpointConfig | null {
  return this.endpointMap[type] ?? null;
}

  async send(params: {
    id: string;
    requestType: RequestType | string;
    reason?: string | null;
    decidedByUid?: string | null;
  }): Promise<SystemRejectResult> {
    const config = this.getConfig(params.requestType as RequestType);

    if (!config) {
      throw new Error(`No rejection endpoint for request type: ${params.requestType}`);
    }

    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) throw new Error('אין משתמש מחובר');

    const token = await user.getIdToken();
    const tenant = requireTenant();

    const body =
      config.mode === 'notifyOnly'
        ? {
            tenantSchema: tenant.schema,
            tenantId: tenant.id,
            requestId: params.id,
          }
        : {
            tenantSchema: tenant.schema,
            tenantId: tenant.id,
            requestId: params.id,
            decisionNote: params.reason ?? null,
            source: 'system',
            system: true,
            decidedByUid: params.decidedByUid ?? user.uid ?? null,
          };

    const res = await fetch(`${this.functionBase}/${config.endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(
        json?.message ||
          json?.error ||
          `הקריאה לפונקציה ${config.endpoint} נכשלה (${res.status})`
      );
    }

    if (json?.ok !== true) {
      throw new Error(
        json?.message ||
          json?.error ||
          `הפונקציה ${config.endpoint} החזירה תשובה לא תקינה`
      );
    }

    return {
      ok: true,
      mode: config.mode,
      endpoint: config.endpoint,
      response: json,
    };
  }
}