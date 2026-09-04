import { createOpencodeClient } from "@opencode-ai/sdk/client";
import type { Agent, Command, Message, Part, Session, TextPartInput } from "@opencode-ai/sdk/client";

export type OpenCodeError =
  | { kind: "unreachable"; detail: string }
  | { kind: "unauthorized"; passwordProvided: boolean }
  | { kind: "server"; status: number; detail: string }
  | { kind: "tui"; detail: string };

export type Result<T> = { ok: true; value: T } | { ok: false; error: OpenCodeError };

export interface HealthInfo {
  healthy: boolean;
  version: string;
  /** True when the server enforces basic auth (anonymous health probe got 401). */
  requiresAuth: boolean;
  /** True when the caller supplied a password in settings. */
  passwordProvided: boolean;
}

export type ConnectionResult = Result<HealthInfo>;

export type MessageThreadEntry = { info: Message; parts: Part[] };

export interface OpenCodeApi {
  health(): Promise<Result<HealthInfo>>;
  createSession(title: string): Promise<Result<string>>;
  promptAsync(
    sessionId: string,
    parts: TextPartInput[],
    opts?: { agent?: string; model?: { providerID: string; modelID: string } },
  ): Promise<Result<void>>;
  listSessions(): Promise<Result<Session[]>>;
  listMessages(sessionId: string): Promise<Result<MessageThreadEntry[]>>;
  abort(sessionId: string): Promise<Result<void>>;
  deleteSession(sessionId: string): Promise<Result<void>>;
  listCommands(): Promise<Result<Command[]>>;
  runCommand(sessionId: string, command: string, args: string): Promise<Result<void>>;
  listAgents(): Promise<Result<Agent[]>>;
  listProviders(): Promise<Result<{ providers: { id: string; name: string; models: Record<string, unknown> }[] }>>;
  appendPromptTui(text: string): Promise<Result<void>>;
  submitPromptTui(): Promise<Result<void>>;
  /** `/event` SSE bus; auto-reconnects with exponential backoff. */
  eventSubscribe(): Promise<AsyncIterable<unknown>>;
}

function toBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

class TuiError extends Error {}

function statusOf(err: unknown): number | undefined {
  if (err instanceof Error && err.cause !== undefined && typeof err.cause === "object") {
    const status = (err.cause as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

export function createOpenCodeApi(serverUrl: string, serverPassword: string): OpenCodeApi {
  const passwordProvided = serverPassword.length > 0;
  const authorization = passwordProvided
    ? `Basic ${toBase64Utf8(`opencode:${serverPassword}`)}`
    : undefined;

  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (authorization) {
      headers.set("Authorization", authorization);
    }
    return fetch(input, { ...init, headers });
  };

  async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      if (err instanceof TuiError) {
        return { ok: false, error: { kind: "tui", detail: err.message } };
      }
      const status = statusOf(err);
      if (status === 401) {
        return { ok: false, error: { kind: "unauthorized", passwordProvided } };
      }
      if (status !== undefined) {
        return { ok: false, error: { kind: "server", status, detail: messageOf(err) } };
      }
      return { ok: false, error: { kind: "unreachable", detail: messageOf(err) } };
    }
  }

  // The generated SDK has no typed health() in 1.18.27 (Global only exposes
  // event()); /global/health is fetched directly. The check first probes
  // WITHOUT credentials so the popup can distinguish "server requires a
  // password" from "server ignores passwords entirely".
  async function health(): Promise<Result<HealthInfo>> {
    const probe = await safeFetch(`${serverUrl}/global/health`);
    if (probe === undefined) {
      return { ok: false, error: { kind: "unreachable", detail: "Failed to fetch" } };
    }
    if (probe.status === 401) {
      const res = await safeFetch(`${serverUrl}/global/health`, authorization);
      if (res === undefined) {
        return { ok: false, error: { kind: "unreachable", detail: "Failed to fetch" } };
      }
      if (!res.ok) {
        if (res.status === 401) {
          return { ok: false, error: { kind: "unauthorized", passwordProvided } };
        }
        return {
          ok: false,
          error: { kind: "server", status: res.status, detail: `health check failed (${res.status})` },
        };
      }
      return toHealthResult(res, { requiresAuth: true });
    }
    if (!probe.ok) {
      return {
        ok: false,
        error: { kind: "server", status: probe.status, detail: `health check failed (${probe.status})` },
      };
    }
    return toHealthResult(probe, { requiresAuth: false });
  }

  async function toHealthResult(
    res: Response,
    extra: Pick<HealthInfo, "requiresAuth">,
  ): Promise<Result<HealthInfo>> {
    const info = (await res.json()) as HealthInfo;
    if (!info.healthy) {
      return {
        ok: false,
        error: { kind: "server", status: res.status, detail: "server reported unhealthy" },
      };
    }
    return { ok: true, value: { ...info, ...extra, passwordProvided } };
  }

  async function safeFetch(url: string, authorizationHeader?: string): Promise<Response | undefined> {
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

  const client = createOpencodeClient({ baseUrl: serverUrl, fetch: fetchImpl });

  return {
    health,
    async createSession(title) {
      return run(async () => {
        const session = await client.session.create({ body: { title }, throwOnError: true });
        return session.data.id;
      });
    },
    async promptAsync(sessionId, parts, opts) {
      return run(async () => {
        const body: { parts: TextPartInput[]; agent?: string; model?: { providerID: string; modelID: string } } = { parts };
        if (opts?.agent) {
          body.agent = opts.agent;
        }
        if (opts?.model?.providerID && opts?.model?.modelID) {
          body.model = { providerID: opts.model.providerID, modelID: opts.model.modelID };
        }
        await client.session.promptAsync({ path: { id: sessionId }, body, throwOnError: true });
      });
    },
    async listSessions() {
      return run(async () => {
        const sessions = await client.session.list({ throwOnError: true });
        return sessions.data;
      });
    },
    async listMessages(sessionId) {
      return run(async () => {
        const thread = await client.session.messages({ path: { id: sessionId }, throwOnError: true });
        return thread.data;
      });
    },
    async abort(sessionId) {
      return run(async () => {
        await client.session.abort({ path: { id: sessionId }, throwOnError: true });
      });
    },
    async deleteSession(sessionId) {
      return run(async () => {
        await client.session.delete({ path: { id: sessionId }, throwOnError: true });
      });
    },
async listCommands() {
      return run(async () => {
        const commands = await client.command.list({ throwOnError: true });
        return commands.data;
      });
    },
    async runCommand(sessionId, command, args) {
      return run(async () => {
        await client.session.command({
          path: { id: sessionId },
          body: { command, arguments: args },
          throwOnError: true,
        });
      });
    },
    async listAgents() {
      return run(async () => {
        const agents = await client.app.agents({ throwOnError: true });
        return agents.data;
      });
    },
    async listProviders() {
      return run(async () => {
        const providers = await client.config.providers({ throwOnError: true });
        return providers.data;
      });
    },
    async appendPromptTui(text) {
      return run(async () => {
        const ok = await client.tui.appendPrompt({ body: { text }, throwOnError: true });
        if (ok.data === false) {
          throw new TuiError("The opencode TUI rejected the prompt — is a TUI attached to this server?");
        }
      });
    },
    async submitPromptTui() {
      return run(async () => {
        const ok = await client.tui.submitPrompt({ throwOnError: true });
        if (ok.data === false) {
          throw new TuiError("The opencode TUI rejected the submit — is a TUI attached to this server?");
        }
      });
    },
    async eventSubscribe() {
      // The generated SSE client calls global fetch directly and ignores a
      // custom fetch, so the basic-auth header must ride on the request
      // headers instead of the fetch wrapper.
      const result = await client.event.subscribe({
        headers: authorization ? { Authorization: authorization } : undefined,
      } as never);
      return result.stream as AsyncIterable<unknown>;
    },
  };
}