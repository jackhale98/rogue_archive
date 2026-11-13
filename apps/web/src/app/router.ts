import { useEffect, useState } from 'react';

export type Route =
  | { name: 'library' }
  | { name: 'game'; id: string }
  | { name: 'play'; id: string }
  | { name: 'settings' }
  | { name: 'about' }
  | { name: 'not-found'; path: string };

/** Hash routes keep deep links working on GitHub Pages without a server fallback. */
export function parseRoute(hash: string): Route {
  const path = decodeURIComponent(hash.replace(/^#/, '')) || '/';
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'library' };
  if (parts[0] === 'games' && parts[1] && parts.length === 2) return { name: 'game', id: parts[1] };
  if (parts[0] === 'play' && parts[1] && parts.length === 2) return { name: 'play', id: parts[1] };
  if (parts[0] === 'settings' && parts.length === 1) return { name: 'settings' };
  if (parts[0] === 'about' && parts.length === 1) return { name: 'about' };
  return { name: 'not-found', path };
}

export function href(path: string): string {
  return `#${path}`;
}

export function navigate(path: string): void {
  window.location.hash = path;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
