import { gridToMovements, gridToStreams, parseStreams, splitTextLine, textToMovements, textToStreams, wordsToLines, wordsToStreams, type OcrWord, type ParsedMovement, type ParseResult } from './importParse';
import { normalize } from './classify';

export interface ImportResult extends ParseResult {
  movements: ParsedMovement[];
}

/** Quita de las categorías las filas que en realidad son movimientos ya detectados. */
function combine(cats: ParseResult, movements: ParsedMovement[]): ImportResult {
  const descs = new Set(movements.map((m) => normalize(m.description)));
  const rows = cats.rows.filter((r) => !descs.has(normalize(r.subcategory ? `${r.category} ${r.subcategory}` : r.category)));
  return { rows, skippedMovements: 0, movements };
}

/** Separa un CSV respetando comillas; detecta el separador (; , o tabulación). */
export function splitCsv(text: string): string[][] {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const sep = ['\t', ';', ','].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Excel (.xlsx): lee todas las hojas. La librería se descarga solo cuando se usa. */
export async function parseExcel(file: File): Promise<ImportResult> {
  const { default: readExcelFile } = await import('read-excel-file/browser');
  const sheets: { data: unknown[][] }[] = await readExcelFile(file);
  const streams = sheets.flatMap((s) => gridToStreams(s.data as never));
  const movements = sheets.flatMap((s) => gridToMovements(s.data as never));
  return combine(parseStreams(streams), movements);
}

/** CSV o texto plano. */
export async function parseTextFile(file: File): Promise<ImportResult> {
  const text = await file.text();
  if (/\.csv$/i.test(file.name)) {
    const grid = splitCsv(text);
    return combine(parseStreams(gridToStreams(grid)), gridToMovements(grid));
  }
  return parsePastedText(text);
}

export function parsePastedText(text: string): ImportResult {
  const tabular = text.split(/\r?\n/).filter((l) => l.includes('\t') || l.split(';').length > 2).length > 1;
  const movements = tabular ? gridToMovements(splitCsv(text)) : textToMovements(text);
  return combine(parseStreams(textToStreams(text)), movements);
}

/**
 * Foto o captura de pantalla: reconoce el texto en el propio celular (OCR en español),
 * sin enviar la imagen a ningún servidor. Los archivos del lector se descargan la primera vez.
 */
export async function parseImage(file: File, onProgress: (pct: number, label: string) => void): Promise<ImportResult> {
  onProgress(0, 'Preparando el lector de imágenes…');
  const { createWorker, OEM } = await import('tesseract.js');
  const base = new URL('./ocr/', window.location.href).href;
  const worker = await createWorker('spa', OEM.LSTM_ONLY, {
    workerPath: base + 'worker.min.js',
    corePath: base,
    langPath: base + 'lang',
    gzip: true,
    workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => {
      const label = m.status === 'recognizing text' ? 'Leyendo la imagen…' : 'Preparando el lector de imágenes…';
      onProgress(Math.round((m.progress ?? 0) * 100), label);
    },
  });
  try {
    // Se lee dos veces (modo automático y modo "texto disperso") y se combinan las palabras:
    // así no se pierden columnas de valores que un solo modo a veces no detecta.
    let last: ImportResult = { rows: [], skippedMovements: 0, movements: [] };
    for (const binarize of [true, false]) {
      const img = await prepare(file, binarize);
      const words: OcrWord[] = [];
      let text = '';
      for (const psm of ['3', '11']) {
        await worker.setParameters({ tessedit_pageseg_mode: psm as never });
        const { data } = await worker.recognize(img, {}, { blocks: true, text: true });
        const blocks = (data as { blocks?: { paragraphs: { lines: { words: OcrWord[] }[] }[] }[] | null }).blocks;
        words.push(...(blocks?.flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words))) ?? []));
        if (!text) text = String(data.text);
      }
      const merged = mergeWords(words);
      const movements = textToMovements(wordsToLines(merged).join('\n'));
      let cats = parseStreams(wordsToStreams(merged));
      if (cats.rows.length === 0) cats = parseStreams([text.split('\n').map(splitTextLine)]);
      last = combine(cats, movements);
      if (last.rows.length + last.movements.length >= 2) return last;
    }
    return last;
  } finally {
    await worker.terminate();
  }
}

/**
 * Celdas con fondo oscuro y letra clara (p. ej. encabezados azules de Excel):
 * donde casi todo alrededor es negro, se invierte para que la letra quede oscura sobre blanco.
 */
export function invertDarkBlocks(a: Uint8ClampedArray, w: number, h: number, win = 41): void {
  const I = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += a[(y * w + x) * 4] === 0 ? 1 : 0;
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const r = win >> 1;
  const flip = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      if (sum > 0.62 * (x1 - x0) * (y1 - y0)) flip[y * w + x] = 1;
    }
  }
  for (let p = 0; p < w * h; p++) {
    if (!flip[p]) continue;
    const i = p * 4;
    const v = a[i] === 0 ? 255 : 0;
    a[i] = a[i + 1] = a[i + 2] = v;
  }
}

/** Borra las líneas largas de las tablas (bordes de celdas), que confunden al lector. */
export function removeGridLines(a: Uint8ClampedArray, w: number, h: number): void {
  const black = (x: number, y: number) => a[(y * w + x) * 4] === 0;
  const white = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    a[i] = a[i + 1] = a[i + 2] = 255;
  };
  const minH = Math.max(80, w * 0.1);
  const minV = Math.max(40, h * 0.05);
  const marks: [number, number][] = [];
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x <= w; x++) {
      if (x < w && black(x, y)) run++;
      else {
        if (run >= minH) for (let k = x - run; k < x; k++) marks.push([k, y]);
        run = 0;
      }
    }
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y <= h; y++) {
      if (y < h && black(x, y)) run++;
      else {
        if (run >= minV) for (let k = y - run; k < y; k++) marks.push([x, k]);
        run = 0;
      }
    }
  }
  for (const [x, y] of marks) white(x, y);
}

/** Une palabras de dos lecturas: si dos se superponen, se queda con la de mayor confianza. */
function mergeWords(words: OcrWord[]): OcrWord[] {
  const out: OcrWord[] = [];
  const area = (b: OcrWord['bbox']) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
  for (const w of [...words].sort((a, b) => b.confidence - a.confidence)) {
    const overlaps = out.some((o) => {
      const ix = Math.max(0, Math.min(o.bbox.x1, w.bbox.x1) - Math.max(o.bbox.x0, w.bbox.x0));
      const iy = Math.max(0, Math.min(o.bbox.y1, w.bbox.y1) - Math.max(o.bbox.y0, w.bbox.y0));
      return ix * iy > 0.4 * Math.min(area(o.bbox), area(w.bbox));
    });
    if (!overlaps) out.push(w);
  }
  return out;
}

/**
 * Prepara la imagen: la agranda si es pequeña (las capturas se leen mejor más grandes)
 * y, si se pide, la pasa a blanco y negro (invirtiendo si es un modo oscuro).
 */
async function prepare(file: File, binarize: boolean): Promise<Blob | File> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = bmp.width < 1600 ? Math.min(3, 1700 / bmp.width) : bmp.width > 3000 ? 3000 / bmp.width : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    if (binarize) {
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const a = img.data;
      let sum = 0;
      for (let i = 0; i < a.length; i += 4) sum += 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
      const dark = sum / (a.length / 4) < 110;
      for (let i = 0; i < a.length; i += 4) {
        let g = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
        if (dark) g = 255 - g;
        const v = g < 150 ? 0 : 255;
        a[i] = a[i + 1] = a[i + 2] = v;
      }
      invertDarkBlocks(a, canvas.width, canvas.height);
      removeGridLines(a, canvas.width, canvas.height);
      ctx.putImageData(img, 0, 0);
    }
    return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b ?? file), 'image/png'));
  } catch {
    return file;
  }
}
