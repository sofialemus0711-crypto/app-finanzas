import type { CategoryKind } from '../db/types';

/** Una fila detectada en el documento, lista para revisar antes de importar. */
export interface ParsedRow {
  key: string;
  /** Número de tabla del documento de donde salió la fila. */
  group: number;
  include: boolean;
  kind: CategoryKind;
  category: string;
  subcategory: string;
  amount: number;
}

export interface ParseResult {
  rows: ParsedRow[];
  /** Filas que parecen movimientos (tienen fecha); por ahora no se importan. */
  skippedMovements: number;
}

type Cell = string | number | boolean | Date | null | undefined;

let seq = 0;
const key = () => `r${++seq}`;

/** "120,000" "120.000" "$ 1.300.000" "1300000" "540,000.00" → número; null si no es un valor. */
export function parseAmount(raw: Cell): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(Math.abs(raw)) : null;
  if (typeof raw !== 'string') return null;
  let s = raw.trim().replace(/^\$\s*/, '').replace(/\s*(cop|pesos)$/i, '');
  if (!/^-?[\d.,\s']+$/.test(s) || !/\d/.test(s)) return null;
  s = s.replace(/[\s']/g, '');
  // Quitar decimales tipo ",00" o ".50" al final si hay separadores de miles antes
  s = s.replace(/^(-?[\d.,]*\d{3})[.,]\d{1,2}$/, '$1');
  const n = parseInt(s.replace(/[.,]/g, ''), 10);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

const DATE_RE = /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/;
const isDateCell = (c: Cell) => c instanceof Date || (typeof c === 'string' && DATE_RE.test(c.trim()));

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const INCOME_HEADER = /^(ingresos?|entradas?)\b/;
const EXPENSE_HEADER = /^(egresos?|gastos?|salidas de dinero|categorias?)\b/;
const HEADER_WORDS = new Set(['fecha', 'monto', 'valor', 'categoria', 'subcategoria', 'descripcion', 'tipo', 'cuenta', 'nota', 'detalle', 'concepto']);
const SKIP = /^(total|subtotal|columna\s*\d*|valor|monto|presupuesto|total mi aporte|saldo|balance)\b/;

function cleanName(s: string): string {
  return s
    .replace(/[|_•·*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[-–:.\s]+|[-–:.\s]+$/g, '')
    .trim();
}

/** "Salidas - Alimentación" → ["Salidas", "Alimentación"] */
export function splitName(name: string): [string, string] {
  const parts = name.split(/\s+[-–>/:]\s+|\s*›\s*|\s*>\s*/).map(cleanName).filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts.slice(1).join(' ')];
  return [cleanName(name), ''];
}

/**
 * Procesa "flujos" de filas (cada tabla del documento es un flujo).
 * Un encabezado como "Ingresos" o "Categoría" cambia el tipo de las filas siguientes.
 */
export function parseStreams(streams: Cell[][][], defaultKind: CategoryKind = 'egreso'): ParseResult {
  const rows: ParsedRow[] = [];
  let skippedMovements = 0;
  streams.forEach((stream, group) => {
    let kind = defaultKind;
    stream.forEach((cells, idx) => {
      const nonEmpty = cells.filter((c) => c !== null && c !== undefined && String(c).trim() !== '');
      if (nonEmpty.length === 0) return;
      if (nonEmpty.some(isDateCell)) {
        skippedMovements++;
        return;
      }
      const texts = nonEmpty.filter((c) => parseAmount(c) === null).map((c) => String(c).trim());
      const amounts = nonEmpty.map(parseAmount).filter((n): n is number => n !== null);
      const name = cleanName(texts.join(' - '));
      if (!name) return;
      if (texts.every((t) => HEADER_WORDS.has(norm(t)))) return;
      const n = norm(name);
      if (INCOME_HEADER.test(n)) { kind = 'ingreso'; return; }
      if (EXPENSE_HEADER.test(n) && amounts.length === 0) { kind = 'egreso'; return; }
      if (SKIP.test(n) || /columna\s*\d|^[a-z]$/.test(n)) return;
      if (name.length > 60 || /^[A-Z]{1,3}$/.test(name)) return;
      // Primera fila sin valor de una tabla larga: casi siempre es un encabezado ilegible.
      if (idx === 0 && amounts.length === 0 && stream.length >= 3 && !/\s/.test(name) && name.length <= 6) return;
      const [category, subcategory] = splitName(texts.length > 1 ? texts.join(' - ') : name);
      rows.push({ key: key(), group, include: true, kind, category, subcategory, amount: amounts.length ? amounts[amounts.length - 1] : 0 });
    });
  });
  return { rows: dedupe(rows), skippedMovements };
}

function dedupe(rows: ParsedRow[]): ParsedRow[] {
  const seen = new Map<string, ParsedRow>();
  for (const r of rows) {
    const k = `${r.kind}|${norm(r.category)}|${norm(r.subcategory)}`;
    const prev = seen.get(k);
    if (prev) {
      if (r.amount) prev.amount = r.amount;
    } else {
      seen.set(k, r);
    }
  }
  return [...seen.values()];
}

/** Hoja de cálculo → flujos: cada bloque de columnas separado por columnas vacías es una tabla. */
export function gridToStreams(grid: Cell[][]): Cell[][][] {
  const streams = new Map<number, Cell[][]>();
  for (const row of grid) {
    let start = -1;
    let seg: Cell[] = [];
    const flush = () => {
      if (start >= 0 && seg.length) {
        if (!streams.has(start)) streams.set(start, []);
        streams.get(start)!.push(seg);
      }
      start = -1;
      seg = [];
    };
    row.forEach((c, i) => {
      const empty = c === null || c === undefined || String(c).trim() === '';
      if (empty) {
        // Una celda vacía dentro de una fila de tabla (p. ej. "Boxeo" sin valor) no corta la tabla
        // si la siguiente celda sigue teniendo datos y la tabla ya empezó.
        if (start >= 0 && i + 1 < row.length && row[i + 1] !== null && row[i + 1] !== undefined && String(row[i + 1]).trim() !== '' && seg.length === 1) {
          seg.push(c);
          return;
        }
        flush();
      } else {
        if (start < 0) start = i;
        seg.push(c);
      }
    });
    flush();
  }
  return [...streams.entries()].sort((a, b) => a[0] - b[0]).map(([, rows]) => rows);
}

/** Texto pegado (desde Excel, notas, WhatsApp…) → flujos. */
export function textToStreams(text: string): Cell[][][] {
  const lines = text.split(/\r?\n/);
  if (lines.some((l) => l.includes('\t'))) {
    return gridToStreams(lines.map((l) => l.split('\t')));
  }
  if (lines.filter((l) => l.includes(';')).length > lines.length / 2) {
    return gridToStreams(lines.map((l) => l.split(';')));
  }
  return [lines.map(splitTextLine)];
}

/** "Gimnasio 120,000" → ["Gimnasio", "120,000"] */
export function splitTextLine(line: string): Cell[] {
  const m = line.match(/^(.*?)[\s:=|]*(\$?\s*-?\d[\d.,\s']*)\s*$/);
  if (m && m[1].trim() && parseAmount(m[2]) !== null) return [m[1].trim(), m[2].trim()];
  return [line.trim()];
}

/** Ícono sugerido según el nombre de la categoría. */
export function guessIcon(name: string, kind: CategoryKind): string {
  const n = norm(name);
  const rules: [RegExp, string][] = [
    [/gimnas|gym|deporte|box/, 'gym'],
    [/universidad|estudio|colegio|curso|matricula|educacion/, 'grad'],
    [/salida|fiesta|rumba|bar|entreten|cine|ocio/, 'party'],
    [/suplement|salud|medic|farmacia|eps|droga/, 'pill'],
    [/pan|panaderia|harina/, 'bread'],
    [/comida|aliment|mercado|restaurante|almuerzo|domicilio/, 'food'],
    [/cafe/, 'coffee'],
    [/transporte|bus|metro|uber|taxi/, 'bus'],
    [/gasolina|carro|moto|parqueadero/, 'car'],
    [/arriendo|casa|hogar|vivienda/, 'home'],
    [/servicio|luz|agua|gas|internet|energia/, 'bolt'],
    [/celular|plan|telefono/, 'phone'],
    [/ropa|compras|zapato/, 'shirt'],
    [/regalo/, 'gift'],
    [/mascota|perro|gato/, 'paw'],
    [/viaje|vuelo/, 'plane'],
    [/sapiencia|beca|sostenimiento|icetex/, 'book'],
    [/papa|mama|familia|tio|abuel/, 'user'],
    [/trabajo|salario|sueldo|nomina|negocio|empresa/, 'briefcase'],
    [/venta|emprend/, 'cart'],
    [/inversion|ahorro|cdt|interes/, 'chart'],
  ];
  for (const [re, icon] of rules) if (re.test(n)) return icon;
  return kind === 'ingreso' ? 'star' : 'dots';
}

export { norm as normalizeName };

/* ---------------------- Reconstruir tablas desde una foto ---------------------- */

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/**
 * Usa la posición de cada palabra para rearmar la tabla:
 * 1) agrupa palabras en filas por altura, 2) separa celdas por espacios grandes,
 * 3) une cada nombre con el valor que tiene a su derecha, y
 * 4) agrupa los nombres por columna, para separar tablas que están lado a lado.
 */
export function wordsToStreams(words: OcrWord[]): Cell[][][] {
  const ws = words
    .map((w) => ({ ...w, text: w.text.trim() }))
    .filter((w) => w.text && w.confidence >= 30 && !/^[|_—–=~]+$/.test(w.text));
  if (ws.length === 0) return [];
  const h = median(ws.map((w) => w.bbox.y1 - w.bbox.y0)) || 10;

  // 1) Filas
  const sorted = [...ws].sort((a, b) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1));
  const lines: (typeof ws)[] = [];
  for (const w of sorted) {
    const cy = (w.bbox.y0 + w.bbox.y1) / 2;
    const last = lines[lines.length - 1];
    if (last) {
      const ly = last.reduce((s, x) => s + (x.bbox.y0 + x.bbox.y1) / 2, 0) / last.length;
      if (Math.abs(cy - ly) < h * 0.6) {
        last.push(w);
        continue;
      }
    }
    lines.push([w]);
  }

  // 2) Celdas y 3) pares nombre → valor
  interface Item { x: number; cells: Cell[] }
  const rowsOfItems: Item[][] = [];
  for (const line of lines) {
    line.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const cells: { text: string; x0: number }[] = [];
    for (const w of line) {
      const prev = cells[cells.length - 1];
      const prevWord = line[line.indexOf(w) - 1];
      if (prev && prevWord && w.bbox.x0 - prevWord.bbox.x1 < h * 1.1) prev.text += ' ' + w.text;
      else cells.push({ text: w.text, x0: w.bbox.x0 });
    }
    const items: Item[] = [];
    for (const c of cells) {
      const t = c.text
        .replace(/^[\dIlOo|]{1,3}\s+(?=\p{L})/u, '')
        .replace(/^[A-Z]{1,2}\s+(?=\p{Lu}\p{Ll})/u, '')
        .replace(/^[^\p{L}\d$]+|[^\p{L}\d]+$/gu, '')
        .trim();
      if (parseAmount(t) !== null) {
        const last = items[items.length - 1];
        if (last && last.cells.length === 1) last.cells.push(t);
        continue;
      }
      if (t.length < 3 || /[=([\]{}]/.test(t) || !/\p{L}{2}/u.test(t)) continue;
      items.push({ x: c.x0, cells: [t] });
    }
    if (items.length) rowsOfItems.push(items);
  }

  // 4) Columnas de nombres (tablas lado a lado)
  const xs = rowsOfItems.flat().map((i) => i.x).sort((a, b) => a - b);
  const cols: number[] = [];
  for (const x of xs) {
    if (!cols.length || x - cols[cols.length - 1] > h * 4) cols.push(x);
    else cols[cols.length - 1] = (cols[cols.length - 1] + x) / 2;
  }
  const colOf = (x: number) => cols.reduce((best, c, i) => (Math.abs(c - x) < Math.abs(cols[best] - x) ? i : best), 0);
  const streams: Cell[][][] = cols.map(() => []);
  for (const items of rowsOfItems) for (const it of items) streams[colOf(it.x)].push(it.cells);
  return streams.filter((s) => s.length);
}
