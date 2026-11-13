import { href } from '../app/router.ts';

export function NotFoundPage() {
  return (
    <section className="page page--narrow">
      <h1 className="page-title">Nothing down here</h1>
      <p>This passage leads nowhere. The library is back up the stairs.</p>
      <p>
        <a className="button button--primary" href={href('/')}>
          Return to the library
        </a>
      </p>
    </section>
  );
}
