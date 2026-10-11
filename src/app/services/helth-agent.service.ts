import { Injectable } from '@angular/core';

export interface HealthAgentResponse {
  ok: boolean;
  app: string;
  version?: string;
  agentId?: string;
  status?: string;
  currentJobId?: string | null;
  maccabiSessionOpen?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class HelthAgentService {
  private readonly healthUrl =
    'http://127.0.0.1:38473/health';

  async checkHealth(): Promise<HealthAgentResponse | null> {
    try {
      const response = await fetch(
  this.healthUrl,
  {
    method: 'GET',
    cache: 'no-store',
  }
);

      if (!response.ok) {
        return null;
      }

      const health =
        (await response.json()) as HealthAgentResponse;

      if (
        health.ok !== true ||
        health.app !== 'moach-maccabi-agent'
      ) {
        return null;
      }

      return health;
    } catch (error) {
      console.warn(
        'Maccabi Agent health check failed:',
        error
      );

      return null;
    }
  }
}