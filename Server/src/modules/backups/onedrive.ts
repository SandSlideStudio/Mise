import { open } from 'node:fs/promises';
import { BackupFailure } from './failure.js';

/**
 * OneDrive through Microsoft Graph, limited to the app folder: Mise can see
 * `Apps/Mise` in someone's OneDrive and nothing else.
 *
 * Sign-in uses Microsoft's device code flow. The server asks Microsoft for a
 * short code, an administrator types it in at microsoft.com on any phone or
 * computer, and the server is handed a refresh token. That works on a Pi with
 * no screen and no address Microsoft could send anyone back to.
 */

export interface MicrosoftEndpoints {
  clientId: string;
  /** Overridden in tests. */
  login?: string;
  graph?: string;
  /** Upload piece size; a multiple of 320 KiB. Smaller in tests. */
  chunkBytes?: number;
}

const LOGIN = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = 'Files.ReadWrite.AppFolder offline_access User.Read';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/** Upload pieces must be a multiple of 320 KiB; 10 MiB keeps memory low on a Pi. */
const CHUNK_BYTES = 320 * 1024 * 32;

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: Date;
  intervalSeconds: number;
}

export type PollResult =
  | { kind: 'waiting'; slowDown: boolean }
  | { kind: 'declined' }
  | { kind: 'expired' }
  | { kind: 'connected'; refreshToken: string; accessToken: string };

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    throw new BackupFailure('onedrive_unreachable', String(error));
  }
}

async function postForm(url: string, fields: Record<string, string>) {
  const response = await call(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, body };
}

export function createOnedrive({
  clientId,
  login = LOGIN,
  graph = GRAPH,
  chunkBytes = CHUNK_BYTES,
}: MicrosoftEndpoints) {
  async function startSignIn(): Promise<DeviceCode> {
    const { ok, body } = await postForm(`${login}/devicecode`, {
      client_id: clientId,
      scope: SCOPES,
    });
    if (!ok) throw new BackupFailure('onedrive_failed', String(body.error ?? 'devicecode'));
    return {
      deviceCode: String(body.device_code),
      userCode: String(body.user_code),
      verificationUri: String(body.verification_uri),
      expiresAt: new Date(Date.now() + Number(body.expires_in ?? 900) * 1000),
      intervalSeconds: Number(body.interval ?? 5),
    };
  }

  /** One look at whether the code has been entered yet. */
  async function poll(deviceCode: string): Promise<PollResult> {
    const { ok, body } = await postForm(`${login}/token`, {
      grant_type: DEVICE_GRANT,
      client_id: clientId,
      device_code: deviceCode,
    });
    if (ok) {
      return {
        kind: 'connected',
        refreshToken: String(body.refresh_token),
        accessToken: String(body.access_token),
      };
    }
    switch (body.error) {
      case 'authorization_pending':
        return { kind: 'waiting', slowDown: false };
      case 'slow_down':
        return { kind: 'waiting', slowDown: true };
      case 'authorization_declined':
        return { kind: 'declined' };
      case 'expired_token':
        return { kind: 'expired' };
      default:
        throw new BackupFailure('onedrive_failed', String(body.error ?? 'token'));
    }
  }

  /**
   * A fresh access token. Microsoft may hand back a new refresh token too,
   * which replaces the old one; keep whichever comes back.
   */
  async function refresh(refreshToken: string) {
    const { ok, body } = await postForm(`${login}/token`, {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
      scope: SCOPES,
    });
    if (!ok) {
      // Revoked, expired, or the password changed: someone has to connect again.
      if (body.error === 'invalid_grant' || body.error === 'interaction_required') {
        throw new BackupFailure('onedrive_auth', String(body.error));
      }
      throw new BackupFailure('onedrive_failed', String(body.error ?? 'refresh'));
    }
    return {
      accessToken: String(body.access_token),
      refreshToken: body.refresh_token ? String(body.refresh_token) : refreshToken,
    };
  }

  async function request(token: string, method: string, path: string, json?: unknown) {
    const response = await call(`${graph}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    if (!response.ok) await refuse(response, `${method} ${path}`);
    return response;
  }

  async function refuse(response: Response, what: string): Promise<never> {
    const body = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
    if (response.status === 401 || response.status === 403) {
      throw new BackupFailure('onedrive_auth', what);
    }
    if (response.status === 507 || body.error?.code === 'quotaLimitReached') {
      throw new BackupFailure('onedrive_full', what);
    }
    throw new BackupFailure('onedrive_failed', `${what}: ${response.status}`);
  }

  /** Who connected, for the settings page, and the app folder made ready. */
  async function account(token: string): Promise<string> {
    const me = (await (
      await request(token, 'GET', '/me?$select=displayName,mail,userPrincipalName')
    ).json()) as { displayName?: string; mail?: string; userPrincipalName?: string };
    await request(token, 'GET', '/me/drive/special/approot');
    return me.mail ?? me.userPrincipalName ?? me.displayName ?? 'OneDrive';
  }

  async function upload(token: string, name: string, file: string, size: number): Promise<void> {
    const session = (await (
      await request(
        token,
        'POST',
        `/me/drive/special/approot:/${encodeURIComponent(name)}:/createUploadSession`,
        { item: { '@microsoft.graph.conflictBehavior': 'replace' } },
      )
    ).json()) as { uploadUrl: string };

    const handle = await open(file, 'r');
    try {
      const chunk = Buffer.alloc(Math.min(chunkBytes, size));
      for (let start = 0; start < size;) {
        const { bytesRead } = await handle.read(
          chunk,
          0,
          Math.min(chunk.length, size - start),
          start,
        );
        const end = start + bytesRead - 1;
        // The upload address carries its own permission; no token goes with it.
        const response = await call(session.uploadUrl, {
          method: 'PUT',
          headers: { 'content-range': `bytes ${start}-${end}/${size}` },
          body: chunk.subarray(0, bytesRead),
        });
        if (!response.ok) await refuse(response, `upload ${name}`);
        start = end + 1;
      }
    } finally {
      await handle.close();
    }
  }

  /** The files in the app folder. */
  async function list(token: string): Promise<{ id: string; name: string }[]> {
    const items: { id: string; name: string }[] = [];
    let next: string | null = '/me/drive/special/approot/children?$select=id,name&$top=200';
    while (next) {
      const page = (await (await request(token, 'GET', next)).json()) as {
        value: { id: string; name: string }[];
        '@odata.nextLink'?: string;
      };
      items.push(...page.value);
      next = page['@odata.nextLink']?.replace(graph, '') ?? null;
    }
    return items;
  }

  async function remove(token: string, id: string): Promise<void> {
    await request(token, 'DELETE', `/me/drive/items/${encodeURIComponent(id)}`);
  }

  return { startSignIn, poll, refresh, account, upload, list, remove };
}

export type Onedrive = ReturnType<typeof createOnedrive>;
