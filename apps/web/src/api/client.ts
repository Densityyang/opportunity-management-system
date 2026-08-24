export interface ProblemDetails {
  status: number;
  detail: string;
  errorCode: string;
}

export class ApiError extends Error {
  constructor(public readonly problem: ProblemDetails) {
    super(problem.detail);
  }
}

const API_BASE = "/api/v1";
const ACTIVE_GRANT_KEY = "oms.activeGrantId";

/**
 * RFC 4122 v4 UUID.
 * `crypto.randomUUID()` only exists in secure contexts (https/localhost),
 * which breaks deployments served over plain http + IP. Fall back to
 * `crypto.getRandomValues()`, which is available in all contexts.
 */
export function randomUuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Byte 6 keeps its low nibble (version 4), byte 8 its low two bits (variant).
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getActiveGrantId(): string | null {
  return localStorage.getItem(ACTIVE_GRANT_KEY);
}

export function setActiveGrantId(grantId: string | null): void {
  if (grantId) localStorage.setItem(ACTIVE_GRANT_KEY, grantId);
  else localStorage.removeItem(ACTIVE_GRANT_KEY);
}

async function parseError(response: Response): Promise<never> {
  const fallback: ProblemDetails = {
    status: response.status,
    detail: `请求失败（${response.status}）`,
    errorCode: `HTTP_${response.status}`,
  };
  try {
    const body = (await response.json()) as Partial<ProblemDetails>;
    throw new ApiError({
      status: response.status,
      detail: body.detail ?? fallback.detail,
      errorCode: body.errorCode ?? fallback.errorCode,
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(fallback);
  }
}

function headers(extra?: HeadersInit): Headers {
  const result = new Headers(extra);
  const grantId = getActiveGrantId();
  if (grantId) result.set("X-Role-Grant-Id", grantId);
  return result;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const requestHeaders = headers(init.headers);
  if (
    init.body &&
    !(init.body instanceof FormData) &&
    !requestHeaders.has("Content-Type")
  )
    requestHeaders.set("Content-Type", "application/json");
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: requestHeaders,
    credentials: "include",
  });
  if (!response.ok) return parseError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function transition<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, {
    method: "POST",
    headers: { "Idempotency-Key": randomUuid() },
    body: JSON.stringify(body),
  });
}

export async function download(
  path: string,
  body: unknown,
  reauthToken: string,
): Promise<Blob> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: headers({
      "Content-Type": "application/json",
      "X-Reauth-Token": reauthToken,
    }),
    body: JSON.stringify(body),
  });
  if (!response.ok) return parseError(response);
  return response.blob();
}

export async function fetchAudio(opportunityId: string): Promise<Blob> {
  const response = await fetch(
    `${API_BASE}/opportunities/${opportunityId}/audio`,
    { credentials: "include", headers: headers() },
  );
  if (!response.ok) return parseError(response);
  return response.blob();
}
