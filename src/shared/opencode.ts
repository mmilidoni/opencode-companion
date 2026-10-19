import { createV1Api } from "./opencode-v1.js";
import { createV2Api } from "./opencode-v2.js";
import type { ConnectionResult, OpenCodeApi, ServerFlavor, ServerApi } from "./facade.js";

export type { OpenCodeError, Result } from "./result.js";
export type {
  ConnectionResult,
  FacadeAgent,
  FacadeCommand,
  FacadeMessage,
  FacadeModelRef,
  FacadePart,
  FacadeProvider,
  FacadeSession,
  FacadeStreamEvent,
  HealthInfo,
  MessageRole,
  OpenCodeApi,
  PromptOptions,
  ServerFlavor,
  ServerApi,
} from "./facade.js";

interface ProbeResult {
  status?: number;
  body?: unknown;
  requiresAuth: boolean;
  networkError: boolean;
}

function toBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** v2 servers answer GET /api/info with a ServerInfo object carrying `version`. */
function isServerInfo(body: unknown): body is { version: string } {
  return isRecord(body) && typeof body.version === "string";
}

/** v1 servers answer GET /global/health with `{ healthy: boolean, version }`. */
function isHealthBody(body: unknown): body is { healthy: boolean; version?: string } {
  return isRecord(body) && typeof body.healthy === "boolean";
}

export function createOpenCodeApi(serverUrl: string, serverPassword: string): OpenCodeApi {
  const passwordProvided = serverPassword.length > 0;
  const authorization = passwordProvided
    ? `Basic ${toBase64Utf8(`opencode:${serverPassword}`)}`
    : undefined;
  const baseUrl = serverUrl.replace(/\/+$/, "");

  const v1 = createV1Api(baseUrl, passwordProvided, authorization);
  const v2 = createV2Api(baseUrl, passwordProvided, authorization);
  let resolved: ServerApi | undefined;

  async function tryFetch(url: string, authorizationHeader?: string): Promise<Response | undefined> {
    try {
      const headers = new Headers();
      if (authorizationHeader) {
        headers.set("Authorization", authorizationHeader);
      }
      return await fetch(url, { headers });
    } catch {
      return undefined;
    }
  }

  async function readJson(res: Response): Promise<unknown> {
    try {
      return (await res.json()) as unknown;
    } catch {
      return undefined;
    }
  }

  // Probes a path anonymously, then retries with credentials on 401 so the
  // popup can tell "server requires a password" from "server ignores passwords".
  async function probe(path: string): Promise<ProbeResult> {
    const url = `${baseUrl}${path}`;
    const anonymous = await tryFetch(url);
    if (anonymous === undefined) {
      return { requiresAuth: false, networkError: true };
    }
    if (anonymous.status === 401 || anonymous.status === 403) {
      if (!authorization) {
        return { status: anonymous.status, requiresAuth: true, networkError: false };
      }
      const authenticated = await tryFetch(url, authorization);
      if (authenticated === undefined) {
        return { requiresAuth: true, networkError: true };
      }
      return {
        status: authenticated.status,
        body: await readJson(authenticated),
        requiresAuth: true,
        networkError: false,
      };
    }
    return {
      status: anonymous.status,
      body: await readJson(anonymous),
      requiresAuth: false,
      networkError: false,
    };
  }

  // Distinguishes a v2 server (rewritten /api/* HTTP API) from a v1 server,
  // validating by JSON shape because a v2 server answers the old paths with the
  // SPA's HTML at 200 rather than a 404.
  async function health(): Promise<ConnectionResult> {
    const info = await probe("/api/info");
    if (isServerInfo(info.body)) {
      resolved = v2;
      return {
        ok: true,
        value: {
          healthy: true,
          version: info.body.version,
          flavor: "v2" satisfies ServerFlavor,
          requiresAuth: info.requiresAuth,
          passwordProvided,
        },
      };
    }

    const legacy = await probe("/global/health");
    if (isHealthBody(legacy.body)) {
      resolved = v1;
      return {
        ok: true,
        value: {
          healthy: true,
          version: legacy.body.version ?? "",
          flavor: "v1" satisfies ServerFlavor,
          requiresAuth: legacy.requiresAuth,
          passwordProvided,
        },
      };
    }

    if (info.networkError && legacy.networkError) {
      return { ok: false, error: { kind: "unreachable", detail: "Failed to fetch" } };
    }
    if (info.status === 401 || info.status === 403 || legacy.status === 401 || legacy.status === 403) {
      return { ok: false, error: { kind: "unauthorized", passwordProvided } };
    }
    const status = info.networkError ? legacy.status : info.status;
    if (status !== undefined) {
      return { ok: false, error: { kind: "server", status, detail: `health check failed (${status})` } };
    }
    return { ok: false, error: { kind: "unreachable", detail: "Failed to fetch" } };
  }

  async function resolveImpl(): Promise<ServerApi> {
    if (resolved) {
      return resolved;
    }
    await health();
    return resolved ?? v1;
  }

  return {
    health,
    async createSession(title) {
      return (await resolveImpl()).createSession(title);
    },
    async prompt(sessionId, text, opts) {
      return (await resolveImpl()).prompt(sessionId, text, opts);
    },
    async listSessions() {
      return (await resolveImpl()).listSessions();
    },
    async listMessages(sessionId) {
      return (await resolveImpl()).listMessages(sessionId);
    },
    async abort(sessionId) {
      return (await resolveImpl()).abort(sessionId);
    },
    async deleteSession(sessionId) {
      return (await resolveImpl()).deleteSession(sessionId);
    },
    async listCommands() {
      return (await resolveImpl()).listCommands();
    },
    async runCommand(sessionId, command, args) {
      return (await resolveImpl()).runCommand(sessionId, command, args);
    },
    async listAgents() {
      return (await resolveImpl()).listAgents();
    },
    async listProviders() {
      return (await resolveImpl()).listProviders();
    },
    async defaultModel(agentId) {
      return (await resolveImpl()).defaultModel(agentId);
    },
    async eventSubscribe() {
      return (await resolveImpl()).eventSubscribe();
    },
  };
}
