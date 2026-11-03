import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { addDays, friendlyDay, shortDate, today } from '../lib/dates';

/* ------------------------------- Hoja modal ------------------------------- */

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); // que Escape cierre solo la hoja, no la pantalla de atrás
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="between">
          <h2 className="h1" style={{ fontSize: 20 }}>{title}</h2>
          <button className="icon-btn" aria-label="Cerrar" onClick={onClose}><Icon name="close" size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------------------------------- Toast --------------------------------- */

interface ToastMsg { id: number; text: string; action?: { label: string; run: () => void } }
const ToastCtx = createContext<(text: string, action?: ToastMsg['action']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const show = useCallback((text: string, action?: ToastMsg['action']) => {
    setMsg({ id: Date.now(), text, action });
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.action ? 5000 : 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <div className="toast" role="status" aria-live="polite" key={msg.id}>
          <span>{msg.text}</span>
          {msg.action && (
            <button onClick={() => { msg.action!.run(); setMsg(null); }}>{msg.action.label}</button>
          )}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/* ------------------------------ Campo de dinero ------------------------------ */

const nf = new Intl.NumberFormat('es-CO');

export function MoneyInput({ value, onChange, label, allowNegative = false }: { value: number; onChange: (v: number) => void; label: string; allowNegative?: boolean }) {
  const negative = allowNegative && value < 0;
  return (
    <label className="field">
      <span>{label}</span>
      <div className="row" style={{ gap: 8 }}>
        {allowNegative && (
          <button type="button" className="chip" aria-pressed={negative} onClick={() => onChange(-value)} title="Cambiar signo">
            {negative ? '−' : '+'}
          </button>
        )}
        <input
          className="input"
          inputMode="numeric"
          value={value === 0 ? '' : '$ ' + nf.format(Math.abs(value))}
          placeholder="$ 0"
          onChange={(e) => {
            const n = parseInt(e.target.value.replace(/\D/g, '') || '0', 10);
            onChange(negative ? -n : n);
          }}
        />
      </div>
    </label>
  );
}

/* --------------------------- Selector de ícono/color --------------------------- */

export function ConfirmButton({ label, confirmLabel, onConfirm, className = 'btn danger block' }: { label: string; confirmLabel: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button type="button" className={className} onClick={() => (armed ? onConfirm() : setArmed(true))} onBlur={() => setArmed(false)}>
      {armed ? confirmLabel : label}
    </button>
  );
}

/* ------------------------------ Selector de fecha ------------------------------ */


/**
 * Botón con la fecha que abre una hoja con atajos (Hoy, Ayer, Anteayer) y un calendario.
 * Funciona igual en iPhone, Android y computador.
 */
export function DateChip({ value, onChange, label, compact }: { value: string; onChange: (v: string) => void; label?: (v: string) => string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const t = today();
  const quick = [
    { v: t, l: 'Hoy' },
    { v: addDays(t, -1), l: 'Ayer' },
    { v: addDays(t, -2), l: 'Anteayer' },
  ];
  const pick = (v: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) onChange(v);
    setOpen(false);
  };
  return (
    <>
      <button type="button" className="chip" style={compact ? { minHeight: 40, flex: 'none' } : undefined} onClick={() => setOpen(true)} aria-label={`Fecha: ${shortDate(value)}. Cambiar`}>
        <Icon name="calendar" size={compact ? 16 : 18} />
        {label ? label(value) : friendlyDay(value)}
      </button>
      {open && (
        <Sheet title="Fecha del movimiento" onClose={() => setOpen(false)}>
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            {quick.map((q) => (
              <button key={q.v} type="button" className={'btn' + (q.v === value ? ' primary' : '')} onClick={() => pick(q.v)}>{q.l}</button>
            ))}
          </div>
          <label className="field"><span>Otra fecha</span>
            <input className="input" type="date" defaultValue={value} max="2100-12-31" onChange={(e) => e.target.value && onChange(e.target.value)} />
          </label>
          <button type="button" className="btn primary lg block" onClick={() => setOpen(false)}>Listo · {shortDate(value)}</button>
        </Sheet>
      )}
    </>
  );
}
