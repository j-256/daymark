export interface Account {
  id: string;
  name: string;
  email: string;
  role: string;
}
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}
export async function api<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.headers.get("Content-Type")?.includes("application/json"))
    throw new ApiError("Sign in through Access to continue", 403, "access_required");
  const data = (await response.json()) as Record<string, string>;
  if (!response.ok)
    throw new ApiError(
      data.message || "The request could not be completed",
      response.status,
      data.error || data.code || "request_failed",
    );
  return data as T;
}
export const message = (error: unknown) =>
  error instanceof Error ? error.message : "The action could not be completed";
