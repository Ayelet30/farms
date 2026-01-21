import { Component, EventEmitter, Input, Output, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { dbTenant, getSupabaseClient } from '../../services/legacy-compat';
import { TenantBootstrapService } from '../../services/tenant-bootstrap.service';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as fontkitModule from '@pdf-lib/fontkit';

type FarmDoc = {
  id: string;
  title: string;
  version: number;
  storage_bucket: string;
  storage_path: string;
  published_at: string;
};

@Component({
  selector: 'app-child-terms-sign',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './child-terms-sign.component.html',
  styleUrls: ['./child-terms-sign.component.css'],
})
export class ChildTermsSignComponent implements OnInit {
  @Input() childId!: string;
  @Input() childName!: string;

  @Output() closed = new EventEmitter<void>();
  @Output() signed = new EventEmitter<void>();

  loading = true;
  saving = false;
  error: string | null = null;

  doc = signal<FarmDoc | null>(null);

  // שומרים גם raw (כמחרוזת) וגם safe (להטמעה ב-iframe)
  docUrlRaw = signal<string | null>(null);
  docUrlSafe = signal<SafeResourceUrl | null>(null);

  signedName = '';
  accept = false;

  constructor(
    private tenantBoot: TenantBootstrapService,
    private sanitizer: DomSanitizer
  ) {}

  async ngOnInit() {
    await this.loadActiveDoc();
  }

  private async loadActiveDoc() {
    this.loading = true;
    this.error = null;

    await this.tenantBoot.ensureReady();

    try {
      const dbc = dbTenant();

      const { data, error } = await dbc
        .from('farm_documents')
        .select('id, title, version, storage_bucket, storage_path, published_at')
        .eq('doc_type', 'TERMS')
        .eq('is_active', true)
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        this.error = 'לא נמצא תקנון פעיל בחווה';
        return;
      }

      this.doc.set(data as any);

      const bucket = (data as any).storage_bucket as string;   // "farm-docs"
      const path   = (data as any).storage_path as string;     // "moacha_atarim_app/terms/v1.pdf"

      const client = getSupabaseClient();

      const { data: pub } = client.storage.from(bucket).getPublicUrl(path);
        const url = pub?.publicUrl ?? null;

      this.docUrlRaw.set(url);
      this.docUrlSafe.set(url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null);

      if (!url) this.error = 'לא הצלחתי לייצר קישור לתקנון';
    } catch (e: any) {
      console.error(e);
      this.error = e?.message ?? 'שגיאה בטעינת התקנון';
    } finally {
      this.loading = false;
    }
  }

  close() {
    if (this.saving) return;
    this.closed.emit();
  }

  async signNow() {
    this.error = null;

    if (!this.accept) return void (this.error = 'יש לאשר שקראת את התקנון לפני חתימה');
    if (!this.signedName.trim()) return void (this.error = 'נא להזין שם מלא לחתימה');
    if (!this.childId) return void (this.error = 'חסר childId');

    console.log('childId being sent to rpc:', this.childId);


    this.saving = true;

    try {
      const dbc = dbTenant();
      const userAgent = navigator.userAgent || null;

      const { error } = await dbc.rpc('sign_child_terms', {
        p_child_id: this.childId,
        p_signed_name: this.signedName.trim(),
        p_signature_svg: null,
        p_signature_text: this.signedName.trim(),
        p_user_agent: userAgent,
        p_ip: null,
      });

      if (error) throw error;

      const doc = this.doc(); // מה-loadActiveDoc
if (!doc) throw new Error('חסר מסמך תקנון');

const originalUrl = this.docUrlRaw();
if (!originalUrl) throw new Error('חסר קישור למסמך המקורי');

console.log('Building signed PDF for child:', this.childId, 'with name:', this.signedName, 'on doc:', doc.id, originalUrl);

const now = new Date();
const signedLine =
  `נחתם דיגיטלית בתאריך ${now.toLocaleDateString('he-IL')} ${now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })} • ` +
  `שם החותם: ${this.signedName.trim()} • ילד: ${this.childName}`;

const signedBytes = await this.buildSignedPdfFromStorage(doc.storage_bucket, doc.storage_path, signedLine);

// קבעי bucket נפרד למסמכים חתומים
const signedBucket = 'signed-docs';

// path לפי חווה/ילד/גרסה
const safeChild = this.childId;
const path = `${doc.storage_path.replace(/\/[^\/]+$/, '')}/signed/${safeChild}/terms_v${doc.version}.pdf`;
// לדוגמה: moacha_atarim_app/terms/signed/<child_uuid>/terms_v1.pdf

console.log('!!!!!Uploading signed PDF to path:', path);
await this.uploadSignedPdf(signedBytes, signedBucket, path);

// עכשיו מעדכנים DB איפה נמצא ה-PDF החתום
const { error: attachErr } = await dbc.rpc('attach_signed_terms_pdf', {
  p_child_id: this.childId,
  p_document_id: doc.id,
  p_bucket: signedBucket,
  p_path: path,
});
if (attachErr) throw attachErr;


      this.signed.emit();
      this.closed.emit();
    } catch (e: any) {
      console.error(e);
      this.error = e?.message ?? 'שגיאה בחתימה על התקנון';
    } finally {
      this.saving = false;
    }

    
  }

  private async fetchPdfBytesViaStorage(bucket: string, path: string): Promise<Uint8Array> {
  const client = getSupabaseClient();

  const { data, error } = await client.storage.from(bucket).download(path);
  if (error) throw error;
  if (!data) throw new Error('לא התקבל קובץ');

  const ab = await data.arrayBuffer();
  return new Uint8Array(ab);
}


  private async buildSignedPdfFromStorage(bucket: string, path: string, signedLine: string): Promise<Uint8Array> {
  const originalBytes = await this.fetchPdfBytesViaStorage(bucket, path);

  const pdfDoc = await PDFDocument.load(originalBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const page0 = pdfDoc.getPages()[0];
  const { width } = page0.getSize();

  page0.drawText(signedLine, {
    x: 24,
    y: 18,
    size: 10,
    font,
    color: rgb(0.35, 0.35, 0.35),
    maxWidth: width - 48,
  });

  return await pdfDoc.save();
}


private async uploadSignedPdf(bytes: Uint8Array, bucket: string, path: string): Promise<void> {
    console.log('Uploading signed PDF to:', bucket, path);
  const client = getSupabaseClient();
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const file = new Blob([ab], { type: 'application/pdf' }); // ✅



  const { error } = await client.storage.from(bucket).upload(path, file, {
    upsert: true,
    contentType: 'application/pdf',
    cacheControl: '3600',
  });

  if (error) throw error;
}

}
