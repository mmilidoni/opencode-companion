import type { ConnectionResult } from "./opencode.js";

export interface CheckConnectionMessage {
  type: "check-connection";
  serverUrl: string;
  serverPassword: string;
}

export interface CheckConnectionResultMessage {
  type: "check-connection-result";
  result: ConnectionResult;
}

export interface SelectSessionMessage {
  type: "select-session";
  sessionId: string;
}

export type BackgroundMessage = CheckConnectionMessage;
export type PopupMessage = CheckConnectionResultMessage;
export type PanelMessage = SelectSessionMessage;