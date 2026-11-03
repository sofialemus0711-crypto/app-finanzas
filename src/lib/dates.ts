/** Fecha local en formato YYYY-MM-DD (sin problemas de zona horaria). */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today(): string {
  return toISODate(new Date());
}

export function fromISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, days: number): string {
  const d = fromISODate(s);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

const dayFmt = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'short' });
const shortFmt = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });

/** "Hoy", "Ayer" o "domingo 2 nov" */
export function friendlyDay(s: string, now = today()): string {
  if (s === now) return 'Hoy';
  if (s === addDays(now, -1)) return 'Ayer';
  return dayFmt.format(fromISODate(s)).replace('.', '');
}

export function shortDate(s: string): string {
  return shortFmt.format(fromISODate(s)).replace(/\./g, '');
}
