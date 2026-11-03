import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../db/db';
import { DEFAULT_SETTINGS, type Account, type Category, type Settings, type Template, type Transaction } from '../db/types';
import { computeBalances } from './calc';

/** Todas estas consultas se actualizan solas cuando cambian los datos. */

export function useSettings(): Settings | undefined {
  return useLiveQuery(async () => (await db.settings.get('settings')) ?? DEFAULT_SETTINGS);
}

export function useAccounts(): Account[] | undefined {
  return useLiveQuery(() => db.accounts.orderBy('order').toArray());
}

export function useCategories(): Category[] | undefined {
  return useLiveQuery(() => db.categories.orderBy('order').toArray());
}

export function useTransactions(): Transaction[] | undefined {
  return useLiveQuery(() => db.transactions.orderBy('[date+createdAt]').reverse().toArray());
}

export function useTemplates(): Template[] | undefined {
  return useLiveQuery(() => db.templates.orderBy('order').toArray());
}

export function useBalances(accounts?: Account[], txs?: Transaction[]): Map<string, number> | undefined {
  return useMemo(() => (accounts && txs ? computeBalances(accounts, txs) : undefined), [accounts, txs]);
}

export interface CategoryTree {
  byId: Map<string, Category>;
  roots: (kind: 'ingreso' | 'egreso') => Category[];
  children: (parentId: string) => Category[];
}

export function useCategoryTree(categories?: Category[]): CategoryTree | undefined {
  return useMemo(() => {
    if (!categories) return undefined;
    const byId = new Map(categories.map((c) => [c.id, c]));
    return {
      byId,
      roots: (kind) => categories.filter((c) => c.kind === kind && c.parentId === null),
      children: (parentId) => categories.filter((c) => c.parentId === parentId),
    };
  }, [categories]);
}
