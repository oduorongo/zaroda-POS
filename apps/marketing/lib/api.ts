const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const json: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof json === "object" && json && "message" in json && typeof (json as { message: unknown }).message === "string"
        ? (json as { message: string }).message
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return json as T;
}

export const apiGet = <T>(path: string) => apiFetch<T>(path, { method: "GET" });
export const apiPost = <T>(path: string, body: unknown) => apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
