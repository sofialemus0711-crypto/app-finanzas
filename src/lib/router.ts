import { useEffect, useState } from 'react';

/**
 * Enrutador por "hash" (#/ruta?param=valor).
 * Funciona en cualquier hosting estático y permite abrir directo #/nuevo desde un atajo.
 */
export interface Route {
  path: string;
  params: URLSearchParams;
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', params: new URLSearchParams(query) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/** Cuántas pantallas se han abierto dentro de la app (para saber si "atrás" es seguro). */
let depth = 0;

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const hash = '#' + to;
  if (!opts.replace) depth += 1;
  if (opts.replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = to;
  }
}

/** Vuelve atrás si se llegó desde la app; si no (p. ej. abierto desde un atajo), va al inicio. */
export function goBack(fallback = '/'): void {
  if (depth > 0) {
    depth -= 1;
    history.back();
  } else {
    navigate(fallback, { replace: true });
  }
}
