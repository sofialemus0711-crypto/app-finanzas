import { describe, expect, it } from 'vitest';
import type { Category, Transaction } from '../db/types';
import { buildIndex, resolveCategoryText, suggest } from './classify';
import { gridToMovements, parseDate, textToMovements } from './importParse';

let n = 0;
const cat = (name: string, kind: 'ingreso' | 'egreso', parentId: string | null = null): Category => ({
  id: `c${++n}`, name, kind, parentId, icon: 'dots', color: '#000', budget: 0, coveredByCategoryId: null, order: n, createdAt: 0, updatedAt: 0,
});
const gym = cat('Gimnasio', 'egreso');
const salidas = cat('Salidas', 'egreso');
const salAli = cat('Alimentación', 'egreso', salidas.id);
const salTra = cat('Transporte', 'egreso', salidas.id);
const salExt = cat('Extras', 'egreso', salidas.id);
const uni = cat('Universidad', 'egreso');
const uniAli = cat('Alimentación', 'egreso', uni.id);
const uniTra = cat('Transporte', 'egreso', uni.id);
const sup = cat('Suplementos', 'egreso');
const insumos = cat('Insumos panes', 'egreso');
const panes = cat('Panes', 'ingreso');
const papa = cat('Papá', 'ingreso');
const sapiencia = cat('Sostenimiento Sapiencia', 'ingreso');
const cats = [gym, salidas, salAli, salTra, salExt, uni, uniAli, uniTra, sup, insumos, panes, papa, sapiencia];

const tx = (note: string, categoryId: string, subcategoryId: string | null = null): Transaction => ({
  id: note, type: 'egreso', amount: 1, accountId: 'a', toAccountId: null, categoryId, subcategoryId, date: '2026-10-01', note, createdAt: 0, updatedAt: 0,
});

describe('deducir categoría por descripción', () => {
  const index = buildIndex(cats, [tx('Almuerzo U', uni.id, uniAli.id), tx('Bus U', uni.id, uniTra.id)]);
  const pick = (d: string, kind: 'ingreso' | 'egreso' | null = null) => {
    const s = suggest(d, kind, index);
    if (!s) return null;
    const root = cats.find((c) => c.id === s.categoryId)!.name;
    const sub = s.subcategoryId ? cats.find((c) => c.id === s.subcategoryId)!.name : '';
    return sub ? `${root} › ${sub}` : root;
  };
  it('por nombre de categoría y diccionario', () => {
    expect(pick('Mensualidad gimnasio')).toBe('Gimnasio');
    expect(pick('Proteína whey')).toBe('Suplementos');
    expect(pick('Harina y huevos', 'egreso')).toBe('Insumos panes');
    expect(pick('Uber a la universidad')).toBe('Universidad › Transporte');
    expect(pick('Cine con amigas')).toBe('Salidas › Extras');
    expect(pick('Mesada papá', 'ingreso')).toBe('Papá');
    expect(pick('Pago Sapiencia', 'ingreso')).toBe('Sostenimiento Sapiencia');
    expect(pick('Venta de panes', 'ingreso')).toBe('Panes');
  });
  it('aprende del historial', () => {
    expect(pick('almuerzo u')).toBe('Universidad › Alimentación');
    expect(pick('Bus U')).toBe('Universidad › Transporte');
  });
  it('no inventa cuando no hay pistas', () => {
    expect(pick('xyz')).toBeNull();
  });
  it('resuelve texto de categoría', () => {
    expect(resolveCategoryText('Universidad - Alimentación', '', null, cats)).toMatchObject({ categoryId: uni.id, subcategoryId: uniAli.id });
    expect(resolveCategoryText('universidad', 'transporte', null, cats)).toMatchObject({ subcategoryId: uniTra.id });
    expect(resolveCategoryText('Suplementos', '', null, cats)).toMatchObject({ categoryId: sup.id });
    expect(resolveCategoryText('Extras', '', null, cats)).toMatchObject({ categoryId: salidas.id, subcategoryId: salExt.id });
    expect(resolveCategoryText('Viajes', '', null, cats)).toBeNull();
  });
});

describe('leer movimientos', () => {
  it('fechas en varios formatos', () => {
    expect(parseDate('03/11/2026')).toBe('2026-11-03');
    expect(parseDate('2026-11-03')).toBe('2026-11-03');
    expect(parseDate('3 nov 2026')).toBe('2026-11-03');
    expect(parseDate('3-11-26')).toBe('2026-11-03');
    expect(parseDate(new Date(Date.UTC(2026, 10, 3)))).toBe('2026-11-03');
    expect(parseDate(46329)).toBe('2026-11-03');
    expect(parseDate('31/02/2026')).toBeNull();
  });
  it('tabla de Excel con encabezados', () => {
    const m = gridToMovements([
      ['Fecha', 'Descripción', 'Categoría', 'Tipo', 'Monto', 'Cuenta'],
      [new Date(Date.UTC(2026, 10, 1)), 'Mesada', 'Papá', 'Ingreso', 260000, 'Bancolombia'],
      ['02/11/2026', 'Almuerzo', 'Universidad - Alimentación', 'Egreso', 18000, 'Efectivo'],
      ['03/11/2026', 'Uber', '', '', -12500, ''],
      [null, 'Total', null, null, 265500, null],
    ]);
    expect(m.map((x) => [x.date, x.description, x.type, x.amount, x.categoryText, x.accountText])).toEqual([
      ['2026-11-01', 'Mesada', 'ingreso', 260000, 'Papá', 'Bancolombia'],
      ['2026-11-02', 'Almuerzo', 'egreso', 18000, 'Universidad - Alimentación', 'Efectivo'],
      ['2026-11-03', 'Uber', 'egreso', 12500, '', ''],
    ]);
  });
  it('columnas separadas de ingreso y gasto (extracto bancario)', () => {
    const m = gridToMovements([
      ['Fecha', 'Detalle', 'Débito', 'Crédito'],
      ['2026-11-01', 'Pago nómina', null, '600.000'],
      ['2026-11-02', 'Compra Éxito', '45.300', null],
    ]);
    expect(m.map((x) => [x.type, x.amount])).toEqual([['ingreso', 600000], ['egreso', 45300]]);
  });
  it('texto pegado o leído de una foto', () => {
    const m = textToMovements('03/11/2026 Almuerzo U 18.000\n2 nov - Uber - 12.500\n1/11 Venta panes +120.000\nGimnasio 120.000', 2026);
    expect(m.map((x) => [x.date, x.description, x.amount, x.type])).toEqual([
      ['2026-11-03', 'Almuerzo U', 18000, null],
      ['2026-11-02', 'Uber', 12500, null],
      ['2026-11-01', 'Venta panes', 120000, 'ingreso'],
    ]);
  });
});

describe('movimientos agrupados por día (como en la app del banco)', () => {
  it('usa la fecha del encabezado para las líneas siguientes', () => {
    const m = textToMovements('Lunes 3 de noviembre\nAlmuerzo U $18.000\nUber 12.500\n02/11/2026\nVenta panes +120.000', 2026);
    expect(m.map((x) => [x.date, x.description, x.amount])).toEqual([
      ['2026-11-03', 'Almuerzo U', 18000],
      ['2026-11-03', 'Uber', 12500],
      ['2026-11-02', 'Venta panes', 120000],
    ]);
  });
});

describe('signo de los valores', () => {
  it('si hay negativos, los positivos sin tipo son ingresos', () => {
    const m = gridToMovements([['Fecha', 'Descripción', 'Monto'], ['2026-11-01', 'Mesada', 260000], ['2026-11-02', 'Almuerzo', -18000]]);
    expect(m.map((x) => x.type)).toEqual(['ingreso', 'egreso']);
  });
  it('si no hay negativos, no se adivina el tipo por el signo', () => {
    const m = gridToMovements([['Fecha', 'Descripción', 'Monto'], ['2026-11-02', 'Almuerzo', 18000]]);
    expect(m[0].type).toBeNull();
  });
});
