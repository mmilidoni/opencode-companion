import { createOpencodeClient } from "@opencode-ai/sdk/client";
import type { Message, Part, Session, TextPartInput } from "@opencode-ai/sdk/client";

export type OpenCodeError =
  | { kind: "unreachable"; detail: string }
  | { kind: "unauthorized" }
  | { kind: "server"; status: number; detail: string };

export type Result<T> = { ok: true; value: T } | { ok: false; error: OpenCodeError };

export interface HealthInfo {
  healthy: boolean;
  version: string;
}

export type ConnectionResult = Result<HealthInfo>;

export type MessageThreadEntry = { info: Message; parts: Part[] };

export interface OpenCodeApi {
  health(): Promise<Result<HealthInfo>>;
  createSession(title: string): Promise<Result<string>>;
  promptAsync(sessionId: string, parts: TextPartInput[]): Promise<Result<void>>;
  listSessions(): Promise<Result<Session[]>>;
  listMessages(sessionId: string): Promise<Result<MessageThreadEntry[]>>;
  abort(sessionId: string): Promise<Result<void>>;
  appendPromptTui(text: string): Promise<Result<void>>;
  submitPromptTui(): Promise<Result<void>>;
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

function statusOf(err: unknown): number | undefined {
  if (err instanceof Error && err.cause !== undefined && typeof err.cause === "object") {
    const status = (err.cause as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    const status = statusOf(err);
    if (status === 401) {
      return { ok: false, error: { kind: "unauthorized" } };
    }
    if (status !== undefined) {
      return { ok: false, error: { kind: "server", status, detail: messageOf(err) } };
    }
    return { ok: false, error: { kind: "unreachable", detail: messageOf(err) } };
  }
}

export function createOpenCodeApi(serverUrl: string, serverPassword: string): OpenCodeApi {
  const authorization = serverPassword
    ? `Basic ${toBase64Utf8(`opencode:${serverPassword}`)}`
    : undefined;

  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (authorization) {
      headers.set("Authorization", authorization);
    }
    return fetch(input, { ...init, headers });
  };

  // The generated SDK has no typed health() in 1.18.27 (Global only exposes
  // event()); /global/health is fetched directly.
  async function health(): Promise<Result<HealthInfo>> {
    try {
      const res = await fetchImpl(`${serverUrl}/global/health`);
      if (!res.ok) {
        if (res.status === 401) {
          return { ok: false, error: { kind: "unauthorized" } };
        }
        return {
          ok: false,
          error: { kind: "server", status: res.status, detail: `health check failed (${res.status})` },
        };
      }
      const info = (await res.json()) as HealthInfo;
      if (!info.healthy) {
        return { ok: false, error: { kind: "server", status: res.status, detail: "server reported unhealthy" } };
      }
      return { ok: true, value: info };
    } catch (err) {
      return { ok: false, error: { kind: "unreachable", detail: messageOf(err) } };
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
    async promptAsync(sessionId, parts) {
      return run(async () => {
        await client.session.promptAsync({ path: { id: sessionId }, body: { parts }, throwOnError: true });
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
    async appendPromptTui(text) {
      return run(async () => {
        await client.tui.appendPrompt({ body: { text }, throwOnError: true });
      });
    },
    async submitPromptTui() {
      return run(async () => {
        await client.tui.submitPrompt({ throwOnError: true });
      });
    },
  };
}