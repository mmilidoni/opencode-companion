import type { Result } from "./result.js";

/** Which opencode HTTP API surface the connected server speaks. */
export type ServerFlavor = "v1" | "v2";

export interface HealthInfo {
  healthy: boolean;
  version: string;
  flavor: ServerFlavor;
  /** True when the server enforces basic auth (anonymous probe got 401). */
  requiresAuth: boolean;
  /** True when the caller supplied a password in settings. */
  passwordProvided: boolean;
}

export type ConnectionResult = Result<HealthInfo>;

export interface FacadeSession {
  id: string;
  title: string;
  /** Epoch milliseconds of the last update. */
  updated: number;
}

export type MessageRole = "user" | "assistant" | "system";

export interface FacadePart {
  id: string;
  messageID: string;
  type: "text";
  text: string;
  ignored?: boolean;
}

export interface FacadeMessage {
  id: string;
  role: MessageRole;
  parts: FacadePart[];
  /**
   * Server- or provider-reported failure for this message (expired provider
   * key, aborted run, …). Such a message can carry no parts at all, so the
   * panel renders this instead of nothing.
   */
  error?: string;
}

export interface FacadeCommand {
  name: string;
  description?: string;
}

export interface FacadeAgent {
  id: string;
  name: string;
}

export interface FacadeProvider {
  id: string;
  name: string;
  models: string[];
}

export interface FacadeModelRef {
  providerID: string;
  modelID: string;
}

export interface PromptOptions {
  agent?: string;
  model?: FacadeModelRef;
}

/** Version-agnostic stream events the side panel reacts to. */
export type FacadeStreamEvent =
  | { kind: "sessions-changed" }
  | { kind: "part"; sessionId: string; messageId: string; partId: string; text: string }
  | { kind: "reload"; sessionId: string }
  | { kind: "status"; sessionId: string; idle: boolean };

/** The per-flavor operations, shared by the v1 and v2 implementations. */
export interface ServerApi {
  createSession(title: string): Promise<Result<string>>;
  prompt(sessionId: string, text: string, opts?: PromptOptions): Promise<Result<void>>;
  listSessions(): Promise<Result<FacadeSession[]>>;
  listMessages(sessionId: string): Promise<Result<FacadeMessage[]>>;
  abort(sessionId: string): Promise<Result<void>>;
  deleteSession(sessionId: string): Promise<Result<void>>;
  listCommands(): Promise<Result<FacadeCommand[]>>;
  runCommand(sessionId: string, command: string, args: string): Promise<Result<void>>;
  listAgents(): Promise<Result<FacadeAgent[]>>;
  listProviders(): Promise<Result<FacadeProvider[]>>;
  /** Provider default model; `agentId` is the selected agent ("" = server default). */
  defaultModel(agentId: string): Promise<Result<FacadeModelRef | null>>;
  /** Long-lived, self-reconnecting stream of normalized events. */
  eventSubscribe(): Promise<Result<AsyncIterable<FacadeStreamEvent>>>;
}

export interface OpenCodeApi extends ServerApi {
  health(): Promise<ConnectionResult>;
}
