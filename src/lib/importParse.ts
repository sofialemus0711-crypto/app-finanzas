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
const STARTS_WITH_DATE = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/;
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
      if (nonEmpty.some(isDateCell) || (typeof nonEmpty[0] === 'string' && STARTS_WITH_DATE.test(nonEmpty[0].trim()))) {
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
      // Encabezados de fecha ("Lunes 3 de noviembre", "3 nov 2026") no son categorías.
      if (/^(lunes|martes|miercoles|jueves|viernes|sabado|domingo|hoy|ayer)\b/.test(n) || parseDate(name) !== null) return;
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

function groupLines<T extends OcrWord>(ws: T[], h: number): T[][] {
  const sorted = [...ws].sort((a, b) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1));
  const lines: T[][] = [];
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
  return lines;
}

/** Palabras de una foto → líneas de texto de izquierda a derecha (para leer movimientos). */
export function wordsToLines(words: OcrWord[]): string[] {
  const ws = words.filter((w) => w.text.trim() && w.confidence >= 30);
  if (!ws.length) return [];
  const h = median(ws.map((w) => w.bbox.y1 - w.bbox.y0)) || 10;
  return groupLines(ws, h).map((l) => l.sort((a, b) => a.bbox.x0 - b.bbox.x0).map((w) => w.text.trim()).join(' '));
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
  const lines = groupLines(ws, h);

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

/* ------------------------------ Movimientos ------------------------------ */

export interface ParsedMovement {
  key: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  /** Tipo si el documento lo dice (columna "Tipo" o valor negativo). */
  type: 'ingreso' | 'egreso' | null;
  categoryText: string;
  subcategoryText: string;
  accountText: string;
}

const MONTHS: Record<string, number> = { set: 9, ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12, jan: 1, apr: 4, aug: 8, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');

/** Fechas de Excel o texto: Date, número de serie, 2026-11-03, 03/11/2026, 3-11-26, "3 nov 2026". Día/mes al estilo colombiano. */
export function parseDate(raw: Cell, fallbackYear = new Date().getFullYear()): string | null {
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    // read-excel-file entrega las fechas en UTC
    return `${raw.getUTCFullYear()}-${pad(raw.getUTCMonth() + 1)}-${pad(raw.getUTCDate())}`;
  }
  if (typeof raw === 'number' && raw > 30000 && raw < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return valid(y, +m[2], +m[1]) ?? valid(y, +m[1], +m[2]);
  }
  m = s.match(/^(\d{1,2})\s*(?:de\s+)?([a-z]{3,10})\.?(?:\s*(?:de(?:l)?\s+)?(\d{4}))?/);
  const mon = m ? (MONTHS[m[2].slice(0, 4)] ?? MONTHS[m[2].slice(0, 3)]) : undefined;
  if (m && mon && (m[2].length <= 4 || /^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|june|july|august|september|october|november|december)$/.test(m[2]))) {
    return valid(m[3] ? +m[3] : fallbackYear, mon, +m[1]);
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (m) return valid(fallbackYear, +m[2], +m[1]);
  return null;
}

function valid(y: number, mo: number, d: number): string | null {
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getMonth() !== mo - 1) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

type Col = 'date' | 'amount' | 'income' | 'expense' | 'description' | 'category' | 'subcategory' | 'type' | 'account';
const COL_WORDS: [Col, RegExp][] = [
  ['date', /^(fecha|dia|date)$/],
  ['income', /^(ingreso|ingresos|entrada|entradas|abono|credito|creditos)$/],
  ['expense', /^(egreso|egresos|gasto|gastos|salida|salidas|cargo|debito|debitos|retiro)$/],
  ['amount', /^(monto|valor|importe|cantidad|total|precio|amount)$/],
  ['description', /^(descripcion|concepto|detalle|nota|notas|movimiento|referencia|comentario)$/],
  ['subcategory', /^(subcategoria|sub categoria|subcat)$/],
  ['category', /^(categoria|rubro|clasificacion)$/],
  ['type', /^(tipo|tipo de movimiento|clase)$/],
  ['account', /^(cuenta|banco|medio|medio de pago|fuente|billetera)$/],
];

function headerMap(row: Cell[]): Map<number, Col> | null {
  const map = new Map<number, Col>();
  row.forEach((c, i) => {
    if (typeof c !== 'string') return;
    const n = norm(c).replace(/[^a-z ]/g, '').trim();
    for (const [col, re] of COL_WORDS) {
      if (re.test(n) && ![...map.values()].includes(col)) {
        map.set(i, col);
        break;
      }
    }
  });
  const cols = [...map.values()];
  return cols.includes('date') && (cols.includes('amount') || cols.includes('income') || cols.includes('expense')) ? map : null;
}

function typeFromText(s: string): 'ingreso' | 'egreso' | null {
  const n = norm(s);
  if (/^(ingreso|entrada|abono|credito|\+)/.test(n)) return 'ingreso';
  if (/^(egreso|gasto|salida|debito|cargo|retiro|-)/.test(n)) return 'egreso';
  return null;
}

/** Hoja de cálculo → movimientos. Usa los encabezados si los hay (Fecha, Valor, Descripción…). */
export function gridToMovements(grid: Cell[][]): ParsedMovement[] {
  const out: ParsedMovement[] = [];
  let hadNegative = false;
  let header: Map<number, Col> | null = null;
  for (const row of grid) {
    const h = headerMap(row);
    if (h) {
      header = h;
      continue;
    }
    if (header) {
      const get = (col: Col) => {
        for (const [i, c] of header!) if (c === col) return row[i];
        return undefined;
      };
      const date = parseDate(get('date') ?? null);
      if (!date) continue;
      let amount = parseSigned(get('amount'));
      let type = typeFromText(String(get('type') ?? ''));
      const inc = parseAmount(get('income') ?? null);
      const exp = parseAmount(get('expense') ?? null);
      if (inc) { amount = inc; type = 'ingreso'; }
      else if (exp) { amount = -exp; type = 'egreso'; }
      if (!amount) continue;
      if (!type && amount < 0) {
        type = 'egreso';
        hadNegative = true;
      }
      out.push({
        key: key(),
        date,
        description: String(get('description') ?? '').trim(),
        amount: Math.abs(amount),
        type,
        categoryText: String(get('category') ?? '').trim(),
        subcategoryText: String(get('subcategory') ?? '').trim(),
        accountText: String(get('account') ?? '').trim(),
      });
      continue;
    }
    // Sin encabezados: una fila con fecha y valor es un movimiento.
    const m = rowToMovement(row);
    if (m) {
      if (m.type === 'egreso') hadNegative = true;
      out.push(m);
    }
  }
  // Si la hoja usa negativos para los gastos, los positivos sin tipo son ingresos.
  if (hadNegative) for (const m of out) if (!m.type) m.type = 'ingreso';
  return out;
}

function parseSigned(c: Cell): number {
  if (typeof c === 'number') return Math.round(c);
  if (typeof c !== 'string') return 0;
  const neg = /^\s*[-(−]/.test(c);
  const n = parseAmount(c.replace(/^\s*[-(−]\s*|\)\s*$/g, ''));
  return n ? (neg ? -n : n) : 0;
}

function rowToMovement(cells: Cell[]): ParsedMovement | null {
  const ne = cells.filter((c) => c !== null && c !== undefined && String(c).trim() !== '');
  const di = ne.findIndex((c) => parseDate(c) !== null && (c instanceof Date || typeof c === 'string'));
  if (di < 0) return null;
  const date = parseDate(ne[di])!;
  const rest = ne.filter((_, i) => i !== di);
  const nums = rest.map(parseSigned).filter((n) => n !== 0);
  if (nums.length === 0) return null;
  const amount = nums[nums.length - 1];
  const texts = rest.filter((c) => typeof c === 'string' && parseAmount(c) === null && parseSigned(c) === 0).map((c) => String(c).trim());
  let type: 'ingreso' | 'egreso' | null = amount < 0 ? 'egreso' : null;
  const typeIdx = texts.findIndex((t) => typeFromText(t) && t.length <= 8);
  if (typeIdx >= 0) {
    type = typeFromText(texts[typeIdx]);
    texts.splice(typeIdx, 1);
  }
  return { key: key(), date, description: texts.join(' · '), amount: Math.abs(amount), type, categoryText: '', subcategoryText: '', accountText: '' };
}

const DATE_PREFIX = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?|\d{1,2}\s*(?:de\s+)?[a-zA-Z]{3,10}\.?(?:\s*(?:de\s+)?\d{4})?)\s*[-–:,|]?\s*/;

/** Texto o foto: líneas como "03/11/2026 Almuerzo U 18.000" o "3 nov - Uber - 12.500". */
export function textToMovements(text: string, year = new Date().getFullYear()): ParsedMovement[] {
  const out: ParsedMovement[] = [];
  let sectionDate: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Una línea que solo es una fecha ("3 nov", "Lunes 3 de noviembre") aplica a las siguientes.
    const stripped = line.replace(/^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo),?\s*/i, '');
    const dm = stripped.match(DATE_PREFIX);
    const lineDate = dm ? parseDate(dm[1], year) : null;
    if (lineDate && !stripped.slice(dm![0].length).trim()) {
      sectionDate = lineDate;
      continue;
    }
    if (line.includes('\t') || line.split(';').length > 2) {
      const m = rowToMovement(line.split(line.includes('\t') ? '\t' : ';'));
      if (m) out.push(m);
      continue;
    }
    const date = lineDate ?? sectionDate;
    if (!date) continue;
    const rest = lineDate ? stripped.slice(dm![0].length) : line;
    const am = rest.match(/([-−+]?\s*\$?\s*\d[\d.,]*)\s*$/);
    if (!am) continue;
    // "Uber - 12.500": el guion con espacio es un separador, no un signo negativo.
    const token = /^[-−+]\s/.test(am[1]) ? am[1].slice(1) : am[1];
    const signed = parseSigned(token.replace(/\s/g, '').replace('+', ''));
    if (!signed) continue;
    const description = rest.slice(0, am.index).replace(/[-–:|,\s]+$/, '').trim();
    out.push({
      key: key(), date, description, amount: Math.abs(signed),
      type: signed < 0 ? 'egreso' : /^\+\S/.test(token) ? 'ingreso' : null,
      categoryText: '', subcategoryText: '', accountText: '',
    });
  }
  return out;
}
