import { db, newId } from '../db/db';
import {
  DEFAULT_SETTINGS,
  type Account,
  type Category,
  type Settings,
  type Template,
  type Transaction,
  type TxType,
} from '../db/types';

/* ------------------------------ Ajustes ------------------------------ */

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get('settings')) ?? DEFAULT_SETTINGS;
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<void> {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, id: 'settings' });
}

/* ------------------------------ Cuentas ------------------------------ */

export type AccountInput = Pick<Account, 'name' | 'type' | 'initialBalance' | 'color' | 'icon'>;

export async function createAccount(input: AccountInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('La cuenta necesita un nombre.');
  const now = Date.now();
  const order = await db.accounts.count();
  const id = newId();
  await db.accounts.add({
    ...input,
    name,
    initialBalance: Math.round(input.initialBalance) || 0,
    id,
    archived: false,
    order,
    currency: 'COP',
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function updateAccount(id: string, patch: Partial<AccountInput & { archived: boolean }>): Promise<void> {
  if (patch.name !== undefined && !patch.name.trim()) throw new Error('La cuenta necesita un nombre.');
  await db.accounts.update(id, {
    ...patch,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.initialBalance !== undefined ? { initialBalance: Math.round(patch.initialBalance) || 0 } : {}),
    updatedAt: Date.now(),
  });
}

export async function countAccountTransactions(id: string): Promise<number> {
  const a = await db.transactions.where('accountId').equals(id).count();
  const b = await db.transactions.where('toAccountId').equals(id).count();
  return a + b;
}

/** Solo se puede eliminar una cuenta sin movimientos; si tiene, se archiva. */
export async function deleteAccount(id: string): Promise<void> {
  if ((await countAccountTransactions(id)) > 0) {
    throw new Error('Esta cuenta tiene movimientos. Puedes archivarla para conservar el historial.');
  }
  await db.transaction('rw', db.accounts, db.templates, async () => {
    await db.accounts.delete(id);
    await db.templates.filter((t) => t.accountId === id).delete();
  });
}

/* ----------------------------- Categorías ---------------------------- */

export type CategoryInput = Pick<Category, 'name' | 'kind' | 'parentId' | 'icon' | 'color' | 'budget' | 'coveredByCategoryId'>;

export async function createCategory(input: CategoryInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('La categoría necesita un nombre.');
  const now = Date.now();
  const siblings = await db.categories.filter((c) => c.parentId === input.parentId && c.kind === input.kind).count();
  const id = newId();
  await db.categories.add({
    ...input,
    name,
    budget: Math.max(0, Math.round(input.budget) || 0),
    id,
    order: siblings,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function updateCategory(id: string, patch: Partial<CategoryInput>): Promise<void> {
  if (patch.name !== undefined && !patch.name.trim()) throw new Error('La categoría necesita un nombre.');
  await db.categories.update(id, {
    ...patch,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.budget !== undefined ? { budget: Math.max(0, Math.round(patch.budget) || 0) } : {}),
    updatedAt: Date.now(),
  });
}

/** Movimientos que usan la categoría (o, si es principal, cualquiera de sus subcategorías). */
export async function countCategoryTransactions(id: string): Promise<number> {
  const a = await db.transactions.where('categoryId').equals(id).count();
  const b = await db.transactions.where('subcategoryId').equals(id).count();
  return a + b;
}

/**
 * Elimina una categoría (y sus subcategorías).
 * Si tiene movimientos, deben moverse a `reassignTo` (otra categoría del mismo tipo).
 * Si se elimina una subcategoría, sus movimientos quedan en la categoría principal
 * o pasan a `reassignTo` si se indica (que debe ser una subcategoría hermana).
 */
export async function deleteCategory(id: string, reassignTo: string | null): Promise<void> {
  await db.transaction('rw', db.categories, db.transactions, db.templates, async () => {
    const cat = await db.categories.get(id);
    if (!cat) return;
    const now = Date.now();

    if (cat.parentId) {
      // Subcategoría
      const txs = await db.transactions.where('subcategoryId').equals(id).toArray();
      for (const t of txs) {
        await db.transactions.update(t.id, { subcategoryId: reassignTo, updatedAt: now });
      }
      await db.templates.filter((t) => t.subcategoryId === id).modify({ subcategoryId: reassignTo });
      await db.categories.delete(id);
      return;
    }

    const used = await db.transactions.where('categoryId').equals(id).count();
    if (used > 0) {
      if (!reassignTo) throw new Error('Elige a qué categoría mover sus movimientos.');
      const target = await db.categories.get(reassignTo);
      if (!target || target.kind !== cat.kind || target.parentId !== null || target.id === id) {
        throw new Error('La categoría destino no es válida.');
      }
      await db.transactions
        .where('categoryId')
        .equals(id)
        .modify({ categoryId: reassignTo, subcategoryId: null, updatedAt: now });
    }
    const subIds = (await db.categories.where('parentId').equals(id).toArray()).map((c) => c.id);
    await db.templates.filter((t) => t.categoryId === id).delete();
    await db.categories.bulkDelete([id, ...subIds]);
    await db.categories.filter((c) => c.coveredByCategoryId === id).modify({ coveredByCategoryId: null });
  });
}

/* ----------------------------- Movimientos --------------------------- */

export interface TxInput {
  type: TxType;
  amount: number;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
  date: string;
  note?: string;
}

async function validateTx(input: TxInput): Promise<Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>> {
  const amount = Math.round(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Escribe un valor mayor que cero.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('La fecha no es válida.');
  const account = await db.accounts.get(input.accountId);
  if (!account) throw new Error('Elige una cuenta.');

  if (input.type === 'transferencia') {
    if (!input.toAccountId) throw new Error('Elige la cuenta destino.');
    if (input.toAccountId === input.accountId) throw new Error('La cuenta origen y destino deben ser distintas.');
    if (!(await db.accounts.get(input.toAccountId))) throw new Error('La cuenta destino no existe.');
    return {
      type: 'transferencia',
      amount,
      accountId: input.accountId,
      toAccountId: input.toAccountId,
      categoryId: null,
      subcategoryId: null,
      date: input.date,
      note: (input.note ?? '').trim(),
    };
  }

  if (!input.categoryId) throw new Error('Elige una categoría.');
  const cat = await db.categories.get(input.categoryId);
  if (!cat || cat.parentId !== null || cat.kind !== input.type) throw new Error('La categoría no es válida.');
  const subs = await db.categories.where('parentId').equals(cat.id).count();
  let subcategoryId: string | null = null;
  if (subs > 0) {
    if (!input.subcategoryId) throw new Error(`Elige una subcategoría de ${cat.name}.`);
    const sub = await db.categories.get(input.subcategoryId);
    if (!sub || sub.parentId !== cat.id) throw new Error('La subcategoría no es válida.');
    subcategoryId = sub.id;
  }
  return {
    type: input.type,
    amount,
    accountId: input.accountId,
    toAccountId: null,
    categoryId: cat.id,
    subcategoryId,
    date: input.date,
    note: (input.note ?? '').trim(),
  };
}

export async function createTransaction(input: TxInput): Promise<string> {
  const data = await validateTx(input);
  const now = Date.now();
  const id = newId();
  await db.transactions.add({ ...data, id, createdAt: now, updatedAt: now });
  await updateSettings({ lastAccountId: data.accountId });
  return id;
}

export async function updateTransaction(id: string, input: TxInput): Promise<void> {
  const data = await validateTx(input);
  await db.transactions.update(id, { ...data, updatedAt: Date.now() });
}

export async function deleteTransaction(id: string): Promise<void> {
  await db.transactions.delete(id);
}

/* ------------------------------ Favoritos ---------------------------- */

export type TemplateInput = Omit<Template, 'id' | 'order' | 'createdAt'>;

export async function createTemplate(input: TemplateInput): Promise<string> {
  if (!input.name.trim()) throw new Error('El favorito necesita un nombre.');
  if (!(input.amount > 0)) throw new Error('Escribe un valor mayor que cero.');
  const id = newId();
  await db.templates.add({
    ...input,
    name: input.name.trim(),
    amount: Math.round(input.amount),
    id,
    order: await db.templates.count(),
    createdAt: Date.now(),
  });
  return id;
}

export async function deleteTemplate(id: string): Promise<void> {
  await db.templates.delete(id);
}
