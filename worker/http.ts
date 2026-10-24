import { LIMITS } from "../src/shared/validation";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const json = (value: unknown, status = 200) => Response.json(value, { status });
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new HttpError(415, "json_required", "Send JSON data");
  if (Number(request.headers.get("content-length")) > LIMITS.body)
    throw new HttpError(413, "body_too_large", "This upload is too large");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "body_required", "Missing request body");
  let length = 0;
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > LIMITS.body) {
      await reader.cancel();
      throw new HttpError(413, "body_too_large", "This upload is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try {
    const result = JSON.parse(text);
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
    return result;
  } catch {
    throw new HttpError(400, "invalid_json", "Invalid JSON data");
  }
}
