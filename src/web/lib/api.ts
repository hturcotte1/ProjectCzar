/**
 * The one way screens talk to the server. Sends the CSRF token on every change, parses errors
 * into ApiError (whose message is the server's plain-language text), and signals sign-out.
 */
let csrfToken = '';

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public problems: { field: string; message: string }[] = [],
    /**
     * Tempo itself answered with one of its own error replies: it refused the request, or its
     * change was undone. False when there was no answer (status 0) or the answer came from
     * something in front of Tempo, such as the hosting service's error page; then Tempo may have
     * made the change before the answer was lost.
     */
    public fromTempo = false,
  ) {
    super(message);
  }
}

type Listener = () => void;
const signedOutListeners = new Set<Listener>();
export function onSignedOut(fn: Listener): () => void {
  signedOutListeners.add(fn);
  return () => signedOutListeners.delete(fn);
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-Requested-With'] = 'tempo';
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  }
  let res: Response;
  try {
    res = await fetch(`/api/app${url}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw unreachable(method);
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    // The answer broke off halfway: Tempo got the request, but what it did is not known.
    throw unreachable(method);
  }
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && url !== '/login') signedOutListeners.forEach((fn) => fn());
    const err = data?.error;
    const fromTempo = data?.ok === false && typeof err?.code === 'string';
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `Something went wrong (HTTP ${res.status}).`, err?.problems ?? [], fromTempo);
  }
  return data as T;
}

/**
 * No answer from Tempo. Nothing here tries again by itself; screens that show live data fetch again
 * on their next update. The words say only what is known: many changes are not saves (signing in,
 * Run now), and a connection that drops after Tempo got the request does not mean the change was not
 * made. Screens that need to say more (the message box) add their own words.
 */
function unreachable(method: string): ApiError {
  return new ApiError(0, 'network', method === 'GET' ? 'Could not reach Tempo. Check your connection.' : 'Could not reach Tempo. Check your connection and try again.');
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url, {}),
};
