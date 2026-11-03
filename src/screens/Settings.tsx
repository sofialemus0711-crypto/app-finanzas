import { useRef, useState } from 'react';
import type { Settings as SettingsT } from '../db/types';
import { Icon } from '../components/Icon';
import { ConfirmButton, MoneyInput, Sheet, useToast } from '../components/ui';
import { buildBackup, buildTransactionsCsv, downloadText, parseBackup, restoreBackup, type BackupFile } from '../lib/backup';
import { today } from '../lib/dates';
import { useAccounts, useCategories, useCategoryTree, useSettings, useTemplates } from '../lib/hooks';
import { formatMoney } from '../lib/money';
import { createTemplate, deleteTemplate, updateSettings } from '../lib/repo';

export function Settings() {
  const toast = useToast();
  const settings = useSettings();
  const templates = useTemplates();
  const accounts = useAccounts();
  const categories = useCategories();
  const tree = useCategoryTree(categories);
  const [newTemplate, setNewTemplate] = useState(false);
  const [pending, setPending] = useState<BackupFile | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!settings || !templates || !tree || !accounts) return null;
  const set = (patch: Partial<SettingsT>) => updateSettings(patch);

  async function exportJson() {
    const b = await buildBackup();
    downloadText(`monedi-respaldo-${today()}.json`, JSON.stringify(b, null, 2), 'application/json');
    toast('Respaldo descargado');
  }
  async function exportCsv() {
    downloadText(`monedi-movimientos-${today()}.csv`, await buildTransactionsCsv(), 'text/csv;charset=utf-8');
    toast('Archivo para Excel descargado');
  }
  async function onFile(file: File) {
    try {
      setPending(parseBackup(await file.text()));
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="container">
      <h1 className="h1">Más</h1>

      <section className="card stack">
        <h2 className="h2">Perfil y preferencias</h2>
        <label className="field"><span>Tu nombre</span>
          <input className="input" defaultValue={settings.userName} maxLength={30} onBlur={(e) => set({ userName: e.target.value.trim() })} />
        </label>
        <label className="field"><span>Mi mes financiero empieza el día</span>
          <select className="select" value={settings.periodStartDay} onChange={(e) => set({ periodStartDay: Number(e.target.value) })}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d === 1 ? '1 (mes calendario)' : `${d} de cada mes`}</option>
            ))}
          </select>
        </label>
        <div className="field"><span>Tema</span>
          <div className="seg">
            {([['system', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']] as const).map(([v, l]) => (
              <button key={v} className={settings.theme === v ? 'on' : ''} aria-pressed={settings.theme === v} onClick={() => set({ theme: v })}>{l}</button>
            ))}
          </div>
        </div>
        <label className="between" style={{ minHeight: 44 }}>
          <span style={{ fontWeight: 600 }}>Ocultar saldos</span>
          <input type="checkbox" checked={settings.hideBalances} onChange={(e) => set({ hideBalances: e.target.checked })} style={{ width: 24, height: 24, accentColor: 'var(--primary)' }} />
        </label>
      </section>

      <a className="card between" href="#/categorias" style={{ color: 'inherit', textDecoration: 'none' }}>
        <span className="row"><Icon name="grid" /> <strong>Categorías y presupuestos</strong></span>
        <Icon name="chevron" size={18} />
      </a>
      <a className="card between" href="#/importar-categorias" style={{ color: 'inherit', textDecoration: 'none' }}>
        <span className="row"><Icon name="upload" /> <strong>Importar categorías desde foto, Excel o texto</strong></span>
        <Icon name="chevron" size={18} />
      </a>

      <section className="card stack">
        <div className="between">
          <h2 className="h2">Favoritos</h2>
          <button className="btn" style={{ minHeight: 40 }} onClick={() => setNewTemplate(true)}>+ Nuevo</button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Movimientos frecuentes que registras con un solo toque desde el registro rápido.</p>
        {templates.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Aún no tienes favoritos.</p> : templates.map((t) => (
          <div key={t.id} className="between" style={{ borderTop: '1px solid var(--surface-2)', paddingTop: 10 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{t.name}</div>
              <div className="small muted">
                {formatMoney(t.amount)} · {tree.byId.get(t.categoryId)?.name}{t.subcategoryId ? ' › ' + tree.byId.get(t.subcategoryId)?.name : ''} · {accounts.find((a) => a.id === t.accountId)?.name}
              </div>
            </div>
            <ConfirmButton className="btn danger" label="Quitar" confirmLabel="¿Seguro?" onConfirm={() => deleteTemplate(t.id)} />
          </div>
        ))}
      </section>

      <section className="card stack">
        <h2 className="h2">Respaldo</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Por ahora tus datos viven en este dispositivo. Descarga un respaldo con frecuencia y guárdalo en iCloud o Google Drive.
        </p>
        <button className="btn block" onClick={exportJson}><Icon name="download" size={18} /> Descargar respaldo completo (.json)</button>
        <button className="btn block" onClick={exportCsv}><Icon name="download" size={18} /> Exportar movimientos para Excel (.csv)</button>
        <button className="btn block" onClick={() => fileRef.current?.click()}><Icon name="upload" size={18} /> Restaurar desde un respaldo</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      </section>

      <p className="small muted" style={{ textAlign: 'center' }}>Monedi · versión 0.3.1</p>

      {newTemplate && <TemplateForm onClose={() => setNewTemplate(false)} />}
      {pending && (
        <Sheet title="Restaurar respaldo" onClose={() => setPending(null)}>
          <p style={{ margin: 0 }}>
            Respaldo del {new Date(pending.exportedAt).toLocaleString('es-CO')}: {pending.accounts.length} cuentas, {pending.categories.length} categorías y {pending.transactions.length} movimientos.
          </p>
          <button className="btn primary block" onClick={async () => { await restoreBackup(pending, 'merge'); setPending(null); toast('Respaldo agregado'); }}>
            Agregar a lo que ya tengo
          </button>
          <ConfirmButton className="btn danger block" label="Reemplazar todo con el respaldo" confirmLabel="Se borrará lo actual. Toca otra vez para confirmar"
            onConfirm={async () => { await restoreBackup(pending, 'replace'); setPending(null); toast('Respaldo restaurado'); }} />
        </Sheet>
      )}
    </div>
  );
}

function TemplateForm({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const accounts = (useAccounts() ?? []).filter((a) => !a.archived);
  const tree = useCategoryTree(useCategories());
  const [name, setName] = useState('');
  const [type, setType] = useState<'egreso' | 'ingreso'>('egreso');
  const [amount, setAmount] = useState(0);
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState('');
  if (!tree) return null;
  const roots = tree.roots(type);
  const subs = categoryId ? tree.children(categoryId) : [];

  async function save() {
    setError('');
    if (!categoryId) return setError('Elige una categoría.');
    if (subs.length > 0 && !subcategoryId) return setError('Elige una subcategoría.');
    const acc = accountId || accounts[0]?.id;
    if (!acc) return setError('Primero crea una cuenta.');
    try {
      await createTemplate({ name, type, amount, categoryId, subcategoryId: subcategoryId || null, accountId: acc, note: name });
      toast('Favorito creado');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Sheet title="Nuevo favorito" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="seg" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <button type="button" className={type === 'egreso' ? 'on amount-out' : ''} onClick={() => { setType('egreso'); setCategoryId(''); setSubcategoryId(''); }}>Egreso</button>
          <button type="button" className={type === 'ingreso' ? 'on amount-in' : ''} onClick={() => { setType('ingreso'); setCategoryId(''); setSubcategoryId(''); }}>Ingreso</button>
        </div>
        <label className="field"><span>Nombre</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Almuerzo U, Bus" maxLength={30} autoFocus />
        </label>
        <MoneyInput label="Valor" value={amount} onChange={(v) => setAmount(Math.max(0, v))} />
        <label className="field"><span>Categoría</span>
          <select className="select" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setSubcategoryId(''); }}>
            <option value="">Elige…</option>
            {roots.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {subs.length > 0 && (
          <label className="field"><span>Subcategoría</span>
            <select className="select" value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)}>
              <option value="">Elige…</option>
              {subs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <label className="field"><span>Cuenta</span>
          <select className="select" value={accountId || accounts[0]?.id || ''} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        {error && <p role="alert" className="amount-out" style={{ margin: 0, fontWeight: 600 }}>{error}</p>}
        <button className="btn primary lg block" type="submit">Guardar favorito</button>
      </form>
    </Sheet>
  );
}
