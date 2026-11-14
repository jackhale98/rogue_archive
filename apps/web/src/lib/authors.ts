/** The first name in a catalog `authors` line ("Brian Walker; Brogue CE contributors" → "Brian Walker"). */
export function leadAuthor(authors: string): string {
  return authors.split(';')[0]!.trim();
}
