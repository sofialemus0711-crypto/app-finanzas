import type { Table } from 'dexie';
import { db } from '../db/db';
import type { Account, Category, Settings, Template, Transaction } from '../db/types';

export interface BackupFile {
  app: 'monedi';
  version: 1;
  exportedAt: string;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  templates: Template[];
  settings: Settings | null;
}

export async function buildBackup(): Promise<BackupFile> {
  const [accounts, categories, transactions, templates, settings] = await Promise.all([
    db.accounts.toArray(),
    db.categories.toArray(),
    db.transactions.toArray(),
    db.templates.toArray(),
    db.settings.get('settings'),
  ]);
  return {
    app: 'monedi',
    version: 1,
    exportedAt: new Date().toISOString(),
    accounts,
    categories,
    transactions,
    templates,
    settings: settings ?? null,
  };
}

export function parseBackup(text: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un respaldo válido de Monedi.');
  }
  const b = data as Partial<BackupFile>;
  if (b?.app !== 'monedi' || b.version !== 1) throw new Error('El archivo no es un respaldo válido de Monedi.');
  for (const key of ['accounts', 'categories', 'transactions', 'templates'] as const) {
    if (!Array.isArray(b[key])) throw new Error(`El respaldo está incompleto (${key}).`);
  }
  return b as BackupFile;
}

/**
 * Restaura un respaldo.
 * mode "replace": borra todo y deja exactamente lo del archivo.
 * mode "merge": agrega lo que no exista (por id) sin tocar lo actual.
 */
export async function restoreBackup(b: BackupFile, mode: 'replace' | 'merge'): Promise<void> {
  await db.transaction('rw', [db.accounts, db.categories, db.transactions, db.templates, db.settings], async () => {
    if (mode === 'replace') {
      await Promise.all([db.accounts.clear(), db.categories.clear(), db.transactions.clear(), db.templates.clear()]);
      await db.accounts.bulkPut(b.accounts);
      await db.categories.bulkPut(b.categories);
      await db.transactions.bulkPut(b.transactions);
      await db.templates.bulkPut(b.templates);
      if (b.settings) await db.settings.put({ ...b.settings, id: 'settings', onboarded: true });
    } else {
      const addMissing = async <T extends { id: string }>(table: Table<T, string>, rows: T[]) => {
        const existing = new Set(await table.toCollection().primaryKeys());
        await table.bulkAdd(rows.filter((r) => !existing.has(r.id)));
      };
      await addMissing(db.accounts, b.accounts);
      await addMissing(db.categories, b.categories);
      await addMissing(db.transactions, b.transactions);
      await addMissing(db.templates, b.templates);
    }
  });
}

/** CSV para abrir en Excel (separador ";" y BOM para que Excel en español lo lea bien). */
export async function buildTransactionsCsv(): Promise<string> {
  const [accounts, categories, txs] = await Promise.all([
    db.accounts.toArray(),
    db.categories.toArray(),
    db.transactions.orderBy('date').toArray(),
  ]);
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = [['Fecha', 'Tipo', 'Valor', 'Cuenta', 'Cuenta destino', 'Categoría', 'Subcategoría', 'Nota']];
  for (const t of txs) {
    rows.push([
      t.date,
      t.type,
      String(t.type === 'egreso' ? -t.amount : t.amount),
      acc.get(t.accountId) ?? '',
      t.toAccountId ? (acc.get(t.toAccountId) ?? '') : '',
      t.categoryId ? (cat.get(t.categoryId) ?? '') : '',
      t.subcategoryId ? (cat.get(t.subcategoryId) ?? '') : '',
      t.note,
    ]);
  }
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
