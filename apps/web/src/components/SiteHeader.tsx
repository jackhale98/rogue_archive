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
      <a className="wordmark" href={href('/')} aria-label="Rogue Archive">
        <img
          className="wordmark__mark wordmark__mark--dark"
          src={`${import.meta.env.BASE_URL}icons/mark-144.png`}
          alt=""
        />
        <img
          className="wordmark__mark wordmark__mark--light"
          src={`${import.meta.env.BASE_URL}icons/mark-light-144.png`}
          alt=""
        />
        <span className="wordmark__text" aria-hidden="true">
          <span className="wordmark__rogue">Rogue</span>
          <span className="wordmark__archive">Archive</span>
        </span>
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
