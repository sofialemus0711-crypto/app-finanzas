import { useEffect, useState } from 'react';
import { Sheet, useToast } from '../components/ui';
import { parseBackup, restoreBackup, type BackupFile } from '../lib/backup';
import { navigate } from '../lib/router';

/** Abre #/importar?plantilla=nombre para agregar una plantilla publicada junto a la app (solo agrega, nunca borra). */
export function ImportTemplate({ name }: { name: string }) {
  const toast = useToast();
  const [data, setData] = useState<BackupFile | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!/^[a-z0-9-]+$/.test(name)) {
      setError('Plantilla no válida.');
      return;
    }
    fetch(`./plantillas/${name}.json`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('No se encontró la plantilla.'))))
      .then((t) => setData(parseBackup(t)))
      .catch((e: Error) => setError(e.message));
  }, [name]);

  const close = () => navigate('/categorias', { replace: true });

  return (
    <Sheet title="Importar categorías" onClose={close}>
      {error && <p role="alert" className="amount-out">{error}</p>}
      {!data && !error && <p>Cargando…</p>}
      {data && (
        <>
          <p style={{ margin: 0 }}>
            Se agregarán {data.categories.filter((c) => !c.parentId).length} categorías y {data.categories.filter((c) => c.parentId).length} subcategorías, con sus presupuestos. No se borra nada de lo que ya tienes.
          </p>
          <button className="btn primary lg block" onClick={async () => { await restoreBackup(data, 'merge'); toast('Categorías importadas'); close(); }}>
            Importar
          </button>
          <button className="btn ghost block" onClick={close}>Cancelar</button>
        </>
      )}
    </Sheet>
  );
}
