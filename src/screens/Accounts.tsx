import { useState } from 'react';
import type { Account, AccountType } from '../db/types';
import { Icon, PICKABLE_COLORS } from '../components/Icon';
import { ConfirmButton, MoneyInput, Sheet, useToast } from '../components/ui';
import { totalBalance } from '../lib/calc';
import { useAccounts, useBalances, useSettings, useTransactions } from '../lib/hooks';
import { formatMoney } from '../lib/money';
import { countAccountTransactions, createAccount, deleteAccount, updateAccount } from '../lib/repo';
import { navigate } from '../lib/router';

export const ACCOUNT_TYPES: { value: AccountType; label: string; icon: string }[] = [
  { value: 'ahorros', label: 'Cuenta de ahorros', icon: 'bank' },
  { value: 'corriente', label: 'Cuenta corriente', icon: 'bank' },
  { value: 'billetera', label: 'Billetera digital', icon: 'phone' },
  { value: 'efectivo', label: 'Efectivo', icon: 'cash' },
  { value: 'credito', label: 'Tarjeta de crédito', icon: 'card' },
  { value: 'inversion', label: 'Inversión', icon: 'chart' },
  { value: 'otra', label: 'Otra', icon: 'wallet' },
];
export const typeLabel = (t: AccountType) => ACCOUNT_TYPES.find((x) => x.value === t)?.label ?? t;

export function Accounts() {
  const settings = useSettings();
  const accounts = useAccounts();
  const txs = useTransactions();
  const balances = useBalances(accounts, txs);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  if (!accounts || !balances) return null;
  const hidden = settings?.hideBalances;
  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);

  return (
    <div className="container">
      <div className="between">
        <h1 className="h1">Cuentas</h1>
        <button className="icon-btn" style={{ background: 'var(--primary)', color: 'var(--on-primary)', border: 'none' }} aria-label="Agregar cuenta" onClick={() => setEditing('new')}>
          <Icon name="plus" size={22} stroke={2.2} />
        </button>
      </div>

      <div className="card">
        <div className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Total en todas tus cuentas</div>
        <div className="big">{formatMoney(totalBalance(accounts, balances), { hidden })}</div>
      </div>

      <div className="grid-auto">
        {active.map((a) => <AccountCard key={a.id} a={a} balance={balances.get(a.id) ?? 0} hidden={hidden} onEdit={() => setEditing(a)} />)}
      </div>

      {active.length >= 2 && (
        <button className="btn block" style={{ borderColor: 'var(--primary)', color: 'var(--primary)', borderWidth: 2 }} onClick={() => navigate('/nuevo?tipo=transferencia')}>
          <Icon name="transfer" size={20} /> Transferir entre mis cuentas
        </button>
      )}
      <button className="btn block ghost" style={{ border: '1px dashed var(--border)' }} onClick={() => setEditing('new')}>+ Agregar banco o billetera</button>

      {archived.length > 0 && (
        <>
          <button className="btn ghost between" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
            <span className="muted">Cuentas archivadas ({archived.length})</span>
            <Icon name={showArchived ? 'down' : 'chevron'} size={18} />
          </button>
          {showArchived && (
            <div className="grid-auto">
              {archived.map((a) => <AccountCard key={a.id} a={a} balance={balances.get(a.id) ?? 0} hidden={hidden} onEdit={() => setEditing(a)} />)}
            </div>
          )}
        </>
      )}

      {editing && <AccountForm account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AccountCard({ a, balance, hidden, onEdit }: { a: Account; balance: number; hidden?: boolean; onEdit: () => void }) {
  return (
    <div className="card stack" style={{ opacity: a.archived ? 0.7 : 1 }}>
      <div className="row">
        <span className="ico" style={{ background: 'var(--surface-2)', color: a.color, width: 48, height: 48, borderRadius: 14 }}><Icon name={a.icon} size={24} /></span>
        <div className="grow">
          <div style={{ fontSize: 16, fontWeight: 700 }}>{a.name}</div>
          <div className="small muted">{typeLabel(a.type)}{a.archived ? ' · archivada' : ''}</div>
        </div>
        <button className="icon-btn" style={{ borderRadius: 12 }} aria-label={`Editar ${a.name}`} onClick={onEdit}><Icon name="edit" size={18} /></button>
      </div>
      <div className="between" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="small muted">Saldo actual</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: balance < 0 ? 'var(--expense)' : undefined }}>{formatMoney(balance, { hidden })}</div>
        </div>
        <div className="small muted" style={{ textAlign: 'right' }}>Saldo inicial<br />{formatMoney(a.initialBalance, { hidden })}</div>
      </div>
    </div>
  );
}

export function AccountForm({ account, onClose, onSaved, preset }: { account: Account | null; onClose: () => void; onSaved?: () => void; preset?: { name: string; type: AccountType } }) {
  const toast = useToast();
  const [name, setName] = useState(account?.name ?? preset?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? preset?.type ?? 'ahorros');
  const [initial, setInitial] = useState(account?.initialBalance ?? 0);
  const [color, setColor] = useState(account?.color ?? PICKABLE_COLORS[0]);
  const [error, setError] = useState('');

  async function save() {
    setError('');
    const icon = ACCOUNT_TYPES.find((t) => t.value === type)?.icon ?? 'bank';
    try {
      if (account) await updateAccount(account.id, { name, type, initialBalance: initial, color, icon });
      else await createAccount({ name, type, initialBalance: initial, color, icon });
      toast(account ? 'Cuenta actualizada' : 'Cuenta creada');
      onSaved?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove() {
    if (!account) return;
    try {
      if ((await countAccountTransactions(account.id)) > 0) {
        await updateAccount(account.id, { archived: true });
        toast('Cuenta archivada (tenía movimientos)');
      } else {
        await deleteAccount(account.id);
        toast('Cuenta eliminada');
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Sheet title={account ? 'Editar cuenta' : 'Nueva cuenta'} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="field"><span>Nombre</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Bancolombia, Nequi, Efectivo" autoFocus={!account} maxLength={40} />
        </label>
        <label className="field"><span>Tipo de cuenta</span>
          <select className="select" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <MoneyInput label={type === 'credito' ? 'Saldo inicial (deuda en negativo)' : 'Saldo inicial'} value={initial} onChange={setInitial} allowNegative />
        <div className="field"><span>Color</span>
          <div className="swatches">
            {PICKABLE_COLORS.map((c) => (
              <button type="button" key={c} className={'swatch' + (c === color ? ' on' : '')} style={{ background: c }} aria-label={`Color ${c}`} aria-pressed={c === color} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        {error && <p role="alert" className="amount-out" style={{ margin: 0, fontWeight: 600 }}>{error}</p>}
        <button className="btn primary lg block" type="submit">Guardar</button>
        {account && (
          <>
            <button type="button" className="btn block" onClick={async () => { await updateAccount(account.id, { archived: !account.archived }); toast(account.archived ? 'Cuenta restaurada' : 'Cuenta archivada'); onClose(); }}>
              <Icon name="archive" size={18} /> {account.archived ? 'Restaurar cuenta' : 'Archivar (conserva el historial)'}
            </button>
            <ConfirmButton label="Eliminar cuenta" confirmLabel="Toca otra vez para confirmar" onConfirm={remove} />
          </>
        )}
      </form>
    </Sheet>
  );
}
