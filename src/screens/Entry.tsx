import { useEffect, useMemo, useState } from 'react';
import { db } from '../db/db';
import type { Transaction, TxType } from '../db/types';
import { Icon } from '../components/Icon';
import { ConfirmButton, Sheet, useToast } from '../components/ui';
import { summarize } from '../lib/calc';
import { buildIndex, suggest } from '../lib/classify';
import { friendlyDay, today } from '../lib/dates';
import { useAccounts, useBalances, useCategories, useCategoryTree, useSettings, useTemplates, useTransactions } from '../lib/hooks';
import { formatMoney } from '../lib/money';
import { periodFor } from '../lib/period';
import { createTransaction, deleteTransaction, updateTransaction } from '../lib/repo';
import { goBack, navigate } from '../lib/router';

const TYPE_LABEL: Record<TxType, string> = { egreso: 'Egreso', ingreso: 'Ingreso', transferencia: 'Transferir' };
const TYPE_SUB: Record<TxType, string> = { egreso: 'Gasto', ingreso: 'Ingreso', transferencia: 'Entre mis cuentas' };
const TYPE_CLASS: Record<TxType, string> = { egreso: 'amount-out', ingreso: 'amount-in', transferencia: 'amount-tr' };

interface Props {
  initialType?: TxType;
  editId?: string | null;
}

export function Entry({ initialType = 'egreso', editId = null }: Props) {
  const toast = useToast();
  const settings = useSettings();
  const accountsAll = useAccounts();
  const categories = useCategories();
  const tree = useCategoryTree(categories);
  const templates = useTemplates();
  const txs = useTransactions();
  const balances = useBalances(accountsAll, txs);
  const accounts = useMemo(() => accountsAll?.filter((a) => !a.archived) ?? [], [accountsAll]);

  const [loaded, setLoaded] = useState(!editId);
  const [step, setStep] = useState<1 | 2>(1);
  const [type, setType] = useState<TxType>(initialType);
  const [digits, setDigits] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [pickAccount, setPickAccount] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Cargar movimiento a editar
  useEffect(() => {
    if (!editId) return;
    db.transactions.get(editId).then((t?: Transaction) => {
      if (!t) {
        navigate('/historial', { replace: true });
        return;
      }
      setType(t.type);
      setDigits(String(t.amount));
      setAccountId(t.accountId);
      setToAccountId(t.toAccountId);
      setCategoryId(t.categoryId);
      setSubcategoryId(t.subcategoryId);
      setDate(t.date);
      setNote(t.note);
      setShowNote(!!t.note);
      setLoaded(true);
    });
  }, [editId]);

  // Cuenta por defecto: la última usada
  useEffect(() => {
    if (accountId || !settings || accounts.length === 0 || editId) return;
    const last = accounts.find((a) => a.id === settings.lastAccountId);
    setAccountId((last ?? accounts[0]).id);
  }, [accountId, settings, accounts, editId]);

  const amount = parseInt(digits || '0', 10);
  const index = useMemo(() => (categories && txs ? buildIndex(categories, txs) : null), [categories, txs]);
  const [suggested, setSuggested] = useState(false);

  /** Pasa a elegir categoría; si escribiste una nota, preselecciona la categoría que corresponde. */
  function goStep2() {
    if (amount <= 0) return;
    if (type !== 'transferencia' && !categoryId && note.trim() && index) {
      const s = suggest(note, type, index);
      if (s) {
        setCategoryId(s.categoryId);
        setSubcategoryId(s.subcategoryId);
        setSuggested(true);
      }
    }
    setStep(2);
  }

  // Teclado físico (computador)
  useEffect(() => {
    if (step !== 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('⌫');
      else if (e.key === 'Enter' && amount > 0) goStep2();
      else if (e.key === 'Escape') goBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function press(k: string) {
    setDigits((v) => {
      if (k === '⌫') return v.slice(0, -1);
      if (v.length >= 11) return v;
      return (v + k).replace(/^0+/, '');
    });
  }

  function changeType(t: TxType) {
    setType(t);
    setCategoryId(null);
    setSubcategoryId(null);
    setError('');
  }

  const roots = tree && type !== 'transferencia' ? tree.roots(type) : [];
  const subs = tree && categoryId ? tree.children(categoryId) : [];
  const account = accounts.find((a) => a.id === accountId) ?? accountsAll?.find((a) => a.id === accountId);

  // Avance del presupuesto de la categoría/subcategoría elegida
  const budgetInfo = useMemo(() => {
    if (!tree || !txs || !settings || type !== 'egreso' || !categoryId) return null;
    const target = subcategoryId ? tree.byId.get(subcategoryId) : tree.byId.get(categoryId);
    if (!target || target.budget <= 0) return null;
    const p = periodFor(today(), settings.periodStartDay);
    const s = summarize(txs.filter((t) => t.id !== editId), p.start, p.end);
    const used = subcategoryId ? (s.bySubcategory.get(subcategoryId) ?? 0) : (s.byCategory.get(categoryId) ?? 0);
    return { name: target.name, used, budget: target.budget, pct: Math.min(100, Math.round((used / target.budget) * 100)) };
  }, [tree, txs, settings, type, categoryId, subcategoryId, editId]);

  const canSave =
    amount > 0 &&
    !!accountId &&
    (type === 'transferencia' ? !!toAccountId && toAccountId !== accountId : !!categoryId && (subs.length === 0 || !!subcategoryId));

  async function save() {
    if (!accountId || saving) return;
    setSaving(true);
    setError('');
    const input = { type, amount, accountId, toAccountId, categoryId, subcategoryId, date, note };
    try {
      if (editId) {
        await updateTransaction(editId, input);
        toast('Movimiento actualizado');
      } else {
        const id = await createTransaction(input);
        toast(`${{ egreso: 'Gasto', ingreso: 'Ingreso', transferencia: 'Transferencia' }[type]} de ${formatMoney(amount)} guardad${type === 'transferencia' ? 'a' : 'o'}`, { label: 'Deshacer', run: () => deleteTransaction(id) });
      }
      goBack('/');
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  async function applyTemplate(id: string) {
    const t = templates?.find((x) => x.id === id);
    if (!t) return;
    try {
      const txId = await createTransaction({ ...t, date: today(), note: t.note });
      toast(`${t.name} · ${formatMoney(t.amount)} guardado`, { label: 'Deshacer', run: () => deleteTransaction(txId) });
      goBack('/');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!loaded || !accountsAll || !tree) return <div className="entry" />;

  if (accounts.length === 0) {
    return (
      <div className="entry"><div className="entry-inner">
        <div className="empty">
          <p>Primero crea al menos una cuenta (banco o efectivo).</p>
          <a className="btn primary" href="#/cuentas">Ir a cuentas</a>
          <button className="btn ghost" onClick={() => goBack()}>Cancelar</button>
        </div>
      </div></div>
    );
  }

  const title = editId ? 'Editar movimiento' : 'Nuevo movimiento';
  const quickTemplates = (templates ?? []).filter((t) => t.type === type);

  return (
    <div className="entry">
      <div className="entry-inner">
        {step === 1 ? (
          <>
            <div className="between">
              <button className="icon-btn" aria-label="Cerrar" onClick={() => goBack()}><Icon name="close" size={20} /></button>
              <div style={{ fontWeight: 700 }}>{title}</div>
              <div style={{ width: 44 }} />
            </div>

            <div className="seg" role="tablist" aria-label="Tipo de movimiento">
              {(['egreso', 'ingreso', 'transferencia'] as TxType[]).map((t) => (
                <button key={t} role="tab" aria-selected={type === t} className={type === t ? 'on ' + TYPE_CLASS[t] : ''} onClick={() => changeType(t)}>
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>

            <div className="stack" style={{ alignItems: 'center', gap: 4, padding: '14px 0 4px' }}>
              <div className="small muted" style={{ fontWeight: 600, fontSize: 13 }}>{TYPE_SUB[type]}</div>
              <div className={'amount-display ' + TYPE_CLASS[type]} aria-live="polite">{formatMoney(amount)}</div>
            </div>

            <div className="chips wrap" style={{ justifyContent: 'center' }}>
              <button className="chip" onClick={() => setPickAccount(true)}>
                <Icon name={account?.icon ?? 'bank'} size={18} color="var(--gold)" />
                {account?.name ?? 'Cuenta'}
                {type === 'transferencia' && ' →'}
              </button>
              <label className="chip" style={{ position: 'relative' }}>
                <Icon name="calendar" size={18} />
                {friendlyDay(date)}
                <input type="date" value={date} max="2100-12-31" onChange={(e) => e.target.value && setDate(e.target.value)}
                  aria-label="Fecha del movimiento"
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%' }} />
              </label>
              <button className="chip" style={{ borderStyle: note ? 'solid' : 'dashed' }} onClick={() => setShowNote((v) => !v)}>
                <Icon name="note" size={18} />{note ? 'Nota ✓' : '+ Nota'}
              </button>
            </div>
            {showNote && (
              <input className="input" placeholder="Descripción (opcional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} autoFocus />
            )}

            {!editId && quickTemplates.length > 0 && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="section-label">Favoritos · un toque y listo</div>
                <div className="chips">
                  {quickTemplates.map((t) => (
                    <button key={t.id} className="chip" style={{ borderRadius: 12, minHeight: 44 }} onClick={() => applyTemplate(t.id)}>
                      {t.name} · {formatMoney(t.amount).replace('$ ', '')}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ flex: 1 }} />

            <div className="keypad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', '⌫'].map((k) => (
                <button key={k} onClick={() => (k === '000' ? (press('0'), press('0'), press('0')) : press(k))} aria-label={k === '⌫' ? 'Borrar' : k}>
                  {k === '⌫' ? <Icon name="backspace" size={24} /> : k}
                </button>
              ))}
            </div>

            <button className="btn primary lg block" disabled={amount <= 0} onClick={goStep2}>
              {type === 'transferencia' ? 'Elegir cuentas' : 'Elegir categoría'} <Icon name="next" size={20} stroke={2.2} />
            </button>
          </>
        ) : (
          <>
            <div className="between">
              <button className="icon-btn" aria-label="Volver al valor" onClick={() => setStep(1)}><Icon name="back" size={20} /></button>
              <div className="stack" style={{ alignItems: 'center', gap: 0 }}>
                <div className="small muted" style={{ fontWeight: 600 }}>{TYPE_SUB[type]} · {friendlyDay(date)}</div>
                <div className={TYPE_CLASS[type]} style={{ fontSize: 22, fontWeight: 800 }}>{formatMoney(amount)}</div>
              </div>
              <div style={{ width: 44 }} />
            </div>

            {type === 'transferencia' ? (
              <>
                <AccountTiles label="Desde" accounts={accounts} balances={balances} hidden={settings?.hideBalances} value={accountId} onChange={setAccountId} />
                <AccountTiles label="Hacia" accounts={accounts.filter((a) => a.id !== accountId)} balances={balances} hidden={settings?.hideBalances} value={toAccountId} onChange={setToAccountId} />
                {accounts.length < 2 && <p className="muted small">Necesitas al menos dos cuentas para transferir.</p>}
              </>
            ) : (
              <>
                <div className="stack" style={{ gap: 10 }}>
                  <div className="between">
                    <div className="section-label">Categoría</div>
                    {suggested && categoryId && <span className="small" style={{ color: 'var(--primary)', fontWeight: 600 }}>Sugerida por tu nota</span>}
                  </div>
                  {roots.length === 0 ? (
                    <div className="empty" style={{ padding: 12 }}>
                      <p>Aún no tienes categorías de {type === 'egreso' ? 'egresos' : 'ingresos'}.</p>
                      <a className="btn" href={`#/categorias?tipo=${type}`}>Crear categorías</a>
                    </div>
                  ) : (
                    <div className="cat-grid">
                      {roots.map((c) => (
                        <button key={c.id} className={'cat-tile' + (categoryId === c.id ? ' on' : '')} aria-pressed={categoryId === c.id}
                          onClick={() => { setCategoryId(c.id); setSubcategoryId(null); setSuggested(false); }}>
                          <span className="ci" style={{ color: c.color }}><Icon name={c.icon} size={24} /></span>
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {subs.length > 0 && (
                  <div className="stack" style={{ gap: 10 }}>
                    <div className="section-label">Subcategoría de {tree.byId.get(categoryId!)?.name}</div>
                    <div className="chips wrap">
                      {subs.map((s) => (
                        <button key={s.id} className={'chip' + (subcategoryId === s.id ? ' on' : '')} style={{ minHeight: 44 }} aria-pressed={subcategoryId === s.id}
                          onClick={() => { setSubcategoryId(s.id); setSuggested(false); }}>{s.name}</button>
                      ))}
                    </div>
                  </div>
                )}

                {budgetInfo && (
                  <div className="card stack" style={{ gap: 6, padding: 12 }}>
                    <div className="between small">
                      <span className="muted">Presupuesto de {budgetInfo.name}</span>
                      <strong>{formatMoney(budgetInfo.used)} de {formatMoney(budgetInfo.budget)}</strong>
                    </div>
                    <div className="bar"><div style={{ width: budgetInfo.pct + '%', background: budgetInfo.pct >= 100 ? 'var(--expense)' : budgetInfo.pct >= 80 ? 'var(--gold)' : 'var(--primary-2)' }} /></div>
                  </div>
                )}

                <AccountTiles label={type === 'egreso' ? 'Sale de' : 'Entra a'} accounts={accounts} balances={balances} hidden={settings?.hideBalances} value={accountId} onChange={setAccountId} />
              </>
            )}

            <div className="stack" style={{ gap: 8 }}>
              <div className="grid-2">
                <label className="field"><span>Fecha</span>
                  <input className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
                </label>
                <label className="field"><span>Nota</span>
                  <input className="input" placeholder="Opcional" value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} />
                </label>
              </div>
            </div>

            {error && <p role="alert" className="amount-out" style={{ margin: 0, fontWeight: 600 }}>{error}</p>}

            <div style={{ flex: 1 }} />
            <button className="btn primary lg block" disabled={!canSave || saving} onClick={save}>
              <Icon name="check" size={20} stroke={2.4} /> {editId ? 'Guardar cambios' : 'Guardar'}
            </button>
            {editId && (
              <ConfirmButton label="Eliminar movimiento" confirmLabel="Toca otra vez para eliminar"
                onConfirm={async () => { await deleteTransaction(editId); toast('Movimiento eliminado'); goBack('/historial'); }} />
            )}
          </>
        )}
      </div>

      {pickAccount && (
        <Sheet title={type === 'transferencia' ? 'Cuenta de origen' : 'Cuenta'} onClose={() => setPickAccount(false)}>
          <div className="stack" style={{ gap: 8 }}>
            {accounts.map((a) => (
              <button key={a.id} className={'acc-tile' + (a.id === accountId ? ' on' : '')} style={{ flexDirection: 'row', justifyContent: 'space-between', padding: '0 16px' }}
                onClick={() => { setAccountId(a.id); if (toAccountId === a.id) setToAccountId(null); setPickAccount(false); }}>
                <span className="row" style={{ gap: 10 }}><Icon name={a.icon} size={20} color={a.color} /><strong>{a.name}</strong></span>
                <span className="muted small">{formatMoney(balances?.get(a.id) ?? 0, { hidden: settings?.hideBalances })}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

function AccountTiles({ label, accounts, balances, value, onChange, hidden }: {
  label: string;
  hidden?: boolean;
  accounts: { id: string; name: string }[];
  balances?: Map<string, number>;
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="section-label">{label}</div>
      <div className="grid-2">
        {accounts.map((a) => (
          <button key={a.id} className={'acc-tile' + (value === a.id ? ' on' : '')} aria-pressed={value === a.id} onClick={() => onChange(a.id)}>
            <strong style={{ fontSize: 14 }}>{a.name}</strong>
            <span className="muted small">{formatMoney(balances?.get(a.id) ?? 0, { hidden })}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
