import { fromISODate, toISODate } from './dates';

export interface Period {
  /** Inclusive, YYYY-MM-DD */
  start: string;
  /** Inclusive, YYYY-MM-DD */
  end: string;
  /** Nombre visible, p. ej. "Noviembre 2026" o "15 nov – 14 dic" */
  label: string;
}

const monthFmt = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' });
const dmFmt = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' });

function clampDay(year: number, month: number, day: number): Date {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last));
}

/**
 * Periodo financiero que contiene la fecha `ref`.
 * startDay = 1 → mes calendario. startDay = 15 → del 15 al 14 del mes siguiente.
 * offset = -1 → periodo anterior, +1 → siguiente.
 */
export function periodFor(ref: string, startDay: number, offset = 0): Period {
  const d = fromISODate(ref);
  const y = d.getFullYear();
  let m = d.getMonth();
  if (d.getDate() < Math.min(startDay, new Date(y, m + 1, 0).getDate())) m -= 1;
  m += offset;
  const start = clampDay(y, m, startDay);
  const nextStart = clampDay(y, m + 1, startDay);
  const end = new Date(nextStart);
  end.setDate(end.getDate() - 1);
  let label: string;
  if (startDay === 1) {
    const s = monthFmt.format(start);
    label = s.charAt(0).toUpperCase() + s.slice(1);
  } else {
    label = `${dmFmt.format(start)} – ${dmFmt.format(end)}`.replace(/\./g, '');
  }
  return { start: toISODate(start), end: toISODate(end), label };
}
