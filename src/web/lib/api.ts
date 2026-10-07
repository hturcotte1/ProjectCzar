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
    // Nothing here tries again by itself. A change (sending, saving, approving) is simply not made;
    // screens that show live data fetch again on their next update.
    throw new ApiError(
      0,
      'network',
      method === 'GET' ? 'Could not reach Tempo. Check your connection.' : 'Could not reach Tempo, so this was not saved. Check your connection and try again.',
    );
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && url !== '/login') signedOutListeners.forEach((fn) => fn());
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `Something went wrong (HTTP ${res.status}).`, err?.problems ?? []);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url, {}),
};
