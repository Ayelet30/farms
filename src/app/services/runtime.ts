// services/runtime.ts
export function readMeta(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  return el?.content?.trim() || null;
}

export function runtime(key: string): string | null {
  const metaName = `x-${key.toLowerCase().replace(/_/g, '-')}`;
  const maybeWindow = typeof window !== 'undefined' ? (window as any) : undefined;

  let fromImportMeta: any = null;
  try { fromImportMeta = (import.meta as any)?.env?.[key] ?? null; } catch {}

  let fromProcess: any = null;
  try { fromProcess = (process as any)?.env?.[key] ?? null; } catch {}

  const val =
    maybeWindow?.__RUNTIME__?.[key] ??
    readMeta(metaName) ??
    fromImportMeta ??
    fromProcess ??
    null;

  return typeof val === 'string' ? val.trim() : val;
}
