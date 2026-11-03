import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

/* ------------------------------- Hoja modal ------------------------------- */

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
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
