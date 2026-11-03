import { useEffect, useState } from 'react';
import type { Category, CategoryKind } from '../db/types';
import { Icon, PICKABLE_COLORS, PICKABLE_ICONS } from '../components/Icon';
import { MoneyInput, Sheet, useToast } from '../components/ui';
import { useCategories, useCategoryTree } from '../lib/hooks';
import { formatMoney } from '../lib/money';
import { countCategoryTransactions, createCategory, deleteCategory, updateCategory } from '../lib/repo';

type Editing = { cat: Category | null; kind: CategoryKind; parentId: string | null };

export function Categories({ initialKind = 'egreso' }: { initialKind?: CategoryKind }) {
  const categories = useCategories();
  const tree = useCategoryTree(categories);
  const [kind, setKind] = useState<CategoryKind>(initialKind);
  const [editing, setEditing] = useState<Editing | null>(null);

  if (!tree) return null;
  const roots = tree.roots(kind);
  const totalBudget = roots.reduce((s, c) => s + c.budget, 0);

  return (
    <div className="container">
      <div className="between">
        <h1 className="h1">Categorías</h1>
        <button className="icon-btn" style={{ background: 'var(--primary)', color: 'var(--on-primary)', border: 'none' }} aria-label="Nueva categoría"
          onClick={() => setEditing({ cat: null, kind, parentId: null })}>
          <Icon name="plus" size={22} stroke={2.2} />
        </button>
      </div>

      <div className="seg" style={{ gridTemplateColumns: '1fr 1fr' }} role="tablist">
        <button role="tab" aria-selected={kind === 'egreso'} className={kind === 'egreso' ? 'on amount-out' : ''} onClick={() => setKind('egreso')}>Egresos</button>
        <button role="tab" aria-selected={kind === 'ingreso'} className={kind === 'ingreso' ? 'on amount-in' : ''} onClick={() => setKind('ingreso')}>Ingresos</button>
      </div>

      {totalBudget > 0 && (
        <div className="small muted">{kind === 'egreso' ? 'Presupuesto mensual total' : 'Ingreso mensual esperado'}: <strong style={{ color: 'var(--text)' }}>{formatMoney(totalBudget)}</strong></div>
      )}

      {roots.length === 0 && (
        <div className="empty card">
          <p>Aún no tienes categorías de {kind === 'egreso' ? 'egresos' : 'ingresos'}.</p>
          <button className="btn primary" onClick={() => setEditing({ cat: null, kind, parentId: null })}>Crear la primera</button>
        </div>
      )}

      <div className="grid-auto">
        {roots.map((c) => {
          const subs = tree.children(c.id);
          const coveredBy = c.coveredByCategoryId ? tree.byId.get(c.coveredByCategoryId) : null;
          return (
            <div key={c.id} className="card stack">
              <div className="row">
                <span className="ico" style={{ background: 'var(--surface-2)', color: c.color }}><Icon name={c.icon} size={22} /></span>
                <div className="grow">
                  <div style={{ fontWeight: 700 }}>{c.name}</div>
                  <div className="small muted">
                    {c.budget > 0 ? (kind === 'egreso' ? 'Presupuesto ' : 'Esperado ') + formatMoney(c.budget) : 'Sin presupuesto'}
                    {coveredBy && <> · cubierto por {coveredBy.name}</>}
                  </div>
                </div>
                <button className="icon-btn" style={{ borderRadius: 12 }} aria-label={`Editar ${c.name}`} onClick={() => setEditing({ cat: c, kind, parentId: null })}>
                  <Icon name="edit" size={18} />
                </button>
              </div>
              <div className="chips wrap">
                {subs.map((s) => (
                  <button key={s.id} className="chip" onClick={() => setEditing({ cat: s, kind, parentId: c.id })} aria-label={`Editar subcategoría ${s.name}`}>
                    {s.name}{s.budget > 0 && <span className="muted small">{formatMoney(s.budget)}</span>}
                  </button>
                ))}
                <button className="chip" style={{ borderStyle: 'dashed', color: 'var(--muted)' }} onClick={() => setEditing({ cat: null, kind, parentId: c.id })}>+ Subcategoría</button>
              </div>
            </div>
          );
        })}
      </div>

      {editing && <CategoryForm {...editing} all={categories ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CategoryForm({ cat, kind, parentId, all, onClose }: Editing & { all: Category[]; onClose: () => void }) {
  const toast = useToast();
  const parent = parentId ? all.find((c) => c.id === parentId) : null;
  const isSub = !!parentId;
  const [name, setName] = useState(cat?.name ?? '');
  const [icon, setIcon] = useState(cat?.icon ?? parent?.icon ?? (kind === 'egreso' ? 'cart' : 'briefcase'));
  const [color, setColor] = useState(cat?.color ?? parent?.color ?? PICKABLE_COLORS[0]);
  const [budget, setBudget] = useState(cat?.budget ?? 0);
  const [coveredBy, setCoveredBy] = useState(cat?.coveredByCategoryId ?? '');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [usage, setUsage] = useState<number | null>(null);
  const [reassign, setReassign] = useState('');

  useEffect(() => {
    if (deleting && cat) countCategoryTransactions(cat.id).then(setUsage);
  }, [deleting, cat]);

  const incomeRoots = all.filter((c) => c.kind === 'ingreso' && c.parentId === null);
  const reassignOptions = isSub
    ? all.filter((c) => c.parentId === parentId && c.id !== cat?.id)
    : all.filter((c) => c.kind === kind && c.parentId === null && c.id !== cat?.id);

  async function save() {
    setError('');
    const data = { name, kind, parentId, icon, color, budget, coveredByCategoryId: kind === 'egreso' && !isSub && coveredBy ? coveredBy : null };
    try {
      if (cat) await updateCategory(cat.id, data);
      else await createCategory(data);
      toast(cat ? 'Categoría actualizada' : isSub ? 'Subcategoría creada' : 'Categoría creada');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove() {
    if (!cat) return;
    setError('');
    try {
      await deleteCategory(cat.id, reassign || null);
      toast(isSub ? 'Subcategoría eliminada' : 'Categoría eliminada');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const title = cat ? (isSub ? 'Editar subcategoría' : 'Editar categoría') : isSub ? `Nueva subcategoría de ${parent?.name}` : `Nueva categoría de ${kind === 'egreso' ? 'egreso' : 'ingreso'}`;

  if (deleting && cat) {
    const needsTarget = !isSub && (usage ?? 0) > 0;
    return (
      <Sheet title={`Eliminar ${cat.name}`} onClose={onClose}>
        {usage === null ? <p>Revisando…</p> : (
          <div className="stack">
            {usage === 0 ? (
              <p>No tiene movimientos.{!isSub && ' También se eliminarán sus subcategorías.'}</p>
            ) : (
              <>
                <p>Tiene <strong>{usage}</strong> movimiento{usage === 1 ? '' : 's'}. {needsTarget ? '¿A qué categoría los movemos?' : '¿A qué subcategoría los movemos? (Si no eliges, quedan solo en la categoría principal.)'}</p>
                <label className="field"><span>Mover a</span>
                  <select className="select" value={reassign} onChange={(e) => setReassign(e.target.value)}>
                    <option value="">{needsTarget ? 'Elige una categoría' : `Solo ${parent?.name}`}</option>
                    {reassignOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              </>
            )}
            {error && <p role="alert" className="amount-out" style={{ margin: 0, fontWeight: 600 }}>{error}</p>}
            <button className="btn lg block" style={{ background: 'var(--expense)', color: '#fff', border: 'none' }} disabled={needsTarget && !reassign} onClick={remove}>
              <Icon name="trash" size={18} /> Eliminar
            </button>
            <button className="btn ghost block" onClick={() => setDeleting(false)}>Cancelar</button>
          </div>
        )}
      </Sheet>
    );
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="field"><span>Nombre</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus={!cat} />
        </label>
        <MoneyInput label={kind === 'egreso' ? 'Presupuesto mensual (opcional)' : 'Valor mensual esperado (opcional)'} value={budget} onChange={(v) => setBudget(Math.max(0, v))} />
        {!isSub && (
          <>
            <div className="field"><span>Ícono</span>
              <div className="icon-pick">
                {PICKABLE_ICONS.map((i) => (
                  <button type="button" key={i} className={i === icon ? 'on' : ''} aria-label={`Ícono ${i}`} aria-pressed={i === icon} onClick={() => setIcon(i)} style={{ color }}>
                    <Icon name={i} size={22} />
                  </button>
                ))}
              </div>
            </div>
            <div className="field"><span>Color</span>
              <div className="swatches">
                {PICKABLE_COLORS.map((c) => (
                  <button type="button" key={c} className={'swatch' + (c === color ? ' on' : '')} style={{ background: c }} aria-label={`Color ${c}`} aria-pressed={c === color} onClick={() => setColor(c)} />
                ))}
              </div>
            </div>
            {kind === 'egreso' && incomeRoots.length > 0 && (
              <label className="field"><span>¿Este gasto lo cubre un ingreso específico?</span>
                <select className="select" value={coveredBy} onChange={(e) => setCoveredBy(e.target.value)}>
                  <option value="">No, sale de mi bolsillo</option>
                  {incomeRoots.map((c) => <option key={c.id} value={c.id}>Sí, lo cubre: {c.name}</option>)}
                </select>
              </label>
            )}
          </>
        )}
        {error && <p role="alert" className="amount-out" style={{ margin: 0, fontWeight: 600 }}>{error}</p>}
        <button className="btn primary lg block" type="submit">Guardar</button>
        {cat && <button type="button" className="btn danger block" onClick={() => setDeleting(true)}><Icon name="trash" size={18} /> Eliminar</button>}
      </form>
    </Sheet>
  );
}
