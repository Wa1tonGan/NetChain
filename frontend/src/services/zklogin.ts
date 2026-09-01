export interface ZkLoginSession {
  address: string;
  email: string | null;
  name: string | null;
  sub: string;
  iss: string;
  aud: string;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Start the Google zkLogin flow.
 *
 * Model A: the frontend only asks the backend for the OAuth URL. The backend
 * later derives the Sui zkLogin address and keeps custody of Sui signing.
 */
export async function beginZkLogin(redirectPath = "/wallet"): Promise<void> {
  const url = new URL("/api/zklogin/authorize", window.location.origin);
  url.searchParams.set("redirect", redirectPath);

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(15_000),
  });
  const data = await readJson<{ url: string }>(response);

  window.location.assign(data.url);
}

/**
 * Finish the OAuth code exchange and store the derived zkLogin identity.
 */
export async function completeZkLogin(code: string, state: string): Promise<ZkLoginSession> {
  const url = new URL("/api/zklogin/callback", window.location.origin);
  url.searchParams.set("code", code);
  url.searchParams.set("state", state);

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(15_000),
  });
  return readJson<ZkLoginSession>(response);
}
