/** Public source repository for this site (licenses, contribution guide, issues). */
export const REPOSITORY_URL = 'https://github.com/jackhale98/rogue_archive';

export function repositoryFileUrl(path: string): string {
  return `${REPOSITORY_URL}/blob/main/${path}`;
}
