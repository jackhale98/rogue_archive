import { catalog } from '../app/catalog.ts';
import { REPOSITORY_URL, repositoryFileUrl } from '../app/config.ts';
import { href } from '../app/router.ts';

export function AboutPage() {
  const launchable = catalog.games.filter((game) => game.license.report);
  return (
    <article className="page page--narrow prose">
      <h1 className="page-title">About Rogue Archive</h1>
      <p>
        Rogue Archive is an open-source library of classic roguelikes that run directly in the browser. Each
        game is compiled from its original, pinned source and adapted only at the edges—screen, input and
        saving—so the rules and character of the original stay intact.
      </p>
      <h2>Privacy</h2>
      <p>
        There is no backend. The site is static files; games run on your device; saves and settings stay in
        your browser's storage. There are no accounts, analytics or telemetry.
      </p>
      <h2>Credits and licenses</h2>
      <p>
        The games belong to their authors and communities and are distributed under their own licenses. Rogue
        Archive's own platform code is MIT-licensed; game ports keep their game's license.
      </p>
      <ul>
        {launchable.map((game) => (
          <li key={game.id}>
            <a href={href(`/games/${game.id}`)}>{game.title}</a> — {game.authors}. Code: {game.license.code}.
            Assets: {game.license.assets}.{' '}
            <a href={repositoryFileUrl(game.license.report!)}>Provenance report</a>
          </li>
        ))}
      </ul>
      <p>
        Interface typefaces: Fraunces and Inter, both under the SIL Open Font License.{' '}
        <a href={repositoryFileUrl('licenses/THIRD_PARTY_NOTICES.md')}>All third-party notices</a>.
      </p>
      <h2>Source and contributions</h2>
      <p>
        The complete source, build scripts and porting guides are at{' '}
        <a href={REPOSITORY_URL}>{REPOSITORY_URL.replace('https://', '')}</a>. Under the AGPL and GPL, the
        corresponding source for every game build is available there, pinned to the exact upstream revision
        shown on each game's page.
      </p>
    </article>
  );
}
