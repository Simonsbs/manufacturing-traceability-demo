import { object } from "./domain.ts";
import type { Role, Snapshot } from "./domain.ts";
export type Session = {
  workspaceId: string;
  expiresAt: string;
  capabilities: Record<Role, string>;
};
const key = "traceability-lab-session-v1";
export function loadSession(): Session | null {
  try {
    const s: Session = JSON.parse(localStorage.getItem(key) ?? "null");
    return s &&
      /^[a-f0-9-]{36}$/.test(s.workspaceId) &&
      Date.parse(s.expiresAt) > Date.now() &&
      ["operator", "reviewer", "observer"].every((r) =>
        /^[a-f0-9]{64}$/.test(s.capabilities?.[r as Role]),
      )
      ? s
      : null;
  } catch {
    return null;
  }
}
export function saveSession(s: Session): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}
export async function api<T>(
  path: string,
  session?: Session | null,
  role: Role = "operator",
  body?: unknown,
): Promise<T> {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(session
          ? { Authorization: "Bearer " + session.capabilities[role] }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        object(data) &&
          object(data.error) &&
          typeof data.error.message === "string"
          ? data.error.message
          : "The request failed. Refresh the workspace and retry.",
      );
    return data as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError")
      throw new Error(
        "The request timed out. Refresh before retrying; repeated imports of the same file use the same request identifier.",
      );
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}
export type Result = { snapshot: Snapshot; replayed?: boolean };
