import { createRoot } from 'react-dom/client';
import { AppRouter } from './app/Router';
import { RootProviders } from './app/providers/RootProviders';
import './styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <RootProviders>
    <AppRouter />
  </RootProviders>,
);
