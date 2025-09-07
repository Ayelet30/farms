import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TokensService {
  private linkId = 'tenant-tokens';
  private currentKey?: string;

  applytokens(tokensKey: string) {
    console.log(tokensKey);
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
    localStorage.setItem('tokensKey', tokensKey); // שחזור אוטומטי בטעינה הבאה
  }

  restoreLasttokens(fallback: string = 'bereshit_farm') {
    const saved = localStorage.getItem('tokensKey') || fallback;
    this.applytokens(saved);
  }

  private resolveHref(tokensKey: string): string {
    // אם ה-baseHref שלך הוא '/', זה יחפש בשורש ה-dist:
    return new URL(`tokens-${tokensKey}.css`, document.baseURI).toString();

    // לחלופין אם שמים תחת assets:
   //  return "styles/tokens/" + tokensKey + ".tokens.scss";
  }
}
