const nf = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

/** 18000 → "$ 18.000" */
export function formatMoney(value: number, opts: { sign?: boolean; hidden?: boolean } = {}): string {
  if (opts.hidden) return '$ ••••••';
  const abs = nf.format(Math.abs(Math.round(value)));
  if (opts.sign) {
    if (value > 0) return `+ $ ${abs}`;
    if (value < 0) return `− $ ${abs}`;
  } else if (value < 0) {
    return `− $ ${abs}`;
  }
  return `$ ${abs}`;
}

/** Convierte texto escrito por el usuario ("18.000", "18000", "$ 18 000") a entero. */
export function parseMoney(text: string): number {
  const digits = text.replace(/[^\d-]/g, '');
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : 0;
}
