export type OpenCodeError =
  | { kind: "unreachable"; detail: string }
  | { kind: "unauthorized"; passwordProvided: boolean }
  | { kind: "server"; status: number; detail: string };

export type Result<T> = { ok: true; value: T } | { ok: false; error: OpenCodeError };

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function statusOf(err: unknown): number | undefined {
  if (err instanceof Error && err.cause !== undefined && typeof err.cause === "object") {
    const status = (err.cause as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

/** Attach an HTTP status to an Error so {@link statusOf} can recover it. */
export function httpError(status: number, detail: string): Error {
  const err = new Error(detail);
  (err as Error & { cause?: unknown }).cause = { status };
  return err;
}

export function toResult<T>(err: unknown, passwordProvided: boolean): Result<T> {
  const status = statusOf(err);
  if (status === 401 || status === 403) {
    return { ok: false, error: { kind: "unauthorized", passwordProvided } };
  }
  if (status !== undefined) {
    return { ok: false, error: { kind: "server", status, detail: messageOf(err) } };
  }
  return { ok: false, error: { kind: "unreachable", detail: messageOf(err) } };
}
