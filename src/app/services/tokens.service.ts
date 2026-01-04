import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TokensService {
  private linkId = 'tenant-tokens';
  private currentKey?: string;

  applyTokens(tokensKey: string) {
    console.log('Applying tokens:', tokensKey);
    if (!tokensKey || this.currentKey === tokensKey) return;
    const href = this.resolveHref(tokensKey);
    let linkEl = document.getElementById(this.linkId) as HTMLLinkElement | null;
    console.log('Link element:', linkEl);
    if (!linkEl) {
      linkEl = document.createElement('link');
      linkEl.id = this.linkId;
      linkEl.rel = 'stylesheet';
      console.log('Appending link element to head');
      document.head.appendChild(linkEl);
    }
    linkEl.href = href;
    this.currentKey = tokensKey;
    console.log('Tokens applied', tokensKey);
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
    console.log('Resolving href for tokensKey:', tokensKey, 'document.baseURI:', document.baseURI);
    return new URL(`tokens-${tokensKey}.css`, document.baseURI).toString();
  }
}
