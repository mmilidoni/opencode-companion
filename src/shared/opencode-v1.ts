import { createOpencodeClient } from "@opencode-ai/sdk/client";
import type { Message, Part } from "@opencode-ai/sdk/client";
import { toResult } from "./result.js";
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
  MessageRole,
  ServerApi,
} from "./facade.js";

const DEFAULT_AGENT_ID = "build";
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toMessageError(info: Message): string | undefined {
  if (info.role !== "assistant" || info.error === undefined) {
    return undefined;
  }
  const data = info.error.data as { message?: unknown } | undefined;
  const message = data?.message;
  return typeof message === "string" && message.length > 0
    ? message
    : `opencode reported ${info.error.name}.`;
}

function toFacadeMessage(info: Message, parts: Part[]): FacadeMessage | null {
  const role: MessageRole = info.role === "user" ? "user" : "assistant";
  const facadeParts: FacadePart[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      facadeParts.push({
        id: part.id,
        messageID: part.messageID,
        type: "text",
        text: part.text,
        ignored: part.ignored,
      });
    }
  }
  const error = toMessageError(info);
  if (facadeParts.length === 0 && role !== "user" && error === undefined) {
    return null;
  }
  return { id: info.id, role, parts: facadeParts, error };
}

function mapRawEvent(raw: unknown): FacadeStreamEvent[] {
  const ev = raw as { type?: string; properties?: Record<string, unknown> };
  if (!ev?.type) {
    return [];
  }
  switch (ev.type) {
    case "session.created":
    case "session.deleted":
    case "session.updated":
    case "session.renamed":
      return [{ kind: "sessions-changed" }];
    case "message.part.updated": {
      const part = ev.properties?.part as Partial<Part> | undefined;
      if (
        part &&
        part.type === "text" &&
        typeof part.sessionID === "string" &&
        typeof part.messageID === "string" &&
        typeof part.id === "string" &&
        typeof part.text === "string"
      ) {
        return [
          { kind: "part", sessionId: part.sessionID, messageId: part.messageID, partId: part.id, text: part.text },
        ];
      }
      return [];
    }
    case "session.idle": {
      const sessionId = ev.properties?.sessionID;
      return typeof sessionId === "string" ? [{ kind: "status", sessionId, idle: true }] : [];
    }
    default:
      return [];
  }
}

export function createV1Api(
  baseUrl: string,
  passwordProvided: boolean,
  authorization: string | undefined,
): ServerApi {
  // The generated SDK applies no auth itself, so the basic-auth header rides on
  // a custom fetch wrapper. (SSE bypasses it — see eventSubscribe, which passes
  // the header explicitly because the SDK's SSE client ignores the wrapper.)
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (authorization) {
      headers.set("Authorization", authorization);
    }
    return fetch(input, { ...init, headers });
  };

  const client = createOpencodeClient({ baseUrl, fetch: fetchImpl });

  async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      return toResult(err, passwordProvided);
    }
  }

  async function* resilientEvents(): AsyncGenerator<FacadeStreamEvent> {
    let backoff = RECONNECT_MIN_MS;
    for (;;) {
      try {
        const result = await client.event.subscribe({
          headers: authorization ? { Authorization: authorization } : undefined,
        } as never);
        backoff = RECONNECT_MIN_MS;
        for await (const raw of result.stream as AsyncIterable<unknown>) {
          for (const event of mapRawEvent(raw)) {
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
        const session = await client.session.create({ body: { title }, throwOnError: true });
        return session.data.id;
      });
    },
    async prompt(sessionId, text, opts) {
      return run(async () => {
        const body: {
          parts: { type: "text"; text: string }[];
          agent?: string;
          model?: { providerID: string; modelID: string };
        } = { parts: [{ type: "text", text }] };
        if (opts?.agent) {
          body.agent = opts.agent;
        }
        if (opts?.model?.providerID && opts.model.modelID) {
          body.model = { providerID: opts.model.providerID, modelID: opts.model.modelID };
        }
        await client.session.promptAsync({ path: { id: sessionId }, body, throwOnError: true });
      });
    },
    async listSessions() {
      return run(async () => {
        const sessions = await client.session.list({ throwOnError: true });
        return (sessions.data ?? []).map<FacadeSession>((session) => ({
          id: session.id,
          title: session.title ?? "",
          updated: session.time.updated,
        }));
      });
    },
    async listMessages(sessionId) {
      return run(async () => {
        const thread = await client.session.messages({ path: { id: sessionId }, throwOnError: true });
        const messages: FacadeMessage[] = [];
        for (const entry of thread.data ?? []) {
          const message = toFacadeMessage(entry.info, entry.parts);
          if (message) {
            messages.push(message);
          }
        }
        return messages;
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
        return (commands.data ?? []).map<FacadeCommand>((command) => ({
          name: command.name,
          description: command.description,
        }));
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
        return (agents.data ?? []).map<FacadeAgent>((agent) => ({ id: agent.name, name: agent.name }));
      });
    },
    async listProviders() {
      return run(async () => {
        const providers = await client.config.providers({ throwOnError: true });
        return (providers.data?.providers ?? []).map<FacadeProvider>((provider) => ({
          id: provider.id,
          name: provider.name || provider.id,
          models: Object.keys(provider.models ?? {}),
        }));
      });
    },
    async defaultModel(agentId) {
      return run(async () => {
        const config = await client.config.get({ throwOnError: true });
        const cfg = config.data as {
          model?: string;
          small_model?: string;
          agent?: Record<string, { model?: string } | undefined>;
        };
        const reference = cfg.model ?? cfg.small_model ?? cfg.agent?.[agentId || DEFAULT_AGENT_ID]?.model;
        if (typeof reference !== "string" || reference.length === 0) {
          return null;
        }
        const [providerID, ...rest] = reference.split("/");
        const modelID = rest.join("/");
        if (!providerID || !modelID) {
          return null;
        }
        return { providerID, modelID } satisfies FacadeModelRef;
      });
    },
    async eventSubscribe() {
      return { ok: true, value: resilientEvents() };
    },
  };
}
