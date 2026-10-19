import { httpError, toResult } from "./result.js";
import type { Result } from "./result.js";
import type {
  FacadeAgent,
  FacadeCommand,
  FacadeMessage,
  FacadeModelRef,
  FacadePart,
  FacadeProvider,
  FacadeSession,
  FacadeStreamEvent,
  ServerApi,
} from "./facade.js";

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

interface RawSessionTime {
  created?: number;
  updated?: number;
}

interface RawSession {
  id: string;
  title?: string;
  time?: RawSessionTime;
}

interface RawAssistantText {
  type?: string;
  text?: string;
}

interface RawAssistantError {
  type?: string;
  message?: string;
}

interface RawMessage {
  id: string;
  type?: string;
  text?: string;
  content?: RawAssistantText[];
  time?: { created?: number };
  finish?: string;
  error?: RawAssistantError;
}

interface RawCommand {
  name: string;
  description?: string;
}

interface RawAgent {
  id?: string;
  name?: string;
}

interface RawProvider {
  id: string;
  name?: string;
}

interface RawModel {
  id?: string;
  modelID?: string;
  providerID?: string;
}

interface RawEnvelope {
  type?: string;
  data?: Record<string, unknown>;
  location?: { directory?: string };
}

const BASE_PATH = "/api";

export function createV2Api(
  baseUrl: string,
  passwordProvided: boolean,
  authorization: string | undefined,
): ServerApi {
  const api = `${baseUrl}${BASE_PATH}`;

  function authHeaders(): Headers {
    const headers = new Headers();
    if (authorization) {
      headers.set("Authorization", authorization);
    }
    return headers;
  }

  async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const headers = authHeaders();
    let body: string | undefined;
    if (init?.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(init.body);
    }
    const method = init?.method ?? "GET";
    const res = await fetch(`${api}${path}`, { method, headers, body });
    if (!res.ok) {
      throw httpError(res.status, `${method} ${BASE_PATH}${path} failed (${res.status})`);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }

  async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      return toResult(err, passwordProvided);
    }
  }

  function sessionPath(sessionId: string): string {
    return `/session/${encodeURIComponent(sessionId)}`;
  }

  function toErrorMessage(raw: RawMessage): string | undefined {
    const message = raw.error?.message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
    if (raw.error !== undefined || raw.finish === "error") {
      return "opencode could not complete this message.";
    }
    return undefined;
  }

  function toFacadeMessage(raw: RawMessage): FacadeMessage | null {
    if (raw.type === "user") {
      return {
        id: raw.id,
        role: "user",
        parts: [{ id: `${raw.id}:text`, messageID: raw.id, type: "text", text: raw.text ?? "" }],
      };
    }
    if (raw.type === "assistant") {
      const parts: FacadePart[] = [];
      (raw.content ?? []).forEach((content, index) => {
        if (content.type === "text" && typeof content.text === "string") {
          parts.push({ id: `${raw.id}:text:${index}`, messageID: raw.id, type: "text", text: content.text });
        }
      });
      const error = toErrorMessage(raw);
      return parts.length === 0 && error === undefined ? null : { id: raw.id, role: "assistant", parts, error };
    }
    if (raw.type === "system") {
      return {
        id: raw.id,
        role: "system",
        parts: [{ id: `${raw.id}:text`, messageID: raw.id, type: "text", text: raw.text ?? "" }],
      };
    }
    return null;
  }

  function createEventMapper(): (envelope: RawEnvelope) => FacadeStreamEvent[] {
    const textByPart = new Map<string, { sessionId: string; messageId: string; partId: string; text: string }>();
    let lastSessionId = "";

    function textKey(data: Record<string, unknown>) {
      const messageId = str(data.assistantMessageID) ?? str(data.messageID);
      const partId = str(data.textID) ?? str(data.partID) ?? "text";
      const sessionId = str(data.sessionID) ?? lastSessionId;
      if (!sessionId || !messageId) {
        return null;
      }
      return { key: `${messageId}:${partId}`, sessionId, messageId, partId };
    }

    return (envelope) => {
      const type = envelope.type;
      if (!type) {
        return [];
      }
      const data = (envelope.data ?? {}) as Record<string, unknown>;
      const sessionId = str(data.sessionID);
      if (sessionId) {
        lastSessionId = sessionId;
      }
      switch (type) {
        case "session.created":
        case "session.deleted":
        case "session.updated":
        case "session.renamed":
        case "session.moved":
          return [{ kind: "sessions-changed" }];
        case "session.text.started": {
          const key = textKey(data);
          if (!key) {
            return [];
          }
          textByPart.set(key.key, { sessionId: key.sessionId, messageId: key.messageId, partId: key.partId, text: "" });
          return [];
        }
        case "session.text.delta":
        case "session.reasoning.delta": {
          const key = textKey(data);
          if (!key) {
            return [];
          }
          const entry =
            textByPart.get(key.key) ??
            { sessionId: key.sessionId, messageId: key.messageId, partId: key.partId, text: "" };
          entry.text += str(data.delta) ?? "";
          textByPart.set(key.key, entry);
          return [
            { kind: "part", sessionId: key.sessionId, messageId: entry.messageId, partId: entry.partId, text: entry.text },
          ];
        }
        case "session.text.ended":
        case "session.reasoning.ended": {
          const key = textKey(data);
          if (!key) {
            return [];
          }
          const entry = textByPart.get(key.key);
          const text = str(data.text) ?? entry?.text ?? "";
          textByPart.delete(key.key);
          return [
            {
              kind: "part",
              sessionId: key.sessionId,
              messageId: entry?.messageId ?? key.messageId,
              partId: entry?.partId ?? key.partId,
              text,
            },
          ];
        }
        case "session.execution.started":
          return sessionId ? [{ kind: "status", sessionId, idle: false }] : [];
        case "session.execution.succeeded":
        case "session.execution.failed":
        case "session.execution.interrupted":
        case "session.error":
        case "session.idle":
          return sessionId
            ? [
                { kind: "status", sessionId, idle: true },
                { kind: "reload", sessionId },
              ]
            : [];
        case "session.step.ended":
        case "session.message.content.updated":
          return sessionId ? [{ kind: "reload", sessionId }] : [];
        default:
          return [];
      }
    };
  }

  async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf("\n\n");
        while (index !== -1) {
          const chunk = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const payload = parseSseChunk(chunk);
          if (payload !== undefined) {
            yield payload;
          }
          index = buffer.indexOf("\n\n");
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  function parseSseChunk(chunk: string): unknown {
    const dataLines: string[] = [];
    for (const line of chunk.split("\n")) {
      const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (trimmed.startsWith(":") || !trimmed.startsWith("data:")) {
        continue;
      }
      dataLines.push(trimmed.slice(5).trimStart());
    }
    if (dataLines.length === 0) {
      return undefined;
    }
    try {
      return JSON.parse(dataLines.join("\n")) as unknown;
    } catch {
      return undefined;
    }
  }

  async function* resilientEvents(): AsyncGenerator<FacadeStreamEvent> {
    let backoff = RECONNECT_MIN_MS;
    const map = createEventMapper();
    for (;;) {
      try {
        const res = await fetch(`${api}/event`, { headers: authHeaders() });
        if (!res.ok || !res.body) {
          throw httpError(res.status, `GET ${BASE_PATH}/event failed (${res.status})`);
        }
        backoff = RECONNECT_MIN_MS;
        for await (const frame of readSse(res.body)) {
          const envelope = frame as RawEnvelope;
          if (!envelope || typeof envelope.type !== "string") {
            continue;
          }
          for (const event of map(envelope)) {
            yield event;
          }
        }
      } catch {
        // Connection dropped — fall through and retry with backoff.
      }
      await delay(backoff);
      backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
    }
  }

  return {
    async createSession(title) {
      return run(async () => {
        const res = await request<{ data: { id: string } }>("/session", { method: "POST", body: { title } });
        return res.data.id;
      });
    },
    async prompt(sessionId, text, opts) {
      return run(async () => {
        const body: Record<string, unknown> = { text };
        if (opts?.agent) {
          body.agent = opts.agent;
        }
        if (opts?.model?.providerID && opts.model.modelID) {
          body.model = { id: opts.model.modelID, providerID: opts.model.providerID };
        }
        await request<unknown>(`${sessionPath(sessionId)}/prompt`, { method: "POST", body });
      });
    },
    async listSessions() {
      return run(async () => {
        const res = await request<{ data: RawSession[] }>("/session");
        return (res.data ?? []).map<FacadeSession>((session) => ({
          id: session.id,
          title: session.title ?? "",
          updated: session.time?.updated ?? 0,
        }));
      });
    },
    async listMessages(sessionId) {
      return run(async () => {
        const res = await request<{ data: RawMessage[] }>(`${sessionPath(sessionId)}/message`);
        // v2 returns the thread newest-first; the UI renders it top-to-bottom, so
        // restore chronological order (reverse first, then a stable sort by time)
        // and keep the server's order for messages created in the same millisecond.
        const ordered = [...(res.data ?? [])]
          .reverse()
          .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));
        const messages: FacadeMessage[] = [];
        for (const raw of ordered) {
          const message = toFacadeMessage(raw);
          if (message) {
            messages.push(message);
          }
        }
        return messages;
      });
    },
    async abort(sessionId) {
      return run(async () => {
        await request<unknown>(`${sessionPath(sessionId)}/interrupt`, { method: "POST", body: {} });
      });
    },
    async deleteSession(sessionId) {
      return run(async () => {
        await request<unknown>(sessionPath(sessionId), { method: "DELETE" });
      });
    },
    async listCommands() {
      return run(async () => {
        const res = await request<{ data: RawCommand[] }>("/command");
        return (res.data ?? []).map<FacadeCommand>((command) => ({
          name: command.name,
          description: command.description,
        }));
      });
    },
    async runCommand(sessionId, command, args) {
      return run(async () => {
        await request<unknown>(`${sessionPath(sessionId)}/command`, {
          method: "POST",
          body: { name: command, text: args },
        });
      });
    },
    async listAgents() {
      return run(async () => {
        const res = await request<{ data: RawAgent[] }>("/agent");
        return (res.data ?? []).map<FacadeAgent>((agent) => ({
          id: agent.id ?? agent.name ?? "",
          name: agent.name ?? agent.id ?? "",
        }));
      });
    },
    async listProviders() {
      return run(async () => {
        const [providers, models] = await Promise.all([
          request<{ data: RawProvider[] }>("/provider"),
          request<{ data: RawModel[] }>("/model").catch(() => ({ data: [] as RawModel[] })),
        ]);
        const modelsByProvider = new Map<string, string[]>();
        for (const model of models.data ?? []) {
          const providerID = model.providerID;
          if (!providerID) {
            continue;
          }
          const modelID = model.modelID ?? model.id;
          if (!modelID) {
            continue;
          }
          const list = modelsByProvider.get(providerID) ?? [];
          list.push(modelID);
          modelsByProvider.set(providerID, list);
        }
        return (providers.data ?? []).map<FacadeProvider>((provider) => ({
          id: provider.id,
          name: provider.name || provider.id,
          models: modelsByProvider.get(provider.id) ?? [],
        }));
      });
    },
    async defaultModel() {
      return run(async () => {
        const res = await request<{ data: RawModel | null }>("/model/default");
        const model = res.data;
        const modelID = model ? (model.modelID ?? model.id) : undefined;
        if (!model?.providerID || !modelID) {
          return null;
        }
        return { providerID: model.providerID, modelID } satisfies FacadeModelRef;
      });
    },
    async eventSubscribe() {
      return { ok: true, value: resilientEvents() };
    },
  };
}
