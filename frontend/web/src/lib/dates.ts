import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns';

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : parseISO(value);
  return isValid(date) ? date : null;
}

/** Human-friendly absolute date, e.g. "26 May 2026". */
export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'dd MMM yyyy') : '—';
}

/** Absolute date and time, e.g. "26 May 2026, 16:45". */
export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'dd MMM yyyy, HH:mm') : '—';
}

/** Relative time, e.g. "3 days ago". */
export function formatRelative(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? formatDistanceToNow(date, { addSuffix: true }) : '—';
}

/** `yyyy-MM-dd` value suitable for native date inputs. */
export function toDateInputValue(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'yyyy-MM-dd') : '';
}
