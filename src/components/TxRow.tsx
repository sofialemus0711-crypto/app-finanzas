import type { Account, Category, Transaction } from '../db/types';
import { formatMoney } from '../lib/money';
import { navigate } from '../lib/router';
import { Icon } from './Icon';

export function TxRow({ t, accounts, categories }: { t: Transaction; accounts: Map<string, Account>; categories: Map<string, Category> }) {
  const acc = accounts.get(t.accountId)?.name ?? '—';
  let title: string;
  let sub: string;
  let icon: string;
  let kind: 'in' | 'out' | 'tr';
  if (t.type === 'transferencia') {
    const to = t.toAccountId ? (accounts.get(t.toAccountId)?.name ?? '—') : '—';
    title = t.note || `${acc} → ${to}`;
    sub = t.note ? `Transferencia · ${acc} → ${to}` : 'Transferencia · no cuenta como gasto';
    icon = 'transfer';
    kind = 'tr';
  } else {
    const cat = t.categoryId ? categories.get(t.categoryId) : undefined;
    const subc = t.subcategoryId ? categories.get(t.subcategoryId) : undefined;
    const catName = cat?.name ?? 'Sin categoría';
    title = t.note || (subc ? subc.name : catName);
    sub = [catName, subc?.name, acc].filter(Boolean).join(' · ');
    icon = cat?.icon ?? 'dots';
    kind = t.type === 'ingreso' ? 'in' : 'out';
  }
  const amountText = t.type === 'transferencia' ? formatMoney(t.amount) : formatMoney(t.type === 'ingreso' ? t.amount : -t.amount, { sign: true });
  return (
    <button className="list-item" onClick={() => navigate(`/editar?id=${t.id}`)} aria-label={`${title}, ${amountText}. Editar`}>
      <span className={'ico ' + kind}><Icon name={icon} size={20} /></span>
      <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="li-title">{title}</span>
        <span className="li-sub">{sub}</span>
      </span>
      <span className={'li-amount amount-' + kind}>{amountText}</span>
    </button>
  );
}
