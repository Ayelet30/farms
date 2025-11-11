import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TokensService {
  private linkId = 'tenant-tokens';
  private currentKey?: string;

  applyTokens(tokensKey: string) {
    if (!tokensKey || this.currentKey === tokensKey) return;
    const href = this.resolveHref(tokensKey);
    let linkEl = document.getElementById(this.linkId) as HTMLLinkElement | null;
    if (!linkEl) {
      linkEl = document.createElement('link');
      linkEl.id = this.linkId;
      linkEl.rel = 'stylesheet';
      document.head.appendChild(linkEl);
    }
    linkEl.href = href;
    this.currentKey = tokensKey;
    localStorage.setItem('tokensKey', tokensKey);
  }

  /** @deprecated השתמשי ב-applyTokens */
  applytokens(tokensKey: string) { this.applyTokens(tokensKey); }

  restoreLastTokens(fallback = 'bereshit_farm') {
    const saved = localStorage.getItem('tokensKey') || fallback;
    this.applyTokens(saved);
  }

  /** @deprecated השתמשי ב-restoreLastTokens */
  restoreLasttokens(fallback?: string) { this.restoreLastTokens(fallback); }

  private resolveHref(tokensKey: string): string {
    return new URL(`tokens-${tokensKey}.css`, document.baseURI).toString();
  }
}
