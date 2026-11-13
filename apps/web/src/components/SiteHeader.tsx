import { href, type Route } from '../app/router.ts';

const NAV = [
  { name: 'library', label: 'Library', path: '/' },
  { name: 'settings', label: 'Settings', path: '/settings' },
  { name: 'about', label: 'About', path: '/about' },
] as const;

export function SiteHeader({ route }: { route: Route }) {
  return (
    <header className="site-header">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <a className="wordmark" href={href('/')}>
        <span className="wordmark__glyph" aria-hidden="true">
          @
        </span>
        Rogue Archive
      </a>
      <nav aria-label="Primary">
        <ul className="site-nav">
          {NAV.map((item) => {
            const current = route.name === item.name || (item.name === 'library' && route.name === 'game');
            return (
              <li key={item.name}>
                <a href={href(item.path)} aria-current={current ? 'page' : undefined}>
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
