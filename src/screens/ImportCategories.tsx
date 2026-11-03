import { useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { MoneyInput, useToast } from '../components/ui';
import { useCategories } from '../lib/hooks';
import { guessIcon, normalizeName, type ParsedRow, type ParseResult } from '../lib/importParse';
import { parseExcel, parseImage, parsePastedText, parseTextFile } from '../lib/importSources';
import { formatMoney } from '../lib/money';
import { importCategories } from '../lib/repo';
import { navigate } from '../lib/router';

export function ImportCategories() {
  const toast = useToast();
  const categories = useCategories();
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState<{ pct: number; label: string } | null>(null);
  const [error, setError] = useState('');
  const [paste, setPaste] = useState<string | null>(null);
  const [updateBudgets, setUpdateBudgets] = useState(true);
  const imgRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const existing = useMemo(() => {
    const roots = new Map<string, string>();
    const subs = new Set<string>();
    for (const c of categories ?? []) if (!c.parentId) roots.set(c.id, `${c.kind}|${normalizeName(c.name)}`);
    for (const c of categories ?? []) if (c.parentId && roots.has(c.parentId)) subs.add(`${roots.get(c.parentId)}|${normalizeName(c.name)}`);
    return { roots: new Set(roots.values()), subs };
  }, [categories]);

  function status(r: ParsedRow): 'nueva' | 'existe' {
    const rootKey = `${r.kind}|${normalizeName(r.category)}`;
    if (r.subcategory) return existing.subs.has(`${rootKey}|${normalizeName(r.subcategory)}`) ? 'existe' : 'nueva';
    return existing.roots.has(rootKey) ? 'existe' : 'nueva';
  }

  async function run(job: () => Promise<ParseResult>) {
    setError('');
    setBusy({ pct: 0, label: 'Leyendo…' });
    try {
      const res = await job();
      if (res.rows.length === 0) setError('No encontré categorías con valores. Prueba con una imagen más clara o pega el texto.');
      setRows(res.rows);
      setSkipped(res.skippedMovements);
      setPaste(null);
    } catch (e) {
      console.error(e);
      setError('No pude leer el archivo. ' + ((e as Error).message || ''));
    } finally {
      setBusy(null);
    }
  }

  function onFile(file: File) {
    if (file.type.startsWith('image/')) return run(() => parseImage(file, (pct, label) => setBusy({ pct, label })));
    if (/\.xlsx$/i.test(file.name)) return run(() => parseExcel(file));
    if (/\.(csv|txt|tsv)$/i.test(file.name) || file.type.startsWith('text/')) return run(() => parseTextFile(file));
    setError('Ese tipo de archivo no lo puedo leer. Usa una imagen, un Excel (.xlsx) o un .csv.');
  }

  const update = (key: string, patch: Partial<ParsedRow>) => setRows((rs) => rs?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null);
  const selected = rows?.filter((r) => r.include && r.category.trim()) ?? [];

  async function doImport() {
    const res = await importCategories(selected, { updateBudgets, guessIcon });
    toast(`Listo: ${res.created} creadas${res.updated ? `, ${res.updated} presupuestos actualizados` : ''}`);
    navigate('/categorias', { replace: true });
  }

  return (
    <div className="container">
      <div className="row">
        <a className="icon-btn" href="#/categorias" aria-label="Volver a categorías"><Icon name="back" size={20} /></a>
        <h1 className="h1">Importar categorías</h1>
      </div>

      {!rows && (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Sube una foto o captura de tu tabla, tu archivo de Excel, o pega el texto. Yo detecto las categorías, subcategorías
            (por ejemplo "Salidas - Alimentación") y sus valores, y te muestro todo para que lo revises antes de guardarlo.
          </p>
          <div className="grid-auto">
            <button className="card stack" style={{ textAlign: 'left', cursor: 'pointer' }} disabled={!!busy} onClick={() => imgRef.current?.click()}>
              <span className="ico tr"><Icon name="star" /></span>
              <strong>Foto o captura de pantalla</strong>
              <span className="small muted">Se lee aquí mismo en tu celular; la imagen no se envía a ningún lado.</span>
            </button>
            <button className="card stack" style={{ textAlign: 'left', cursor: 'pointer' }} disabled={!!busy} onClick={() => fileRef.current?.click()}>
              <span className="ico in"><Icon name="grid" /></span>
              <strong>Archivo de Excel o CSV</strong>
              <span className="small muted">Lee todas las hojas y las tablas, aunque estén una al lado de la otra.</span>
            </button>
            <button className="card stack" style={{ textAlign: 'left', cursor: 'pointer' }} disabled={!!busy} onClick={() => setPaste('')}>
              <span className="ico out"><Icon name="note" /></span>
              <strong>Pegar texto</strong>
              <span className="small muted">Copia las celdas en Excel o una lista de notas, una categoría por línea.</span>
            </button>
          </div>
          <input ref={imgRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
          <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />

          {paste !== null && (
            <div className="card stack">
              <label className="field"><span>Pega aquí</span>
                <textarea className="textarea" rows={8} value={paste} onChange={(e) => setPaste(e.target.value)} autoFocus
                  placeholder={'Gimnasio 120.000\nSalidas - Alimentación 100.000\nIngresos\nPanes 1.300.000'} />
              </label>
              <button className="btn primary block" disabled={!paste.trim()} onClick={() => run(async () => parsePastedText(paste))}>Leer texto</button>
            </div>
          )}

          {busy && (
            <div className="card stack" role="status" aria-live="polite">
              <strong>{busy.label}</strong>
              <div className="bar"><div style={{ width: Math.max(5, busy.pct) + '%', background: 'var(--primary-2)' }} /></div>
              <span className="small muted">La primera vez descarga el lector (unos 6 MB); después funciona sin internet.</span>
            </div>
          )}
        </>
      )}

      {error && <p role="alert" className="amount-out" style={{ margin: 0, fontWeight: 600 }}>{error}</p>}

      {rows && (
        <>
          <div className="card stack" style={{ gap: 6 }}>
            <strong>Encontré {rows.length} fila{rows.length === 1 ? '' : 's'}. Revisa y corrige lo que haga falta.</strong>
            <span className="small muted">Indica si cada tabla es de egresos o de ingresos, quita las filas que no quieras y corrige nombres o valores.</span>
            {skipped > 0 && <span className="small muted">Omití {skipped === 1 ? '1 fila que parece un movimiento' : `${skipped} filas que parecen movimientos`} (tienen fecha).</span>}
          </div>

          {[...new Set(rows.map((r) => r.group))].map((group, gi, groups) => {
            const list = rows.filter((r) => r.group === group);
            const ingresos = list.filter((r) => r.kind === 'ingreso').length;
            const kind = ingresos > list.length / 2 ? 'ingreso' : 'egreso';
            const total = list.filter((r) => r.include).reduce((s, r) => s + r.amount, 0);
            return (
              <section key={group} className="stack" style={{ gap: 8 }}>
                <div className="card stack" style={{ gap: 8, background: 'var(--surface-2)' }}>
                  <div className="between">
                    <strong>{groups.length > 1 ? `Tabla ${gi + 1}` : 'Lo que encontré'} · {list.length} fila{list.length === 1 ? '' : 's'}</strong>
                    <span className="small muted">{formatMoney(total)}</span>
                  </div>
                  <div className="seg" style={{ gridTemplateColumns: '1fr 1fr' }} role="group" aria-label="Tipo de toda la tabla">
                    {(['egreso', 'ingreso'] as const).map((k) => (
                      <button key={k} aria-pressed={kind === k} className={kind === k ? 'on ' + (k === 'egreso' ? 'amount-out' : 'amount-in') : ''}
                        onClick={() => setRows((rs) => rs?.map((r) => (r.group === group ? { ...r, kind: k } : r)) ?? null)}>
                        {k === 'egreso' ? 'Son egresos' : 'Son ingresos'}
                      </button>
                    ))}
                  </div>
                </div>
                {list.map((r) => {
                  const st = status(r);
                  return (
                    <div key={r.key} className="card stack" style={{ gap: 10, opacity: r.include ? 1 : 0.5 }}>
                      <div className="between">
                        <label className="row" style={{ gap: 8, fontWeight: 600 }}>
                          <input type="checkbox" checked={r.include} onChange={(e) => update(r.key, { include: e.target.checked })} style={{ width: 22, height: 22, accentColor: 'var(--primary)' }} />
                          Importar
                        </label>
                        <span className="small" style={{ fontWeight: 700, color: st === 'nueva' ? 'var(--primary)' : 'var(--gold-text)' }}>
                          {st === 'nueva' ? 'Nueva' : 'Ya existe'}
                        </span>
                        <button className={'chip ' + (r.kind === 'egreso' ? 'amount-out' : 'amount-in')} style={{ minHeight: 36 }}
                          aria-label={`Tipo: ${r.kind}. Cambiar`} onClick={() => update(r.key, { kind: r.kind === 'egreso' ? 'ingreso' : 'egreso' })}>
                          {r.kind === 'egreso' ? 'Egreso' : 'Ingreso'} ⇄
                        </button>
                      </div>
                      <div className="grid-2">
                        <label className="field"><span>Categoría</span>
                          <input className="input" value={r.category} onChange={(e) => update(r.key, { category: e.target.value })} />
                        </label>
                        <label className="field"><span>Subcategoría</span>
                          <input className="input" value={r.subcategory} placeholder="(ninguna)" onChange={(e) => update(r.key, { subcategory: e.target.value })} />
                        </label>
                      </div>
                      <MoneyInput label={r.kind === 'egreso' ? 'Presupuesto mensual' : 'Valor mensual esperado'} value={r.amount} onChange={(v) => update(r.key, { amount: Math.max(0, v) })} />
                    </div>
                  );
                })}
              </section>
            );
          })}

          <button className="btn block" style={{ borderStyle: 'dashed' }}
            onClick={() => setRows((rs) => [...(rs ?? []), { key: 'n' + Date.now(), group: rs?.[rs.length - 1]?.group ?? 0, include: true, kind: 'egreso', category: '', subcategory: '', amount: 0 }])}>
            + Agregar fila
          </button>

          <label className="between card" style={{ minHeight: 44 }}>
            <span style={{ fontWeight: 600 }}>Actualizar el presupuesto de las que ya existen</span>
            <input type="checkbox" checked={updateBudgets} onChange={(e) => setUpdateBudgets(e.target.checked)} style={{ width: 24, height: 24, accentColor: 'var(--primary)' }} />
          </label>

          <button className="btn primary lg block" disabled={selected.length === 0} onClick={doImport}>
            <Icon name="check" size={20} stroke={2.4} /> Importar {selected.length} categoría{selected.length === 1 ? '' : 's'}
          </button>
          <button className="btn ghost block" onClick={() => { setRows(null); setError(''); }}>Empezar de nuevo</button>
        </>
      )}
    </div>
  );
}
