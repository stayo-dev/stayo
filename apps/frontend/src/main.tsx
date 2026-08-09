import { createRoot } from 'react-dom/client';
import { AppRouter } from './app/Router';
import { RootProviders } from './app/providers/RootProviders';
import './styles/globals.css';

/**
 * Hand the boot splash (#stayo-boot in index.html) over to React.
 *
 * Two rAFs put us after React's first commit and its paint, so whatever the
 * app renders first — usually <StayoLoadingScreen /> behind a route's lazy
 * chunk — is already on screen underneath. Both draw the same loading screen,
 * so the crossfade reads as one continuous surface rather than a restart.
 */
function dismissBootSplash() {
  const boot = document.getElementById('stayo-boot');
  if (!boot) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      boot.dataset.leaving = 'true';
      boot.addEventListener('transitionend', () => boot.remove(), { once: true });
      // transitionend never fires if the tab is backgrounded mid-fade.
      setTimeout(() => boot.remove(), 600);
    }),
  );
}

createRoot(document.getElementById('root')!).render(
  <RootProviders>
    <AppRouter />
  </RootProviders>,
);

dismissBootSplash();
