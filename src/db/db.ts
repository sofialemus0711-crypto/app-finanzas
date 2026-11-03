import Dexie, { type Table } from 'dexie';
import type { Account, Category, Settings, Template, Transaction } from './types';

/**
 * Base de datos local (IndexedDB) del dispositivo.
 * Es "local primero": todo se guarda aquí al instante, con o sin internet.
 * La sincronización con la nube se agrega encima de esta capa.
 */
export class MonediDB extends Dexie {
  accounts!: Table<Account, string>;
  categories!: Table<Category, string>;
  transactions!: Table<Transaction, string>;
  templates!: Table<Template, string>;
  settings!: Table<Settings, string>;

  constructor(name = 'monedi') {
    super(name);
    this.version(1).stores({
      accounts: 'id, order, archived',
      categories: 'id, kind, parentId, order',
      transactions: 'id, date, type, accountId, toAccountId, categoryId, subcategoryId, [date+createdAt]',
      templates: 'id, order',
      settings: 'id',
    });
  }
}

export const db = new MonediDB();

export function newId(): string {
  return crypto.randomUUID();
}
