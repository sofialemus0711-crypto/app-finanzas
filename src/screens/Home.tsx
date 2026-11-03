import { useMemo } from 'react';
import { Icon } from '../components/Icon';
import { TxRow } from '../components/TxRow';
import { myContribution, summarize, totalBalance } from '../lib/calc';
import { today } from '../lib/dates';
import { useAccounts, useBalances, useCategories, useSettings, useTransactions } from '../lib/hooks';
import { formatMoney } from '../lib/money';
import { periodFor } from '../lib/period';
import { updateSettings } from '../lib/repo';

/** Inicio básico (Fase 3). El dashboard completo con gráficos llega en la Fase 4. */
export function Home() {
  const settings = useSettings();
  const accountsAll = useAccounts();
  const categories = useCategories();
  const txs = useTransactions();
  const balances = useBalances(accountsAll, txs);

  const data = useMemo(() => {
    if (!settings || !accountsAll || !categories || !txs || !balances) return null;
    const accounts = accountsAll.filter((a) => !a.archived);
    const period = periodFor(today(), settings.periodStartDay);
    const sum = summarize(txs, period.start, period.end);
    return {
      accounts,
      period,
      sum,
      total: totalBalance(accountsAll, balances),
      contribution: myContribution(sum, categories),
      hasCovered: categories.some((c) => c.coveredByCategoryId),
      accMap: new Map(accountsAll.map((a) => [a.id, a])),
      catMap: new Map(categories.map((c) => [c.id, c])),
    };
  }, [settings, accountsAll, categories, txs, balances]);

  if (!data || !settings || !txs || !balances) return null;
  const hidden = settings.hideBalances;
  const { sum } = data;

  return (
    <div className="container">
      <div className="between">
        <div>
          <div className="muted" style={{ fontSize: 13, fontWeight: 600 }}>{settings.userName ? `Hola, ${settings.userName}` : 'Hola'}</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{data.period.label}</div>
        </div>
        <button className="icon-btn" aria-label={hidden ? 'Mostrar saldos' : 'Ocultar saldos'} aria-pressed={hidden}
          onClick={() => updateSettings({ hideBalances: !hidden })}>
          <Icon name={hidden ? 'eyeOff' : 'eye'} size={20} />
        </button>
      </div>

      <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <section className="hero" aria-label="Total disponible">
          <div>
            <div className="label">Total disponible</div>
            <div className="big">{formatMoney(data.total, { hidden })}</div>
          </div>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.18)' }} />
          <div className="grid-2">
            {data.accounts.map((a) => (
              <a key={a.id} href="#/cuentas" style={{ color: 'inherit', textDecoration: 'none' }}>
                <div className="label" style={{ fontSize: 12, fontWeight: 500 }}>{a.name}</div>
                <div style={{ fontWeight: 700 }}>{formatMoney(balances.get(a.id) ?? 0, { hidden })}</div>
              </a>
            ))}
          </div>
        </section>

        <div className="stack">
          <div className="grid-2">
            <div className="card">
              <div className="muted small" style={{ fontWeight: 600 }}>Ingresos</div>
              <div className="amount-in" style={{ fontSize: 18, fontWeight: 800 }}>{formatMoney(sum.income, { hidden })}</div>
            </div>
            <div className="card">
              <div className="muted small" style={{ fontWeight: 600 }}>Egresos</div>
              <div className="amount-out" style={{ fontSize: 18, fontWeight: 800 }}>{formatMoney(sum.expense, { hidden })}</div>
            </div>
          </div>
          <div className="card stack" style={{ gap: 10 }}>
            <div className="between">
              <div className="h2">Balance del periodo</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--primary)' }}>{formatMoney(sum.balance, { sign: true, hidden })}</div>
            </div>
            <div className="bar" style={{ height: 10, background: 'var(--primary-soft)' }}>
              <div style={{ width: Math.min(100, sum.spentPct ?? 0) + '%', background: 'var(--expense)' }} />
            </div>
            <div className="small muted">
              {sum.spentPct === null ? 'Aún no hay ingresos este periodo' : <>Gastaste el <strong style={{ color: 'var(--text)' }}>{sum.spentPct} %</strong> de tus ingresos</>}
            </div>
            {data.hasCovered && (
              <div className="small muted">Mi aporte: <strong style={{ color: 'var(--text)' }}>{formatMoney(data.contribution.mine, { hidden })}</strong> (sin gastos cubiertos {formatMoney(data.contribution.covered, { hidden })})</div>
            )}
          </div>
        </div>
      </div>

      <section className="card flush">
        <div className="between" style={{ padding: '10px 0' }}>
          <h2 className="h2">Últimos movimientos</h2>
          <a href="#/historial" style={{ fontSize: 13, fontWeight: 600 }}>Ver historial</a>
        </div>
        {txs.length === 0 ? (
          <div className="empty">
            <p>Aún no hay movimientos. Registra el primero con el botón +.</p>
          </div>
        ) : (
          txs.slice(0, 6).map((t) => <TxRow key={t.id} t={t} accounts={data.accMap} categories={data.catMap} />)
        )}
      </section>
      <p className="muted small" style={{ textAlign: 'center' }}>Los gráficos y el resumen completo llegan en la Fase 4.</p>
    </div>
  );
}
