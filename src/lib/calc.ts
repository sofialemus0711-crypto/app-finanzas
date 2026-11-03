import type { Account, Category, Transaction } from '../db/types';

/**
 * Saldo actual de cada cuenta = saldo inicial + ingresos − egresos ± transferencias.
 * Se calcula siempre desde los movimientos: editar o borrar uno nunca descuadra nada.
 */
export function computeBalances(accounts: Account[], txs: Transaction[]): Map<string, number> {
  const balances = new Map<string, number>();
  for (const a of accounts) balances.set(a.id, a.initialBalance);
  const add = (id: string | null, v: number) => {
    if (id && balances.has(id)) balances.set(id, (balances.get(id) ?? 0) + v);
  };
  for (const t of txs) {
    if (t.type === 'ingreso') add(t.accountId, t.amount);
    else if (t.type === 'egreso') add(t.accountId, -t.amount);
    else {
      add(t.accountId, -t.amount);
      add(t.toAccountId, t.amount);
    }
  }
  return balances;
}

export function totalBalance(accounts: Account[], balances: Map<string, number>): number {
  return accounts.reduce((sum, a) => sum + (balances.get(a.id) ?? 0), 0);
}

export interface PeriodSummary {
  income: number;
  expense: number;
  balance: number;
  /** % de los ingresos que se gastó (null si no hubo ingresos) */
  spentPct: number | null;
  /** gasto por categoría principal */
  byCategory: Map<string, number>;
  /** gasto por subcategoría */
  bySubcategory: Map<string, number>;
  /** ingreso por categoría */
  incomeByCategory: Map<string, number>;
}

export function inRange(t: Transaction, start: string, end: string): boolean {
  return t.date >= start && t.date <= end;
}

/** Totales de un periodo. Las transferencias NO cuentan como ingreso ni egreso. */
export function summarize(txs: Transaction[], start: string, end: string): PeriodSummary {
  let income = 0;
  let expense = 0;
  const byCategory = new Map<string, number>();
  const bySubcategory = new Map<string, number>();
  const incomeByCategory = new Map<string, number>();
  for (const t of txs) {
    if (!inRange(t, start, end)) continue;
    if (t.type === 'ingreso') {
      income += t.amount;
      if (t.categoryId) incomeByCategory.set(t.categoryId, (incomeByCategory.get(t.categoryId) ?? 0) + t.amount);
    } else if (t.type === 'egreso') {
      expense += t.amount;
      if (t.categoryId) byCategory.set(t.categoryId, (byCategory.get(t.categoryId) ?? 0) + t.amount);
      if (t.subcategoryId) bySubcategory.set(t.subcategoryId, (bySubcategory.get(t.subcategoryId) ?? 0) + t.amount);
    }
  }
  return {
    income,
    expense,
    balance: income - expense,
    spentPct: income > 0 ? Math.round((expense / income) * 100) : null,
    byCategory,
    bySubcategory,
    incomeByCategory,
  };
}

/** "Mi aporte": gastos totales menos los gastos de categorías cubiertas por otro ingreso. */
export function myContribution(summary: PeriodSummary, categories: Category[]): { covered: number; mine: number } {
  let covered = 0;
  for (const c of categories) {
    if (c.kind === 'egreso' && c.parentId === null && c.coveredByCategoryId) {
      covered += summary.byCategory.get(c.id) ?? 0;
    }
  }
  return { covered, mine: summary.expense - covered };
}
