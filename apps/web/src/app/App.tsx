import { useEffect } from 'react';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { AboutPage } from '../routes/AboutPage.tsx';
import { GameDetailPage } from '../routes/GameDetailPage.tsx';
import { LibraryPage } from '../routes/LibraryPage.tsx';
import { NotFoundPage } from '../routes/NotFoundPage.tsx';
import { PlayPage } from '../routes/PlayPage.tsx';
import { SettingsPage } from '../routes/SettingsPage.tsx';
import { useRoute, type Route } from './router.ts';

function titleFor(route: Route): string {
  switch (route.name) {
    case 'settings':
      return 'Settings · Rogue Archive';
    case 'about':
      return 'About · Rogue Archive';
    default:
      return 'Rogue Archive';
  }
}

export function App() {
  const route = useRoute();

  useEffect(() => {
    if (route.name !== 'game' && route.name !== 'play') document.title = titleFor(route);
    if (route.name !== 'play') window.scrollTo({ top: 0 });
  }, [route]);

  // The play screen owns the whole viewport: no site chrome around a game.
  if (route.name === 'play') return <PlayPage gameId={route.id} />;

  return (
    <div className="site">
      <SiteHeader route={route} />
      <main id="main" tabIndex={-1}>
        {route.name === 'library' && <LibraryPage />}
        {route.name === 'game' && <GameDetailPage gameId={route.id} />}
        {route.name === 'settings' && <SettingsPage />}
        {route.name === 'about' && <AboutPage />}
        {route.name === 'not-found' && <NotFoundPage />}
      </main>
      <SiteFooter />
    </div>
  );
}
