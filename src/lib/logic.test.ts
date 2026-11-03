import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { computeBalances, myContribution, summarize, totalBalance } from './calc';
import { periodFor } from './period';
import { formatMoney, parseMoney } from './money';
import {
  createAccount,
  createCategory,
  createTransaction,
  deleteAccount,
  deleteCategory,
  deleteTransaction,
  updateTransaction,
} from './repo';
import { buildBackup, parseBackup, restoreBackup } from './backup';

async function setup() {
  const banco = await createAccount({ name: 'Bancolombia', type: 'ahorros', initialBalance: 1_000_000, color: '#0F5E4B', icon: 'bank' });
  const efectivo = await createAccount({ name: 'Efectivo', type: 'efectivo', initialBalance: 50_000, color: '#157347', icon: 'cash' });
  const papa = await createCategory({ name: 'Papá', kind: 'ingreso', parentId: null, icon: 'user', color: '#000', budget: 260_000, coveredByCategoryId: null });
  const uni = await createCategory({ name: 'Universidad', kind: 'egreso', parentId: null, icon: 'grad', color: '#000', budget: 500_000, coveredByCategoryId: papa });
  const uniAli = await createCategory({ name: 'Alimentación', kind: 'egreso', parentId: uni, icon: 'grad', color: '#000', budget: 180_000, coveredByCategoryId: null });
  const gym = await createCategory({ name: 'Gimnasio', kind: 'egreso', parentId: null, icon: 'gym', color: '#000', budget: 120_000, coveredByCategoryId: null });
  return { banco, efectivo, papa, uni, uniAli, gym };
}

async function balances() {
  const accounts = await db.accounts.toArray();
  const txs = await db.transactions.toArray();
  return computeBalances(accounts, txs);
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('dinero', () => {
  it('formatea pesos colombianos', () => {
    expect(formatMoney(18000)).toBe('$ 18.000');
    expect(formatMoney(-2950)).toBe('− $ 2.950');
    expect(formatMoney(1500, { sign: true })).toBe('+ $ 1.500');
    expect(parseMoney('$ 1.250.000')).toBe(1250000);
  });
});

describe('saldos', () => {
  it('ingresos, egresos y transferencias actualizan las cuentas correctas', async () => {
    const s = await setup();
    await createTransaction({ type: 'ingreso', amount: 260_000, accountId: s.banco, categoryId: s.papa, date: '2026-11-01' });
    await createTransaction({ type: 'egreso', amount: 18_000, accountId: s.banco, categoryId: s.uni, subcategoryId: s.uniAli, date: '2026-11-03' });
    await createTransaction({ type: 'transferencia', amount: 100_000, accountId: s.banco, toAccountId: s.efectivo, date: '2026-11-02' });
    const b = await balances();
    expect(b.get(s.banco)).toBe(1_000_000 + 260_000 - 18_000 - 100_000);
    expect(b.get(s.efectivo)).toBe(150_000);
    expect(totalBalance(await db.accounts.toArray(), b)).toBe(1_000_000 + 50_000 + 260_000 - 18_000);
  });

  it('las transferencias no cuentan como ingreso ni egreso', async () => {
    const s = await setup();
    await createTransaction({ type: 'transferencia', amount: 100_000, accountId: s.banco, toAccountId: s.efectivo, date: '2026-11-02' });
    const sum = summarize(await db.transactions.toArray(), '2026-11-01', '2026-11-30');
    expect(sum.income).toBe(0);
    expect(sum.expense).toBe(0);
  });

  it('editar y eliminar recalcula los saldos', async () => {
    const s = await setup();
    const id = await createTransaction({ type: 'egreso', amount: 120_000, accountId: s.banco, categoryId: s.gym, date: '2026-11-01' });
    await updateTransaction(id, { type: 'egreso', amount: 100_000, accountId: s.efectivo, categoryId: s.gym, date: '2026-11-01' });
    let b = await balances();
    expect(b.get(s.banco)).toBe(1_000_000);
    expect(b.get(s.efectivo)).toBe(-50_000);
    await deleteTransaction(id);
    b = await balances();
    expect(b.get(s.efectivo)).toBe(50_000);
  });
});

describe('validaciones', () => {
  it('exige subcategoría cuando la categoría tiene subcategorías', async () => {
    const s = await setup();
    await expect(createTransaction({ type: 'egreso', amount: 1000, accountId: s.banco, categoryId: s.uni, date: '2026-11-01' })).rejects.toThrow(/subcategoría/);
  });
  it('no permite valor cero, ni transferir a la misma cuenta, ni categoría del tipo equivocado', async () => {
    const s = await setup();
    await expect(createTransaction({ type: 'egreso', amount: 0, accountId: s.banco, categoryId: s.gym, date: '2026-11-01' })).rejects.toThrow();
    await expect(createTransaction({ type: 'transferencia', amount: 5, accountId: s.banco, toAccountId: s.banco, date: '2026-11-01' })).rejects.toThrow();
    await expect(createTransaction({ type: 'ingreso', amount: 5, accountId: s.banco, categoryId: s.gym, date: '2026-11-01' })).rejects.toThrow();
  });
  it('no deja borrar una cuenta con movimientos', async () => {
    const s = await setup();
    await createTransaction({ type: 'egreso', amount: 1000, accountId: s.banco, categoryId: s.gym, date: '2026-11-01' });
    await expect(deleteAccount(s.banco)).rejects.toThrow(/archivarla/);
  });
});

describe('categorías', () => {
  it('al eliminar una categoría con movimientos los mueve a otra', async () => {
    const s = await setup();
    await createTransaction({ type: 'egreso', amount: 18_000, accountId: s.banco, categoryId: s.uni, subcategoryId: s.uniAli, date: '2026-11-03' });
    await expect(deleteCategory(s.uni, null)).rejects.toThrow();
    await deleteCategory(s.uni, s.gym);
    const txs = await db.transactions.toArray();
    expect(txs[0].categoryId).toBe(s.gym);
    expect(txs[0].subcategoryId).toBeNull();
    expect(await db.categories.get(s.uniAli)).toBeUndefined();
  });
  it('"Mi aporte" excluye los gastos cubiertos por otro ingreso', async () => {
    const s = await setup();
    await createTransaction({ type: 'egreso', amount: 18_000, accountId: s.banco, categoryId: s.uni, subcategoryId: s.uniAli, date: '2026-11-03' });
    await createTransaction({ type: 'egreso', amount: 120_000, accountId: s.banco, categoryId: s.gym, date: '2026-11-03' });
    const sum = summarize(await db.transactions.toArray(), '2026-11-01', '2026-11-30');
    expect(myContribution(sum, await db.categories.toArray())).toEqual({ covered: 18_000, mine: 120_000 });
  });
});

describe('periodos', () => {
  it('mes calendario', () => {
    expect(periodFor('2026-11-03', 1)).toMatchObject({ start: '2026-11-01', end: '2026-11-30', label: 'Noviembre de 2026' });
    expect(periodFor('2026-01-10', 1, -1)).toMatchObject({ start: '2025-12-01', end: '2025-12-31' });
  });
  it('periodo que empieza el día 15', () => {
    expect(periodFor('2026-11-03', 15)).toMatchObject({ start: '2026-10-15', end: '2026-11-14' });
    expect(periodFor('2026-11-20', 15)).toMatchObject({ start: '2026-11-15', end: '2026-12-14' });
  });
  it('día 31 en meses cortos', () => {
    expect(periodFor('2026-02-28', 31)).toMatchObject({ start: '2026-02-28', end: '2026-03-30' });
  });
});

describe('respaldo', () => {
  it('exporta y restaura todo', async () => {
    const s = await setup();
    await createTransaction({ type: 'egreso', amount: 120_000, accountId: s.banco, categoryId: s.gym, date: '2026-11-03' });
    const text = JSON.stringify(await buildBackup());
    await db.delete();
    await db.open();
    await restoreBackup(parseBackup(text), 'replace');
    expect(await db.transactions.count()).toBe(1);
    expect(await db.categories.count()).toBe(4);
    expect(() => parseBackup('{"hola":1}')).toThrow();
  });
});

import { importCategories } from './repo';
import { gridToStreams, guessIcon, parseStreams } from './importParse';

describe('importar categorías', () => {
  it('crea categorías, subcategorías y presupuestos sin duplicar', async () => {
    await createCategory({ name: 'gimnasio', kind: 'egreso', parentId: null, icon: 'gym', color: '#000', budget: 0, coveredByCategoryId: null });
    const { rows } = parseStreams(gridToStreams([
      ['Categoría', 'Valor', null, 'Ingresos', 'Valor'],
      ['Gimnasio', 120000, null, 'Papá', 260000],
      ['Universidad - Alimentación', 180000, null, null, null],
      ['Universidad - Transporte', 280000, null, null, null],
    ]));
    const r1 = await importCategories(rows, { updateBudgets: true, guessIcon });
    expect(r1).toEqual({ created: 4, updated: 1 });
    const cats = await db.categories.toArray();
    const uni = cats.find((c) => c.name === 'Universidad')!;
    expect(uni.budget).toBe(460000);
    expect(uni.icon).toBe('grad');
    expect(cats.find((c) => c.name === 'gimnasio')!.budget).toBe(120000);
    // Importar de nuevo no duplica nada
    const r2 = await importCategories(rows, { updateBudgets: true, guessIcon });
    expect(r2).toEqual({ created: 0, updated: 0 });
    expect(await db.categories.count()).toBe(5);
  });
});
