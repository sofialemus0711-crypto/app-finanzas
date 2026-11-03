import { useMemo, useState } from 'react';
import type { TxType } from '../db/types';
import { Icon } from '../components/Icon';
import { TxRow } from '../components/TxRow';
import { friendlyDay } from '../lib/dates';
import { useAccounts, useCategories, useCategoryTree, useSettings, useTransactions } from '../lib/hooks';
import { formatMoney } from '../lib/money';

export function History() {
  const settings = useSettings();
  const accounts = useAccounts();
  const categories = useCategories();
  const tree = useCategoryTree(categories);
  const txs = useTransactions();

  const [q, setQ] = useState('');
  const [type, setType] = useState<TxType | 'todos'>('todos');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(150);

  const accMap = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a])), [accounts]);
  const catMap = tree?.byId ?? new Map();

  const filtered = useMemo(() => {
    if (!txs) return [];
    const needle = q.trim().toLowerCase();
    return txs.filter((t) => {
      if (type !== 'todos' && t.type !== type) return false;
      if (accountId && t.accountId !== accountId && t.toAccountId !== accountId) return false;
      if (categoryId && t.categoryId !== categoryId) return false;
      if (subcategoryId && t.subcategoryId !== subcategoryId) return false;
      if (from && t.date < from) return false;
      if (to && t.date > to) return false;
      if (needle) {
        const hay = [t.note, t.categoryId && catMap.get(t.categoryId)?.name, t.subcategoryId && catMap.get(t.subcategoryId)?.name]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [txs, q, type, accountId, categoryId, subcategoryId, from, to, catMap]);

  const totals = useMemo(() => {
    let inc = 0, exp = 0;
    for (const t of filtered) {
      if (t.type === 'ingreso') inc += t.amount;
      else if (t.type === 'egreso') exp += t.amount;
    }
    return { inc, exp };
  }, [filtered]);

  const groups = useMemo(() => {
    const out: { date: string; items: typeof filtered; net: number }[] = [];
    for (const t of filtered.slice(0, limit)) {
      let g = out[out.length - 1];
      if (!g || g.date !== t.date) {
        g = { date: t.date, items: [], net: 0 };
        out.push(g);
      }
      g.items.push(t);
      if (t.type === 'ingreso') g.net += t.amount;
      else if (t.type === 'egreso') g.net -= t.amount;
    }
    return out;
  }, [filtered, limit]);

  if (!txs || !accounts || !tree) return null;
  const hidden = settings?.hideBalances;
  const catOptions = type === 'ingreso' ? tree.roots('ingreso') : type === 'egreso' ? tree.roots('egreso') : [...tree.roots('egreso'), ...tree.roots('ingreso')];
  const subOptions = categoryId ? tree.children(categoryId) : [];
  const activeFilters = [accountId, categoryId, subcategoryId, from, to].filter(Boolean).length;

  return (
    <div className="container">
      <h1 className="h1">Historial</h1>

      <label className="search">
        <Icon name="search" size={20} color="var(--muted)" />
        <input type="search" placeholder="Buscar por descripción o categoría" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar movimientos" />
      </label>

      <div className="chips">
        {([['todos', 'Todos'], ['ingreso', 'Ingresos'], ['egreso', 'Egresos'], ['transferencia', 'Transferencias']] as const).map(([v, l]) => (
          <button key={v} className={'chip' + (type === v ? ' on' : '')} aria-pressed={type === v}
            onClick={() => { setType(v); setCategoryId(''); setSubcategoryId(''); }}>{l}</button>
        ))}
        <button className={'chip' + (activeFilters ? ' on' : '')} aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
          Filtros{activeFilters ? ` (${activeFilters})` : ''} <Icon name="down" size={16} />
        </button>
      </div>

      {showFilters && (
        <div className="card stack">
          <div className="grid-2">
            <label className="field"><span>Cuenta</span>
              <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Todas</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (archivada)' : ''}</option>)}
              </select>
            </label>
            <label className="field"><span>Categoría</span>
              <select className="select" value={categoryId} disabled={type === 'transferencia'} onChange={(e) => { setCategoryId(e.target.value); setSubcategoryId(''); }}>
                <option value="">Todas</option>
                {catOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            {subOptions.length > 0 && (
              <label className="field"><span>Subcategoría</span>
                <select className="select" value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)}>
                  <option value="">Todas</option>
                  {subOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            )}
            <label className="field"><span>Desde</span>
              <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field"><span>Hasta</span>
              <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          {activeFilters > 0 && (
            <button className="btn ghost" onClick={() => { setAccountId(''); setCategoryId(''); setSubcategoryId(''); setFrom(''); setTo(''); }}>Limpiar filtros</button>
          )}
        </div>
      )}

      <div className="between small muted">
        <span>{filtered.length} movimiento{filtered.length === 1 ? '' : 's'}</span>
        <span>
          <span className="amount-in">{formatMoney(totals.inc, { hidden })}</span> · <span className="amount-out">{formatMoney(-totals.exp, { hidden })}</span>
        </span>
      </div>

      {groups.length === 0 ? (
        <div className="empty card"><p>{txs.length === 0 ? 'Aún no hay movimientos.' : 'Ningún movimiento coincide con la búsqueda.'}</p></div>
      ) : (
        groups.map((g) => (
          <section key={g.date} className="stack" style={{ gap: 6 }}>
            <div className="between section-label" style={{ padding: '0 4px' }}>
              <span>{friendlyDay(g.date)}</span>
              <span>{formatMoney(g.net, { sign: true, hidden })}</span>
            </div>
            <div className="card flush">
              {g.items.map((t) => <TxRow key={t.id} t={t} accounts={accMap} categories={catMap} />)}
            </div>
          </section>
        ))
      )}
      {filtered.length > limit && (
        <button className="btn block" onClick={() => setLimit((l) => l + 150)}>Ver más</button>
      )}
      <p className="muted small" style={{ textAlign: 'center' }}>Toca un movimiento para editarlo o eliminarlo.</p>
    </div>
  );
}
