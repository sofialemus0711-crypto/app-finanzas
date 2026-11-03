import { useRef, useState } from 'react';
import type { AccountType } from '../db/types';
import { Icon } from '../components/Icon';
import { useToast } from '../components/ui';
import { parseBackup, restoreBackup } from '../lib/backup';
import { useAccounts } from '../lib/hooks';
import { formatMoney } from '../lib/money';
import { updateSettings } from '../lib/repo';
import { navigate } from '../lib/router';
import { AccountForm, typeLabel } from './Accounts';

const SUGGESTIONS: { name: string; type: AccountType }[] = [
  { name: 'Efectivo', type: 'efectivo' },
  { name: 'Bancolombia', type: 'ahorros' },
  { name: 'Nequi', type: 'billetera' },
  { name: 'Davivienda', type: 'ahorros' },
  { name: 'Daviplata', type: 'billetera' },
  { name: 'Nu', type: 'ahorros' },
];

export function Onboarding() {
  const toast = useToast();
  const accounts = useAccounts() ?? [];
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState<{ name: string; type: AccountType } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function restore(file: File) {
    try {
      await restoreBackup(parseBackup(await file.text()), 'replace');
      toast('Respaldo restaurado');
      navigate('/', { replace: true });
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function finish() {
    await updateSettings({ onboarded: true });
    navigate('/categorias', { replace: true });
  }

  return (
    <div className="entry">
      <div className="entry-inner" style={{ gap: 20 }}>
        <div className="brand" style={{ padding: 0, justifyContent: 'center', color: 'var(--primary)' }}>
          <img src="./icon.svg" alt="" /> Monedi
        </div>

        {step === 1 ? (
          <>
            <div className="stack" style={{ gap: 6, textAlign: 'center' }}>
              <h1 className="h1">Bienvenida a Monedi</h1>
              <p className="muted" style={{ margin: 0 }}>Registra cada peso en segundos y mira en tiempo real cómo van tus finanzas.</p>
            </div>
            <form className="stack" onSubmit={async (e) => { e.preventDefault(); await updateSettings({ userName: name.trim() }); setStep(2); }}>
              <label className="field"><span>¿Cómo te llamas?</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={30} placeholder="Tu nombre" />
              </label>
              <button className="btn primary lg block" type="submit">Continuar <Icon name="next" size={20} /></button>
            </form>
            <div style={{ flex: 1 }} />
            <button className="btn ghost block" onClick={() => fileRef.current?.click()}><Icon name="upload" size={18} /> Ya tengo un respaldo de Monedi</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) restore(f); }} />
          </>
        ) : (
          <>
            <div className="stack" style={{ gap: 6 }}>
              <h1 className="h1">Tus cuentas</h1>
              <p className="muted" style={{ margin: 0 }}>Agrega los bancos, billeteras y el efectivo que usas, con el saldo que tienen hoy.</p>
            </div>

            {accounts.length > 0 && (
              <div className="card flush">
                {accounts.map((a) => (
                  <div key={a.id} className="list-item">
                    <span className="ico" style={{ background: 'var(--surface-2)', color: a.color }}><Icon name={a.icon} size={20} /></span>
                    <span className="grow"><span className="li-title">{a.name}</span><br /><span className="li-sub">{typeLabel(a.type)}</span></span>
                    <span className="li-amount">{formatMoney(a.initialBalance)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="stack" style={{ gap: 8 }}>
              <div className="section-label">Agregar rápido</div>
              <div className="chips wrap">
                {SUGGESTIONS.filter((s) => !accounts.some((a) => a.name.toLowerCase() === s.name.toLowerCase())).map((s) => (
                  <button key={s.name} className="chip" onClick={() => setAdding(s)}>+ {s.name}</button>
                ))}
                <button className="chip" style={{ borderStyle: 'dashed' }} onClick={() => setAdding({ name: '', type: 'ahorros' })}>+ Otra</button>
              </div>
            </div>

            <div style={{ flex: 1 }} />
            <button className="btn primary lg block" disabled={accounts.length === 0} onClick={finish}>
              Listo, ahora mis categorías <Icon name="next" size={20} />
            </button>
          </>
        )}
      </div>
      {adding && <AccountForm account={null} preset={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}
