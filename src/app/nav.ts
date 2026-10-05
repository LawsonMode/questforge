// Hash routes (the e2e harness and the menu rely on these):
//   #/                          main menu
//   #/play/<projectId|sample>   title screen -> file select -> game
//   #/playtest/<projectId|sample>?w=<worldId>&r=<roomId>&x=<px>&y=<px>   straight into gameplay
//   #/edit/<projectId|sample>   editor ("sample" opens an unsaved copy of the sample adventure)
//   #/gallery                   asset gallery (default assets)
//   #/learning                  My Learning: proposed skill levels, evidence, export
// Any other non-empty path is 'notFound' (the app shows a friendly page).
/** A parsed hash route. */
export interface Route {
  view: 'menu' | 'play' | 'playtest' | 'edit' | 'gallery' | 'learning' | 'notFound';
  id?: string;
  params: URLSearchParams;
  /** The unrecognised path, for 'notFound'. */
  path?: string;
}

/** Navigation service handed to views. */
export interface Nav {
  go(hash: string): void;
  current(): Route;
}

/** Parse a location hash into a Route (a malformed address is 'notFound', never an exception). */
export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [path = '', query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  const view = parts[0];
  const notFound: Route = { view: 'notFound', params, path: `/${parts.join('/')}` };
  if (view === 'play' || view === 'playtest' || view === 'edit') {
    const id = safeDecode(parts[1] ?? 'sample');
    return id === null ? notFound : { view, id, params };
  }
  if (view === 'gallery') return { view: 'gallery', params };
  if (view === 'learning') return { view: 'learning', params };
  if (view === undefined || view === 'menu') return { view: 'menu', params };
  return notFound;
}

/** decodeURIComponent, or null for a broken percent-escape. */
function safeDecode(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}
