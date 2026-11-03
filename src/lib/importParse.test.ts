import { describe, expect, it } from 'vitest';
import { gridToStreams, guessIcon, parseAmount, parseStreams, splitName, textToStreams } from './importParse';

describe('lectura de valores', () => {
  it('entiende formatos colombianos y de Excel', () => {
    expect(parseAmount('120,000')).toBe(120000);
    expect(parseAmount('$ 1.300.000')).toBe(1300000);
    expect(parseAmount('540,000.00')).toBe(540000);
    expect(parseAmount(2340000)).toBe(2340000);
    expect(parseAmount('Gimnasio')).toBeNull();
  });
  it('separa categoría y subcategoría', () => {
    expect(splitName('Salidas - Alimentación')).toEqual(['Salidas', 'Alimentación']);
    expect(splitName('Universidad - Gastos extra')).toEqual(['Universidad', 'Gastos extra']);
    expect(splitName('Gimnasio')).toEqual(['Gimnasio', '']);
  });
});

describe('hoja de Excel con dos tablas lado a lado', () => {
  const grid = [
    [null, null, null, null, null],
    ['Categoría', 'Valor', null, 'Ingresos', 'Columna2'],
    ['Gimnasio', 120000, null, 'Trabajo mamá', 600000],
    ['Boxeo', null, null, 'Panes', 1300000],
    ['Salidas - Alimentación', 100000, null, 'Eliani', null],
    ['Salidas - Transporte', 160000, null, 'Papa', 260000],
    ['Universidad - Alimentación', 180000, null, 'Sostenimiento Sapiencia', 180000],
    ['Insumos panes', 540000, null, 'Total', 2340000],
    ['Total', 1920000, null, null, null],
    ['Total mi aporte', 1420000, null, null, null],
  ];
  const { rows } = parseStreams(gridToStreams(grid));
  it('detecta egresos e ingresos por separado', () => {
    const egresos = rows.filter((r) => r.kind === 'egreso');
    const ingresos = rows.filter((r) => r.kind === 'ingreso');
    expect(egresos.map((r) => [r.category, r.subcategory, r.amount])).toEqual([
      ['Gimnasio', '', 120000],
      ['Boxeo', '', 0],
      ['Salidas', 'Alimentación', 100000],
      ['Salidas', 'Transporte', 160000],
      ['Universidad', 'Alimentación', 180000],
      ['Insumos panes', '', 540000],
    ]);
    expect(ingresos.map((r) => [r.category, r.amount])).toEqual([
      ['Trabajo mamá', 600000],
      ['Panes', 1300000],
      ['Eliani', 0],
      ['Papa', 260000],
      ['Sostenimiento Sapiencia', 180000],
    ]);
  });
});

describe('texto pegado o leído de una foto', () => {
  it('líneas con nombre y valor', () => {
    const { rows } = parseStreams(textToStreams('Categoría Valor\nGimnasio 120,000\nSalidas - Extras 100,000\nTotal 1,920,000\nIngresos\nPanes 1,300,000'));
    expect(rows.map((r) => [r.kind, r.category, r.subcategory, r.amount])).toEqual([
      ['egreso', 'Gimnasio', '', 120000],
      ['egreso', 'Salidas', 'Extras', 100000],
      ['ingreso', 'Panes', '', 1300000],
    ]);
  });
  it('texto copiado de Excel (con tabulaciones)', () => {
    const { rows } = parseStreams(textToStreams('Gimnasio\t120000\nSuplementos\t200000'));
    expect(rows).toHaveLength(2);
  });
  it('omite filas que parecen movimientos con fecha', () => {
    const r = parseStreams(textToStreams('Gimnasio\t120000\n2026-11-01\tAlmuerzo\t18000'));
    expect(r.rows).toHaveLength(1);
    expect(r.skippedMovements).toBe(1);
  });
  it('sugiere íconos', () => {
    expect(guessIcon('Gimnasio', 'egreso')).toBe('gym');
    expect(guessIcon('Sostenimiento Sapiencia', 'ingreso')).toBe('book');
  });
});

import { wordsToStreams, type OcrWord } from './importParse';

describe('tabla reconstruida desde una foto', () => {
  // Simula palabras leídas de una captura de Excel con dos tablas lado a lado
  const W = (text: string, x: number, y: number): OcrWord => ({ text, confidence: 90, bbox: { x0: x, y0: y, x1: x + text.length * 9, y1: y + 18 } });
  const words: OcrWord[] = [
    W('A', 220, 10), W('B', 400, 10), W('D', 640, 10),
    W('2', 30, 60), W('Categoría', 110, 60), W('Valor', 350, 60), W('Ingresos', 540, 60), W('Columna2', 750, 60),
    W('3', 30, 90), W('Gimnasio', 110, 90), W('120,000', 380, 90), W('Trabajo', 540, 90), W('mamá', 612, 90), W('600,000', 770, 90),
    W('4', 30, 120), W('Boxeo', 110, 120), W('Panes', 540, 120), W('1,300,000', 750, 120),
    W('5', 30, 150), W('Salidas', 110, 150), W('-', 178, 150), W('Alimentación', 194, 150), W('100,000', 380, 150),
    W('14', 30, 180), W('Total', 110, 180), W('1,920,000', 362, 180), W('Total', 540, 180), W('2,340,000', 750, 180),
  ];
  it('separa las dos tablas y une cada nombre con su valor', () => {
    const { rows } = parseStreams(wordsToStreams(words));
    expect(rows.map((r) => [r.kind, r.category, r.subcategory, r.amount])).toEqual([
      ['egreso', 'Gimnasio', '', 120000],
      ['egreso', 'Boxeo', '', 0],
      ['egreso', 'Salidas', 'Alimentación', 100000],
      ['ingreso', 'Trabajo mamá', '', 600000],
      ['ingreso', 'Panes', '', 1300000],
    ]);
  });
});
