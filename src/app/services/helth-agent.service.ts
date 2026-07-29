import { Injectable } from '@angular/core';

export interface AgentHealthResponse {
  ok: boolean;
  app?: string;
  version?: string;
  status?: string;
}

@Injectable({
  providedIn: 'root',
})
export class HelthAgentService {
  private readonly healthUrl = 'http://127.0.0.1:38473/health';

  async checkHealth(timeoutMs = 1800): Promise<AgentHealthResponse | null> {
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

      const data = await response.json();

      if (data?.app !== 'bereshit-maccabi-agent') {
        return null;
      }

      return data as AgentHealthResponse;
    } catch {
      return null;
    } finally {
      window.clearTimeout(timeout);
    }
  }
}