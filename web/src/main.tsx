import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
// tokens.css must come first so component CSS can override shared primitives.
import './styles/tokens.css';
import './styles/tailwind.css';
import App from './App';
import { applyAppearanceToDocument, getAppearanceSnapshot } from './lib/appearance';
import { saveTheme } from './lib/themePreference';

const RuntimeEntry = lazy(() => import('./retained/RuntimeEntry'));
const ResearchArchive = lazy(() => import('./retained/components/agent/ResearchArchive')
  .then(({ ResearchArchive }) => ({ default: ResearchArchive })));

const readRoute = () => window.location.hash.slice(1);
const isRuntime = (route: string) => route === '/runtime' || route.startsWith('/runtime/');

function RootRoutes() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const onHash = () => {
      const next = readRoute();
      if (isRuntime(route) && !isRuntime(next)) {
        // The old runtime loads its global theme only on demand.
        window.location.reload();
        return;
      }
      setRoute(next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [route]);
  const navigate = (next: string) => { window.location.hash = next; };

  if (route === '/research-demo' || isRuntime(route)) {
    return <Suspense fallback={<div className="boot-screen" role="status">正在打开工作台…</div>}>
      {isRuntime(route) ? <RuntimeEntry route={route} navigate={navigate} />
        : <div className="research-route"><ResearchArchive navigate={navigate} /></div>}
    </Suspense>;
  }
  return <App />;
}

const startupAppearance = getAppearanceSnapshot();
applyAppearanceToDocument(startupAppearance);
saveTheme(startupAppearance.resolvedTheme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootRoutes />
  </StrictMode>,
);
