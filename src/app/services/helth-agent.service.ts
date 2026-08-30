import { Injectable } from '@angular/core';

export interface AgentHealthResponse {
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

  async checkHealth(
    timeoutMs = 3000
  ): Promise<AgentHealthResponse | null> {
    const controller = new AbortController();

    const timeout = window.setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(this.healthUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      const data =
        (await response.json()) as Partial<AgentHealthResponse>;

      if (
        data.ok !== true ||
        data.app !== 'moach-maccabi-agent'
      ) {
        return null;
      }

      return data as AgentHealthResponse;
    } catch (error) {
      console.warn(
        'Maccabi agent health check failed:',
        error
      );

      return null;
    } finally {
      window.clearTimeout(timeout);
    }
  }
}