import { meta, type DocumentType } from './documents/types';

export const DEFAULT_NUMBER_FORMAT = '{PREFIX}-{YYYY}-{SEQ:4}';

export interface NumberFormatContext {
  prefix: string;
  sequence: number;
  year: number;
  month?: number;
  companyCode?: string | null;
}

/**
 * Render a document number from a company's format template.
 *
 * Supported tokens: {PREFIX} {COMPANY} {YYYY} {YY} {MM} {SEQ} {SEQ:n}
 * Unknown tokens are left untouched rather than silently dropped, so a typo in
 * the settings screen is visible instead of producing a plausible wrong number.
 */
export function formatDocumentNumber(
  format: string,
  ctx: NumberFormatContext,
): string {
  return format.replace(/\{(PREFIX|COMPANY|YYYY|YY|MM|SEQ)(?::(\d+))?\}/g, (match, token, pad) => {
    switch (token) {
      case 'PREFIX':
        return ctx.prefix;
      case 'COMPANY':
        return ctx.companyCode ?? '';
      case 'YYYY':
        return String(ctx.year);
      case 'YY':
        return String(ctx.year).slice(-2);
      case 'MM':
        return String(ctx.month ?? 1).padStart(2, '0');
      case 'SEQ':
        return String(ctx.sequence).padStart(pad ? Number(pad) : 1, '0');
      default:
        return match;
    }
  });
}

export function defaultPrefix(type: DocumentType): string {
  return meta(type).prefix;
}

/** Placeholder shown on a draft, which has not consumed a real number yet. */
export function draftLabel(documentId: string): string {
  return `#${documentId.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

/** The key a sequence counter is locked and stored under. */
export function sequenceKey(companyId: string, type: DocumentType, year: number): string {
  return `${companyId}:${type}:${year}`;
}
