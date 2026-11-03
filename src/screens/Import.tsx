import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../db/db';
import type { Account, Category, Transaction } from '../db/types';
import { Icon } from '../components/Icon';
import { MoneyInput, useToast } from '../components/ui';
import { buildIndex, learn, normalize, resolveCategoryText, suggest, type ClassifierIndex } from '../lib/classify';
import { fromISODate } from '../lib/dates';

const dayMonth = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' });
const yearNow = new Date().getFullYear();
const compactDate = (iso: string) => {
  const d = fromISODate(iso);
  const s = dayMonth.format(d).replace('.', '').replace(' de ', ' ');
  return d.getFullYear() === yearNow ? s : `${s} ${String(d.getFullYear()).slice(2)}`;
};
import { useAccounts, useCategories, useSettings, useTransactions } from '../lib/hooks';
import { guessIcon, normalizeName, type ParsedMovement, type ParsedRow } from '../lib/importParse';
import { parseExcel, parseImage, parsePastedText, parseTextFile, type ImportResult } from '../lib/importSources';
import { formatMoney } from '../lib/money';
import { importCategories, importTransactions } from '../lib/repo';
import { navigate } from '../lib/router';

type Source = 'documento' | 'alta' | 'media' | 'aprendida' | 'manual' | 'ninguna';
interface MovRow extends ParsedMovement {
  include: boolean;
  kind: 'ingreso' | 'egreso';
  /** "catId|subId", "new:Nombre" o "" (sin categoría) */
  choice: string;
  accountId: string;
  source: Source;
  duplicate: boolean;
}

const SOURCE_LABEL: Record<Source, string> = {
  documento: 'Del documento',
  alta: 'Deducida por la descripción',
  media: 'Deducida · revisa',
  aprendida: 'Igual a otra que corregiste',
  manual: 'Elegida por ti',
  ninguna: 'Elige una categoría',
};

function resolveRows(movs: ParsedMovement[], categories: Category[], accounts: Account[], index: ClassifierIndex, existing: Transaction[], prev?: MovRow[]): MovRow[] {
  const dupKeys = new Set(existing.map((t) => `${t.date}|${t.amount}|${normalize(t.note)}`));
  const prevBy = new Map((prev ?? []).map((r) => [r.key, r]));
  // Los movimientos que ya traen categoría enseñan a clasificar los demás.
  for (const m of movs) {
    if (!m.categoryText || !m.description) continue;
    const c = resolveCategoryText(m.categoryText, m.subcategoryText, m.type, categories);
    if (c) learn(index, m.description, c);
  }
  return movs.map((m) => {
    const p = prevBy.get(m.key);
    if (p && p.source === 'manual') return p;
    const acc = m.accountText ? accounts.find((a) => normalize(a.name) === normalize(m.accountText) || normalize(m.accountText).includes(normalize(a.name))) : undefined;
    let kind: 'ingreso' | 'egreso' = m.type ?? 'egreso';
    let choice = '';
    let source: Source = 'ninguna';
    if (m.categoryText) {
      const c = resolveCategoryText(m.categoryText, m.subcategoryText, m.type, categories) ?? resolveCategoryText(m.categoryText, m.subcategoryText, null, categories);
      if (c) {
        choice = `${c.categoryId}|${c.subcategoryId ?? ''}`;
        kind = c.kind;
      } else {
        choice = 'new:' + [m.categoryText, m.subcategoryText].filter(Boolean).join(' - ');
      }
      source = 'documento';
    } else {
      const s = suggest(m.description, m.type, index);
      if (s) {
        choice = `${s.categoryId}|${s.subcategoryId ?? ''}`;
        kind = s.kind;
        source = s.confidence;
      }
    }
    const duplicate = dupKeys.has(`${m.date}|${m.amount}|${normalize(m.description)}`);
    return {
      ...m, kind, choice, source, duplicate,
      include: p ? p.include : !duplicate,
      accountId: p?.accountId || acc?.id || '',
    };
  });
}

export function Import() {
  const toast = useToast();
  const settings = useSettings();
  const categories = useCategories();
  const accountsAll = useAccounts();
  const txs = useTransactions();
  const accounts = useMemo(() => (accountsAll ?? []).filter((a) => !a.archived), [accountsAll]);

  const [result, setResult] = useState<{ cats: ParsedRow[]; movs: ParsedMovement[] } | null>(null);
  const [catRows, setCatRows] = useState<ParsedRow[]>([]);
  const [movRows, setMovRows] = useState<MovRow[]>([]);
  const [tab, setTab] = useState<'movimientos' | 'categorias'>('movimientos');
  const [busy, setBusy] = useState<{ pct: number; label: string } | null>(null);
  const [error, setError] = useState('');
  const [paste, setPaste] = useState<string | null>(null);
  const [updateBudgets, setUpdateBudgets] = useState(true);
  const [defaultAccount, setDefaultAccount] = useState('');
  const [onlyReview, setOnlyReview] = useState(false);
  const [limit, setLimit] = useState(80);
  const [saving, setSaving] = useState(false);
  const imgRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const indexRef = useRef<ClassifierIndex | null>(null);

  useEffect(() => {
    if (!defaultAccount && accounts.length) setDefaultAccount((accounts.find((a) => a.id === settings?.lastAccountId) ?? accounts[0]).id);
  }, [accounts, defaultAccount, settings]);

  // Cuando hay resultado (o cambian las categorías), se clasifican los movimientos.
  useEffect(() => {
    if (!result || !categories || !txs || !accountsAll) return;
    indexRef.current = buildIndex(categories, txs);
    setMovRows((prev) => resolveRows(result.movs, categories, accountsAll, indexRef.current!, txs, prev));
  }, [result, categories, txs, accountsAll]);

  const existing = useMemo(() => {
    const roots = new Map<string, string>();
    const subs = new Set<string>();
    for (const c of categories ?? []) if (!c.parentId) roots.set(c.id, `${c.kind}|${normalizeName(c.name)}`);
    for (const c of categories ?? []) if (c.parentId && roots.has(c.parentId)) subs.add(`${roots.get(c.parentId)}|${normalizeName(c.name)}`);
    return { roots: new Set(roots.values()), subs };
  }, [categories]);
  const catStatus = (r: ParsedRow): 'nueva' | 'existe' => {
    const rootKey = `${r.kind}|${normalizeName(r.category)}`;
    if (r.subcategory) return existing.subs.has(`${rootKey}|${normalizeName(r.subcategory)}`) ? 'existe' : 'nueva';
    return existing.roots.has(rootKey) ? 'existe' : 'nueva';
  };

  const options = useMemo(() => {
    const cats = categories ?? [];
    const build = (kind: 'egreso' | 'ingreso') =>
      cats.filter((c) => c.kind === kind && !c.parentId).flatMap((r) => {
        const subs = cats.filter((c) => c.parentId === r.id);
        if (!subs.length) return [{ value: `${r.id}|`, label: r.name, kind }];
        return [{ value: `${r.id}|`, label: `${r.name} (sin subcategoría)`, kind }, ...subs.map((s) => ({ value: `${r.id}|${s.id}`, label: `${r.name} › ${s.name}`, kind }))];
      });
    return { egreso: build('egreso'), ingreso: build('ingreso') };
  }, [categories]);

  async function run(job: () => Promise<ImportResult>) {
    setError('');
    setBusy({ pct: 0, label: 'Leyendo…' });
    try {
      const res = await job();
      if (res.rows.length === 0 && res.movements.length === 0) {
        setError('No encontré categorías ni movimientos. Prueba con una imagen más clara, otro archivo o pega el texto.');
        return;
      }
      setCatRows(res.rows);
      setResult({ cats: res.rows, movs: res.movements });
      setTab(res.movements.length ? 'movimientos' : 'categorias');
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

  const updateCat = (key: string, patch: Partial<ParsedRow>) => setCatRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const updateMov = (key: string, patch: Partial<MovRow>) => setMovRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /** La persona eligió una categoría: se aprende y se aplica a las demás filas con la misma descripción. */
  function chooseCategory(row: MovRow, value: string) {
    const opt = [...options.egreso, ...options.ingreso].find((o) => o.value === value);
    const kind = opt?.kind ?? row.kind;
    const idx = indexRef.current;
    if (idx && opt) {
      const [categoryId, sub] = value.split('|');
      learn(idx, row.description, { categoryId, subcategoryId: sub || null, kind });
    }
    const desc = normalize(row.description);
    setMovRows((rs) =>
      rs.map((r) => {
        if (r.key === row.key) return { ...r, choice: value, kind, source: 'manual' };
        if (desc && normalize(r.description) === desc && r.source !== 'manual' && r.source !== 'documento') return { ...r, choice: value, kind, source: 'aprendida' };
        if (idx && r.source === 'ninguna') {
          const s = suggest(r.description, null, idx);
          if (s) return { ...r, choice: `${s.categoryId}|${s.subcategoryId ?? ''}`, kind: s.kind, source: 'aprendida' };
        }
        return r;
      }),
    );
  }

  const newCatRows = catRows.filter((r) => r.include && r.category.trim() && catStatus(r) === 'nueva');
  const movSelected = movRows.filter((r) => r.include);
  const movReady = movSelected.filter((r) => r.choice && (r.accountId || defaultAccount));
  const movMissing = movSelected.length - movReady.length;
  const catSelected = catRows.filter((r) => r.include && r.category.trim());

  async function importCatsNow() {
    const res = await importCategories(catSelected, { updateBudgets, guessIcon });
    toast(`${res.created} categorías creadas${res.updated ? `, ${res.updated} presupuestos actualizados` : ''}`);
    setCatRows((rs) => rs.map((r) => ({ ...r, include: false })));
  }

  async function doImport() {
    if (saving) return;
    setSaving(true);
    try {
      // 1) Categorías: las de la pestaña de categorías + las nuevas que traen los movimientos
      const fromMovs: ParsedRow[] = movReady
        .filter((r) => r.choice.startsWith('new:'))
        .map((r) => {
          const [category, ...sub] = r.choice.slice(4).split(' - ');
          return { key: r.key, group: 0, include: true, kind: r.kind, category, subcategory: sub.join(' - '), amount: 0 };
        });
      const cres = await importCategories([...catSelected, ...fromMovs], { updateBudgets, guessIcon });
      // 2) Movimientos
      const cats = await db.categories.toArray();
      const rows = movReady.map((r) => {
        let categoryId = '';
        let subcategoryId: string | null = null;
        if (r.choice.startsWith('new:')) {
          const c = resolveCategoryText(r.choice.slice(4), '', r.kind, cats);
          if (c) { categoryId = c.categoryId; subcategoryId = c.subcategoryId; }
        } else {
          const [a, b] = r.choice.split('|');
          categoryId = a;
          subcategoryId = b || null;
        }
        return { date: r.date, description: r.description, amount: r.amount, type: r.kind, accountId: r.accountId || defaultAccount, categoryId, subcategoryId };
      });
      const tres = rows.length ? await importTransactions(rows) : { added: 0, skipped: 0 };
      const parts = [];
      if (tres.added) parts.push(`${tres.added} movimientos`);
      if (cres.created) parts.push(`${cres.created} categorías`);
      toast(parts.length ? `Importado: ${parts.join(' y ')}` : 'No había nada nuevo para importar');
      navigate(tres.added ? '/historial' : '/categorias', { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const visibleMovs = (onlyReview ? movRows.filter((r) => r.include && (!r.choice || r.source === 'media' || r.source === 'ninguna')) : movRows).slice(0, limit);
  const total = { inc: 0, exp: 0 };
  for (const r of movSelected) r.kind === 'ingreso' ? (total.inc += r.amount) : (total.exp += r.amount);

  return (
    <div className="container">
      <div className="row">
        <a className="icon-btn" href="#/categorias" aria-label="Volver"><Icon name="back" size={20} /></a>
        <h1 className="h1">Importar</h1>
      </div>

      {!result && (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Sube una foto o captura, un Excel o un CSV, o pega texto. Detecto tus <strong>categorías</strong> (con presupuestos)
            y tus <strong>movimientos</strong> (fecha, descripción y valor), y deduzco la categoría de cada movimiento por su descripción.
            Antes de guardar, te muestro todo para revisarlo.
          </p>
          <div className="grid-auto">
            <button className="card stack" style={{ textAlign: 'left' }} disabled={!!busy} onClick={() => imgRef.current?.click()}>
              <span className="ico tr"><Icon name="star" /></span>
              <strong>Foto o captura de pantalla</strong>
              <span className="small muted">Se lee aquí mismo en tu celular; la imagen no se envía a ningún lado.</span>
            </button>
            <button className="card stack" style={{ textAlign: 'left' }} disabled={!!busy} onClick={() => fileRef.current?.click()}>
              <span className="ico in"><Icon name="grid" /></span>
              <strong>Archivo de Excel o CSV</strong>
              <span className="small muted">Lee todas las hojas: tablas de categorías y tablas de movimientos (Fecha, Descripción, Valor…).</span>
            </button>
            <button className="card stack" style={{ textAlign: 'left' }} disabled={!!busy} onClick={() => setPaste('')}>
              <span className="ico out"><Icon name="note" /></span>
              <strong>Pegar texto</strong>
              <span className="small muted">Copia celdas de Excel o escribe líneas como “03/11 Almuerzo U 18.000”.</span>
            </button>
          </div>
          <input ref={imgRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
          <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />

          {paste !== null && (
            <div className="card stack">
              <label className="field"><span>Pega aquí</span>
                <textarea className="textarea" rows={8} value={paste} onChange={(e) => setPaste(e.target.value)} autoFocus
                  placeholder={'03/11/2026 Almuerzo U 18.000\n02/11/2026 Uber 12.500\n01/11/2026 Venta panes +120.000'} />
              </label>
              <button className="btn primary block" disabled={!paste.trim()} onClick={() => run(async () => parsePastedText(paste))}>Leer texto</button>
            </div>
          )}

          {busy && (
            <div className="card stack" role="status" aria-live="polite">
              <strong>{busy.label}</strong>
              <div className="bar"><div style={{ width: Math.max(5, busy.pct) + '%', background: 'var(--primary-2)' }} /></div>
              <span className="small muted">Con imágenes, la primera vez descarga el lector (unos 6 MB); después funciona sin internet.</span>
            </div>
          )}
        </>
      )}

      {error && <p role="alert" className="amount-out" style={{ margin: 0, fontWeight: 600 }}>{error}</p>}

      {result && (
        <>
          <div className="seg" style={{ gridTemplateColumns: '1fr 1fr' }} role="tablist">
            <button role="tab" aria-selected={tab === 'movimientos'} className={tab === 'movimientos' ? 'on' : ''} onClick={() => setTab('movimientos')}>
              Movimientos ({movRows.length})
            </button>
            <button role="tab" aria-selected={tab === 'categorias'} className={tab === 'categorias' ? 'on' : ''} onClick={() => setTab('categorias')}>
              Categorías ({catRows.length})
            </button>
          </div>

          {tab === 'movimientos' && (
            movRows.length === 0 ? (
              <div className="empty card"><p>No encontré movimientos (filas con fecha y valor) en este documento.</p></div>
            ) : (
              <>
                {newCatRows.length > 0 && (
                  <div className="card stack" style={{ background: 'var(--gold-soft)', borderColor: 'transparent' }}>
                    <strong>El documento también trae {newCatRows.length} categoría{newCatRows.length === 1 ? '' : 's'} nueva{newCatRows.length === 1 ? '' : 's'}.</strong>
                    <span className="small">Impórtalas primero y clasifico mejor los movimientos.</span>
                    <button className="btn block" onClick={importCatsNow}>Importar categorías ahora</button>
                  </div>
                )}
                <div className="card stack" style={{ gap: 10 }}>
                  <div className="between wrap">
                    <strong>{movSelected.length} de {movRows.length} seleccionados</strong>
                    <span className="small"><span className="amount-in">{formatMoney(total.inc)}</span> · <span className="amount-out">{formatMoney(-total.exp)}</span></span>
                  </div>
                  {movRows.some((r) => r.duplicate) && <span className="small muted">Desmarqué {movRows.filter((r) => r.duplicate).length} que ya estaban registrados.</span>}
                  {accounts.length > 0 && (
                    <label className="field"><span>Cuenta para los que no dicen cuenta</span>
                      <select className="select" value={defaultAccount} onChange={(e) => setDefaultAccount(e.target.value)}>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="between" style={{ minHeight: 40 }}>
                    <span style={{ fontWeight: 600 }}>Ver solo los que debo revisar ({movSelected.filter((r) => !r.choice || r.source === 'media' || r.source === 'ninguna').length})</span>
                    <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} style={{ width: 22, height: 22, accentColor: 'var(--primary)' }} />
                  </label>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="chip" onClick={() => setMovRows((rs) => rs.map((r) => ({ ...r, include: true })))}>Marcar todos</button>
                    <button className="chip" onClick={() => setMovRows((rs) => rs.map((r) => ({ ...r, include: false })))}>Desmarcar todos</button>
                  </div>
                </div>

                {visibleMovs.map((r) => {
                  const warn = !r.choice || r.source === 'ninguna' || r.source === 'media';
                  return (
                    <div key={r.key} className="card stack" style={{ gap: 8, padding: 12, opacity: r.include ? 1 : 0.55, borderColor: r.include && !r.choice ? 'var(--expense)' : undefined }}>
                      <div className="row" style={{ gap: 8 }}>
                        <input type="checkbox" aria-label="Importar este movimiento" checked={r.include} onChange={(e) => updateMov(r.key, { include: e.target.checked })}
                          style={{ width: 22, height: 22, accentColor: 'var(--primary)', flex: 'none' }} />
                        <span className="small muted" style={{ flex: 'none', width: 46, lineHeight: 1.2 }}>{compactDate(r.date)}</span>
                        <input className="input" style={{ minHeight: 40, fontSize: 14, padding: '0 10px' }} value={r.description} placeholder="Sin descripción"
                          aria-label="Descripción" onChange={(e) => updateMov(r.key, { description: e.target.value })} />
                        <button className={'chip ' + (r.kind === 'ingreso' ? 'amount-in' : 'amount-out')} style={{ flex: 'none', minHeight: 40, fontWeight: 700 }}
                          aria-label={`${r.kind === 'ingreso' ? 'Ingreso' : 'Egreso'} de ${formatMoney(r.amount)}. Cambiar tipo`}
                          onClick={() => updateMov(r.key, { kind: r.kind === 'ingreso' ? 'egreso' : 'ingreso', choice: '', source: 'ninguna' })}>
                          {r.kind === 'ingreso' ? '+' : '−'} {formatMoney(r.amount).replace('$ ', '')}
                        </button>
                      </div>
                      <div className="row wrap" style={{ gap: 8 }}>
                        <select className="select grow" style={{ minHeight: 40, fontSize: 14, flexBasis: 200 }} value={r.choice} aria-label="Categoría"
                          onChange={(e) => chooseCategory(r, e.target.value)}>
                          <option value="">Elige categoría…</option>
                          {r.choice.startsWith('new:') && <option value={r.choice}>Nueva: {r.choice.slice(4)}</option>}
                          <optgroup label="Egresos">{options.egreso.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
                          <optgroup label="Ingresos">{options.ingreso.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
                        </select>
                        {accounts.length > 1 && (
                          <select className="select" style={{ minHeight: 40, fontSize: 14, width: 'auto', flex: '0 1 150px' }} value={r.accountId || defaultAccount} aria-label="Cuenta"
                            onChange={(e) => updateMov(r.key, { accountId: e.target.value })}>
                            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        )}
                      </div>
                      <span className="small" style={{ fontWeight: 600, color: r.duplicate ? 'var(--gold-text)' : warn ? 'var(--expense)' : 'var(--primary)' }}>
                        {r.duplicate ? 'Parece que ya está registrado' : r.choice.startsWith('new:') ? 'Se creará esta categoría' : SOURCE_LABEL[r.source]}
                      </span>
                    </div>
                  );
                })}
                {(onlyReview ? movRows.filter((r) => r.include && (!r.choice || r.source === 'media' || r.source === 'ninguna')).length : movRows.length) > limit && (
                  <button className="btn block" onClick={() => setLimit((l) => l + 80)}>Ver más</button>
                )}
              </>
            )
          )}

          {tab === 'categorias' && (
            catRows.length === 0 ? (
              <div className="empty card"><p>No encontré tablas de categorías en este documento.</p></div>
            ) : (
              <>
                <span className="small muted">Indica si cada tabla es de egresos o de ingresos, quita las filas que no quieras y corrige nombres o valores.</span>
                {[...new Set(catRows.map((r) => r.group))].map((group, gi, groups) => {
                  const list = catRows.filter((r) => r.group === group);
                  const kind = list.filter((r) => r.kind === 'ingreso').length > list.length / 2 ? 'ingreso' : 'egreso';
                  return (
                    <section key={group} className="stack" style={{ gap: 8 }}>
                      <div className="card stack" style={{ gap: 8, background: 'var(--surface-2)' }}>
                        <div className="between">
                          <strong>{groups.length > 1 ? `Tabla ${gi + 1}` : 'Lo que encontré'} · {list.length} fila{list.length === 1 ? '' : 's'}</strong>
                          <span className="small muted">{formatMoney(list.filter((r) => r.include).reduce((s, r) => s + r.amount, 0))}</span>
                        </div>
                        <div className="seg" style={{ gridTemplateColumns: '1fr 1fr' }} role="group" aria-label="Tipo de toda la tabla">
                          {(['egreso', 'ingreso'] as const).map((k) => (
                            <button key={k} aria-pressed={kind === k} className={kind === k ? 'on ' + (k === 'egreso' ? 'amount-out' : 'amount-in') : ''}
                              onClick={() => setCatRows((rs) => rs.map((r) => (r.group === group ? { ...r, kind: k } : r)))}>
                              {k === 'egreso' ? 'Son egresos' : 'Son ingresos'}
                            </button>
                          ))}
                        </div>
                      </div>
                      {list.map((r) => {
                        const st = catStatus(r);
                        return (
                          <div key={r.key} className="card stack" style={{ gap: 10, opacity: r.include ? 1 : 0.5 }}>
                            <div className="between">
                              <label className="row" style={{ gap: 8, fontWeight: 600 }}>
                                <input type="checkbox" checked={r.include} onChange={(e) => updateCat(r.key, { include: e.target.checked })} style={{ width: 22, height: 22, accentColor: 'var(--primary)' }} />
                                Importar
                              </label>
                              <span className="small" style={{ fontWeight: 700, color: st === 'nueva' ? 'var(--primary)' : 'var(--gold-text)' }}>{st === 'nueva' ? 'Nueva' : 'Ya existe'}</span>
                              <button className={'chip ' + (r.kind === 'egreso' ? 'amount-out' : 'amount-in')} style={{ minHeight: 36 }}
                                aria-label={`Tipo: ${r.kind}. Cambiar`} onClick={() => updateCat(r.key, { kind: r.kind === 'egreso' ? 'ingreso' : 'egreso' })}>
                                {r.kind === 'egreso' ? 'Egreso' : 'Ingreso'} ⇄
                              </button>
                            </div>
                            <div className="grid-2">
                              <label className="field"><span>Categoría</span>
                                <input className="input" value={r.category} onChange={(e) => updateCat(r.key, { category: e.target.value })} />
                              </label>
                              <label className="field"><span>Subcategoría</span>
                                <input className="input" value={r.subcategory} placeholder="(ninguna)" onChange={(e) => updateCat(r.key, { subcategory: e.target.value })} />
                              </label>
                            </div>
                            <MoneyInput label={r.kind === 'egreso' ? 'Presupuesto mensual' : 'Valor mensual esperado'} value={r.amount} onChange={(v) => updateCat(r.key, { amount: Math.max(0, v) })} />
                          </div>
                        );
                      })}
                    </section>
                  );
                })}
                <button className="btn block" style={{ borderStyle: 'dashed' }}
                  onClick={() => setCatRows((rs) => [...rs, { key: 'n' + Date.now(), group: rs[rs.length - 1]?.group ?? 0, include: true, kind: 'egreso', category: '', subcategory: '', amount: 0 }])}>
                  + Agregar fila
                </button>
                <label className="between card" style={{ minHeight: 44 }}>
                  <span style={{ fontWeight: 600 }}>Actualizar el presupuesto de las que ya existen</span>
                  <input type="checkbox" checked={updateBudgets} onChange={(e) => setUpdateBudgets(e.target.checked)} style={{ width: 24, height: 24, accentColor: 'var(--primary)' }} />
                </label>
              </>
            )
          )}

          {movMissing > 0 && <p className="small amount-out" style={{ margin: 0, fontWeight: 600 }}>{movMissing} movimiento{movMissing === 1 ? '' : 's'} sin categoría no se importará{movMissing === 1 ? '' : 'n'} hasta que les elijas una.</p>}
          {accounts.length === 0 && movSelected.length > 0 && <p className="small amount-out" style={{ margin: 0 }}>Primero crea una cuenta para poder importar movimientos.</p>}
          <button className="btn primary lg block" disabled={saving || (catSelected.length === 0 && movReady.length === 0)} onClick={doImport}>
            <Icon name="check" size={20} stroke={2.4} />
            Importar {[movReady.length ? `${movReady.length} movimiento${movReady.length === 1 ? '' : 's'}` : '', catSelected.length ? `${catSelected.length} categoría${catSelected.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' y ') || 'todo'}
          </button>
          <button className="btn ghost block" onClick={() => { setResult(null); setCatRows([]); setMovRows([]); setError(''); }}>Empezar de nuevo</button>
        </>
      )}
    </div>
  );
}
