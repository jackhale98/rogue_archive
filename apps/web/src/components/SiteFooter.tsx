import { REPOSITORY_URL, repositoryFileUrl } from '../app/config.ts';
import { href } from '../app/router.ts';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>
        Games run entirely in your browser. No accounts, no tracking; saves stay on this device unless you
        export them.
      </p>
      <ul className="site-footer__links">
        <li>
          <a href={href('/about')}>About & credits</a>
        </li>
        <li>
          <a href={REPOSITORY_URL}>Source code</a>
        </li>
        <li>
          <a href={repositoryFileUrl('CONTRIBUTING.md')}>Contribute a port</a>
        </li>
        <li>
          <a href={repositoryFileUrl('licenses/THIRD_PARTY_NOTICES.md')}>Licenses</a>
        </li>
      </ul>
    </footer>
  );
}
