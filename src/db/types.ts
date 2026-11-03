/** Montos: siempre enteros en pesos (COP). Nunca decimales. */
export type Money = number;

export type TxType = 'ingreso' | 'egreso' | 'transferencia';
export type CategoryKind = 'ingreso' | 'egreso';

export type AccountType =
  | 'ahorros'
  | 'corriente'
  | 'billetera'
  | 'efectivo'
  | 'credito'
  | 'inversion'
  | 'otra';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /** Saldo con el que empezó a registrarse la cuenta. El saldo actual se calcula. */
  initialBalance: Money;
  color: string;
  icon: string;
  archived: boolean;
  order: number;
  currency: 'COP';
  createdAt: number;
  updatedAt: number;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  /** null = categoría principal; si tiene valor, es subcategoría de esa categoría. */
  parentId: string | null;
  icon: string;
  color: string;
  /** Presupuesto mensual (egresos) o valor esperado (ingresos). 0 = sin presupuesto. */
  budget: Money;
  /** Para egresos: id de la categoría de ingreso que lo financia (p. ej. Universidad ← Papá). */
  coveredByCategoryId: string | null;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface Transaction {
  id: string;
  type: TxType;
  amount: Money;
  /** Cuenta de donde sale (egreso/transferencia) o a donde entra (ingreso). */
  accountId: string;
  /** Solo transferencias: cuenta destino. */
  toAccountId: string | null;
  /** Categoría principal (null en transferencias). */
  categoryId: string | null;
  subcategoryId: string | null;
  /** Fecha del movimiento, formato YYYY-MM-DD (hora local). */
  date: string;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface Template {
  id: string;
  name: string;
  type: Exclude<TxType, 'transferencia'>;
  amount: Money;
  accountId: string;
  categoryId: string;
  subcategoryId: string | null;
  note: string;
  order: number;
  createdAt: number;
}

export interface Settings {
  id: 'settings';
  userName: string;
  /** Día del mes en que empieza el periodo financiero (1 = mes calendario). */
  periodStartDay: number;
  theme: 'system' | 'light' | 'dark';
  hideBalances: boolean;
  lastAccountId: string | null;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  userName: '',
  periodStartDay: 1,
  theme: 'system',
  hideBalances: false,
  lastAccountId: null,
  onboarded: false,
};
