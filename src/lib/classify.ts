import type { Category, CategoryKind, Transaction } from '../db/types';

/**
 * Deduce la categoría de un movimiento a partir de su descripción.
 * Combina tres pistas:
 *  1. Lo que ya registraste antes con una descripción igual o parecida (aprende de ti).
 *  2. Palabras que coinciden con el nombre de tus categorías y subcategorías.
 *  3. Un diccionario de palabras comunes (almuerzo → alimentación, uber → transporte, …).
 */

const STOP = new Set(['de', 'la', 'el', 'en', 'para', 'con', 'por', 'del', 'los', 'las', 'una', 'uno', 'un', 'al', 'y', 'a', 'mi', 'mis', 'se', 'que', 'lo', 'su', 'sus', 'pago', 'compra']);

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function tokens(s: string): string[] {
  return normalize(s).split(' ').filter((t) => (t.length >= 2 || t === 'u') && !STOP.has(t) && !/^\d+$/.test(t));
}

/** Concepto → palabras que lo indican. Si el nombre de una categoría contiene el concepto, esas palabras suman puntos. */
const CONCEPTS: { targets: string[]; words: string[] }[] = [
  { targets: ['alimentacion', 'comida', 'restaurante', 'mercado', 'almuerzo'], words: ['almuerzo', 'almuerzos', 'desayuno', 'cena', 'comida', 'restaurante', 'corrientazo', 'empanada', 'empanadas', 'arepa', 'pizza', 'hamburguesa', 'perro', 'mercado', 'exito', 'd1', 'ara', 'olimpica', 'jumbo', 'carulla', 'domicilio', 'rappi', 'ifood', 'snack', 'onces', 'mecato', 'tinto', 'cafe', 'jugo', 'fruta', 'frutas', 'galletas', 'helado', 'pollo', 'sushi', 'salchipapa', 'buñuelo', 'pan'] },
  { targets: ['transporte', 'pasajes', 'movilidad'], words: ['bus', 'buseta', 'metro', 'metroplus', 'tranvia', 'transmilenio', 'sitp', 'uber', 'didi', 'taxi', 'cabify', 'indriver', 'indrive', 'pasaje', 'pasajes', 'tiquete', 'gasolina', 'peaje', 'parqueadero', 'civica', 'recarga', 'moto', 'picap', 'colectivo'] },
  { targets: ['gimnasio', 'gym', 'deporte'], words: ['gym', 'gimnasio', 'bodytech', 'smartfit', 'smart', 'crossfit', 'mensualidad', 'entreno'] },
  { targets: ['suplementos', 'suplemento'], words: ['proteina', 'creatina', 'whey', 'vitamina', 'vitaminas', 'suplemento', 'suplementos', 'preentreno', 'colageno', 'omega'] },
  { targets: ['salidas', 'entretenimiento', 'ocio', 'extras'], words: ['cine', 'bar', 'rumba', 'discoteca', 'fiesta', 'concierto', 'cerveza', 'cervezas', 'trago', 'tragos', 'salida', 'paseo', 'karaoke', 'bolos', 'parque', 'netflix', 'spotify', 'boleta', 'boletas', 'entrada'] },
  { targets: ['universidad', 'educacion', 'estudio', 'estudios'], words: ['universidad', 'u', 'matricula', 'semestre', 'fotocopias', 'copias', 'impresiones', 'libro', 'libros', 'cuaderno', 'curso', 'udea', 'eafit', 'unal', 'upb', 'itm', 'pascual', 'clase', 'clases', 'parcial'] },
  { targets: ['salud', 'medicamentos'], words: ['drogueria', 'farmacia', 'medicamento', 'medicamentos', 'eps', 'cita', 'medico', 'odontologo', 'pastillas', 'examen'] },
  { targets: ['servicios', 'celular', 'internet'], words: ['luz', 'agua', 'gas', 'internet', 'epm', 'claro', 'tigo', 'movistar', 'wom', 'celular', 'plan', 'factura'] },
  { targets: ['compras', 'ropa'], words: ['ropa', 'zapatos', 'tenis', 'camisa', 'pantalon', 'falabella', 'amazon', 'temu', 'shein', 'mercadolibre'] },
  { targets: ['panes', 'insumos', 'pan'], words: ['harina', 'huevos', 'huevo', 'mantequilla', 'margarina', 'levadura', 'azucar', 'queso', 'bocadillo', 'insumos', 'bolsas', 'empaques', 'aceite', 'leche', 'polvo', 'hornear'] },
  { targets: ['panes', 'ventas', 'venta', 'negocio'], words: ['venta', 'ventas', 'vendi', 'pedido', 'pedidos', 'cliente', 'panes'] },
  { targets: ['papa', 'mesada', 'familia'], words: ['papa', 'papi', 'mesada', 'giro'] },
  { targets: ['mama', 'trabajo', 'salario', 'sueldo'], words: ['mama', 'mami', 'trabajo', 'salario', 'sueldo', 'nomina', 'quincena', 'prima'] },
  { targets: ['sapiencia', 'sostenimiento', 'beca'], words: ['sapiencia', 'sostenimiento', 'beca', 'icetex', 'subsidio'] },
];

export interface Candidate {
  categoryId: string;
  subcategoryId: string | null;
  kind: CategoryKind;
}

export interface Suggestion extends Candidate {
  confidence: 'alta' | 'media';
  score: number;
}

export interface ClassifierIndex {
  candidates: { c: Candidate; nameTokens: Set<string>; parentTokens: Set<string>; label: string }[];
  exact: Map<string, Map<string, number>>;
  byToken: Map<string, Map<string, number>>;
}

const candKey = (c: Candidate) => `${c.categoryId}|${c.subcategoryId ?? ''}`;

export function buildIndex(categories: Category[], history: Transaction[]): ClassifierIndex {
  const roots = categories.filter((c) => c.parentId === null);
  const candidates: ClassifierIndex['candidates'] = [];
  for (const r of roots) {
    const subs = categories.filter((c) => c.parentId === r.id);
    const rootTokens = new Set(tokens(r.name));
    if (subs.length === 0) candidates.push({ c: { categoryId: r.id, subcategoryId: null, kind: r.kind }, nameTokens: rootTokens, parentTokens: new Set(), label: r.name });
    for (const s of subs) {
      candidates.push({ c: { categoryId: r.id, subcategoryId: s.id, kind: r.kind }, nameTokens: new Set(tokens(s.name)), parentTokens: rootTokens, label: `${r.name} › ${s.name}` });
    }
  }
  const exact = new Map<string, Map<string, number>>();
  const byToken = new Map<string, Map<string, number>>();
  const bump = (m: Map<string, Map<string, number>>, k: string, v: string) => {
    if (!m.has(k)) m.set(k, new Map());
    const inner = m.get(k)!;
    inner.set(v, (inner.get(v) ?? 0) + 1);
  };
  for (const t of history) {
    if (!t.categoryId || !t.note) continue;
    const ck = `${t.categoryId}|${t.subcategoryId ?? ''}`;
    bump(exact, normalize(t.note), ck);
    for (const tok of new Set(tokens(t.note))) bump(byToken, tok, ck);
  }
  return { candidates, exact, byToken };
}

/** Añade al índice lo que la persona acaba de decidir (para aplicarlo al resto de filas). */
export function learn(index: ClassifierIndex, description: string, c: Candidate): void {
  const ck = candKey(c);
  const bump = (m: Map<string, Map<string, number>>, k: string) => {
    if (!m.has(k)) m.set(k, new Map());
    m.get(k)!.set(ck, (m.get(k)!.get(ck) ?? 0) + 3);
  };
  bump(index.exact, normalize(description));
  for (const tok of new Set(tokens(description))) bump(index.byToken, tok);
}

export function suggest(description: string, kind: CategoryKind | null, index: ClassifierIndex): Suggestion | null {
  const desc = normalize(description);
  if (!desc) return null;
  const toks = tokens(description);
  const tokSet = new Set(toks);
  const scores = new Map<string, number>();
  const pool = index.candidates.filter((x) => !kind || x.c.kind === kind);
  if (pool.length === 0) return null;

  for (const x of pool) {
    let s = 0;
    for (const t of x.nameTokens) if (tokSet.has(t)) s += 4;
    for (const t of x.parentTokens) if (tokSet.has(t)) s += 3;
    for (const concept of CONCEPTS) {
      const nameHit = concept.targets.some((tg) => x.nameTokens.has(tg));
      const parentHit = concept.targets.some((tg) => x.parentTokens.has(tg));
      if (!nameHit && !parentHit) continue;
      if (toks.some((t) => concept.words.includes(t))) s += nameHit ? 3 : 1.5;
    }
    scores.set(candKey(x.c), s);
  }

  // Historial: descripción idéntica pesa mucho; palabras sueltas, un poco.
  const ex = index.exact.get(desc);
  if (ex) for (const [ck, n] of ex) if (scores.has(ck)) scores.set(ck, scores.get(ck)! + 8 + Math.min(4, n));
  for (const t of tokSet) {
    const m = index.byToken.get(t);
    if (!m) continue;
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    for (const [ck, n] of m) if (scores.has(ck)) scores.set(ck, scores.get(ck)! + 3 * (n / total));
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [bestKey, best] = ranked[0];
  if (best < 2.5) return null;
  const second = ranked[1]?.[1] ?? 0;
  const x = pool.find((p) => candKey(p.c) === bestKey)!;
  const clear = best - second >= 1.5;
  return { ...x.c, score: best, confidence: best >= 3 && clear ? 'alta' : 'media' };
}

/** Busca una categoría por texto ("Universidad - Alimentación", "Alimentación", "universidad"). */
export function resolveCategoryText(catText: string, subText: string, kind: CategoryKind | null, categories: Category[]): Candidate | null {
  const roots = categories.filter((c) => c.parentId === null && (!kind || c.kind === kind));
  let main = normalize(catText);
  let sub = normalize(subText);
  if (!sub) {
    const parts = catText.split(/\s+[-–>/:]\s+|\s*›\s*|\s*>\s*/);
    if (parts.length >= 2) {
      main = normalize(parts[0]);
      sub = normalize(parts.slice(1).join(' '));
    }
  }
  if (!main) return null;
  const root = roots.find((r) => normalize(r.name) === main);
  if (root) {
    const subs = categories.filter((c) => c.parentId === root.id);
    const s = sub ? subs.find((c) => normalize(c.name) === sub) : undefined;
    return { categoryId: root.id, subcategoryId: s?.id ?? null, kind: root.kind };
  }
  // ¿Es el nombre de una subcategoría única?
  const subsNamed = categories.filter((c) => c.parentId !== null && normalize(c.name) === main && (!kind || c.kind === kind));
  if (subsNamed.length === 1) return { categoryId: subsNamed[0].parentId!, subcategoryId: subsNamed[0].id, kind: subsNamed[0].kind };
  return null;
}
