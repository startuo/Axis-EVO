import { useEffect, useState } from 'react';
import { RuntimeWorkbench } from './components/runtime/RuntimeWorkbench';
import { ThemeContext } from './lib/theme';
import './styles/workbench.css';
import './styles/cds-workbench.css';

export default function RuntimeEntry({ route, navigate }: {
  route: string;
  navigate: (path: string) => void;
}) {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme !== 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  return <ThemeContext.Provider value={dark}>
    <RuntimeWorkbench route={route} navigate={navigate} dark={dark} setDark={setDark} />
  </ThemeContext.Provider>;
}
