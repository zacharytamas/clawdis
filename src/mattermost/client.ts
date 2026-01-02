import { loadConfig, type ClawdisConfig } from "../config/config.js";

export type MattermostAuth = {
  baseUrl: string;
  token: string;
};

export type MattermostClient = {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
};

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

export function resolveMattermostAuth(params: {
  baseUrl?: string;
  token?: string;
  cfg?: ClawdisConfig;
}): MattermostAuth {
  const cfg = params.cfg ?? loadConfig();
  const baseUrl =
    params.baseUrl ??
    process.env.MATTERMOST_URL ??
    cfg.mattermost?.baseUrl ??
    "";
  const token =
    params.token ??
    process.env.MATTERMOST_TOKEN ??
    cfg.mattermost?.token ??
    "";
  const trimmedUrl = baseUrl.trim();
  const trimmedToken = token.trim();
  if (!trimmedUrl || !trimmedToken) {
    throw new Error(
      "MATTERMOST_URL/MATTERMOST_TOKEN or mattermost.baseUrl/token is required",
    );
  }
  return { baseUrl: normalizeBaseUrl(trimmedUrl), token: trimmedToken };
}

export function resolveMattermostWsUrl(params: {
  baseUrl: string;
  wsUrl?: string;
}): string {
  const explicit = params.wsUrl?.trim();
  if (explicit) return normalizeBaseUrl(explicit);
  const url = new URL(params.baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return normalizeBaseUrl(url.toString());
}

export function createMattermostClient(
  auth: MattermostAuth,
  fetchImpl?: typeof fetch,
): MattermostClient {
  const fetcher = fetchImpl ?? globalThis.fetch;
  if (!fetcher) {
    throw new Error("fetch is not available for Mattermost requests");
  }
  const request = async <T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> => {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    const url = `${auth.baseUrl}${normalized}`;
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${auth.token}`);
    headers.set("Accept", "application/json");
    const body = init.body;
    const isFormData =
      typeof FormData !== "undefined" && body instanceof FormData;
    if (body && !isFormData && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const res = await fetcher(url, { ...init, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text ? `${res.status}: ${text}` : `HTTP ${res.status}`);
    }
    const text = await res.text().catch(() => "");
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Invalid JSON response from Mattermost (${url})`);
    }
  };
  return { request };
}
