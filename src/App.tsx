import { useEffect } from 'react';
import type { CategoryKind, TxType } from './db/types';
import { Icon } from './components/Icon';
import { ToastProvider } from './components/ui';
import { useSettings } from './lib/hooks';
import { navigate, useRoute } from './lib/router';
import { Accounts } from './screens/Accounts';
import { Categories } from './screens/Categories';
import { Entry } from './screens/Entry';
import { History } from './screens/History';
import { ImportTemplate } from './screens/ImportTemplate';
import { ImportCategories } from './screens/ImportCategories';
import { Home } from './screens/Home';
import { Onboarding } from './screens/Onboarding';
import { Settings } from './screens/Settings';

const NAV = [
  { path: '/', label: 'Inicio', icon: 'home' },
  { path: '/historial', label: 'Historial', icon: 'list' },
  { path: '/cuentas', label: 'Cuentas', icon: 'bank' },
  { path: '/categorias', label: 'Categorías', icon: 'grid' },
  { path: '/mas', label: 'Más', icon: 'settings' },
];

function useTheme(theme?: 'system' | 'light' | 'dark') {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme !== 'light' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0B1512' : '#0F5E4B');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const settings = useSettings();
  const route = useRoute();
  useTheme(settings?.theme);

  if (!settings) return null;
  if (!settings.onboarded) return <Onboarding />;

  const { path, params } = route;
  const isEntry = path === '/nuevo' || path === '/editar';
  const isImport = path === '/importar';
  const base = isEntry ? '/' : isImport ? '/categorias' : path;

  let page;
  switch (base) {
    case '/historial': page = <History />; break;
    case '/cuentas': page = <Accounts />; break;
    case '/categorias': page = <Categories key={params.get('tipo') ?? ''} initialKind={(params.get('tipo') as CategoryKind) || 'egreso'} />; break;
    case '/mas': page = <Settings />; break;
    case '/importar-categorias': page = <ImportCategories />; break;
    default: page = <Home />;
  }

  const tipo = params.get('tipo');
  const initialType: TxType = tipo === 'ingreso' || tipo === 'transferencia' ? tipo : 'egreso';

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Navegación principal">
        <div className="brand"><img src="./icon.svg" alt="" /> Monedi</div>
        {NAV.map((n) => (
          <a key={n.path} href={'#' + n.path} className={'side-link' + (base === n.path || (n.path === '/categorias' && base === '/importar-categorias') ? ' active' : '')} aria-current={base === n.path ? 'page' : undefined}>
            <Icon name={n.icon} size={20} /> {n.label}
          </a>
        ))}
        <button className="side-new" onClick={() => navigate('/nuevo')}>+ Nuevo movimiento</button>
      </nav>

      <main className="main">{page}</main>

      <nav className="tabbar" aria-label="Navegación principal">
        {[NAV[0], NAV[1]].map((n) => (
          <a key={n.path} href={'#' + n.path} className={'tab' + (base === n.path ? ' active' : '')} aria-current={base === n.path ? 'page' : undefined}>
            <Icon name={n.icon} size={24} /> {n.label}
          </a>
        ))}
        <button className="fab" aria-label="Registrar movimiento" onClick={() => navigate('/nuevo')}>
          <Icon name="plus" size={28} stroke={2.4} />
        </button>
        {[NAV[2], NAV[4]].map((n) => (
          <a key={n.path} href={'#' + n.path} className={'tab' + (base === n.path || (n.path === '/mas' && (base === '/categorias' || base === '/importar-categorias')) ? ' active' : '')}>
            <Icon name={n.icon} size={24} /> {n.label}
          </a>
        ))}
      </nav>

      {isImport && <ImportTemplate name={params.get('plantilla') ?? ''} />}
      {isEntry && <Entry key={path + (params.get('id') ?? tipo ?? '')} initialType={initialType} editId={path === '/editar' ? params.get('id') : null} />}
    </div>
  );
}
