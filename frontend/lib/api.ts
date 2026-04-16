import { API_BASE_URL, STORAGE_KEYS } from "@/lib/constants";
import { DashboardPayload, LiveOperationsPayload, PredictiveRiskPayload } from "@/types";

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
      cache: "no-store",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network error";
    throw new Error(
      `Backend unreachable at ${API_BASE_URL}. Start backend on port 8000 and retry. (${reason})`,
    );
  }

  if (!response.ok) {
    const fallback = await response.text();
    throw new Error(fallback || `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const authApi = {
  requestOtp: (phone: string) => request<{ otp: string; message: string }>("/auth/request-otp", {
    method: "POST",
    body: JSON.stringify({ phone }),
  }),

  register: (payload: Record<string, unknown>) =>
    request<{ access_token: string; worker: any; policy: any }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  login: (phone: string, otp: string) =>
    request<{ access_token: string; worker: any; policy: any }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ phone, otp }),
    }),
};

export const workerApi = {
  dashboard: (token: string) => request<DashboardPayload>("/workers/me/dashboard", {}, token),
  claims: (token: string) => request<{ items: any[] }>("/workers/me/claims", {}, token),
  disruptions: (token: string) => request<{ items: any[] }>("/workers/me/disruptions", {}, token),
  refreshPolicy: (token: string) =>
    request<{ policy: any }>("/policies/me/refresh", { method: "POST" }, token),
};

export const adminApi = {
  metrics: () => request<{ metrics: any }>("/admin/metrics"),
  disruptionAnalytics: () => request<{ items: any[] }>("/admin/disruption-analytics"),
  fraudAlerts: () => request<{ items: any[] }>("/admin/fraud-alerts"),
  claims: () => request<{ items: any[] }>("/admin/claims"),
  workers: () => request<{ items: any[] }>("/admin/workers"),
  runMonitoring: () => request<{ summary: any }>("/admin/run-monitoring", { method: "POST" }),
  triggerDisruption: (payload: Record<string, unknown>) =>
    request<{ event: any }>("/admin/trigger-disruption", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  liveOperations: (city?: string, zone?: string) => {
    const query = new URLSearchParams();
    if (city) query.set("city", city);
    if (zone) query.set("zone", zone);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return request<LiveOperationsPayload>(`/admin/live-operations${suffix}`);
  },
  predictiveRisk: (lookbackDays = 21, horizonDays = 7) =>
    request<PredictiveRiskPayload>(
      `/admin/predictive-risk?lookback_days=${lookbackDays}&horizon_days=${horizonDays}`,
    ),
};

export const simulationApi = {
  seed: () => request<{ summary: any }>("/simulation/seed", { method: "POST" }),
  runMonitoring: () => request<{ summary: any }>("/simulation/run-monitoring", { method: "POST" }),
  triggerDisruption: (payload: Record<string, unknown>) =>
    request<{ event: any }>("/simulation/trigger-disruption", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

export function saveAuthState(token: string, worker: unknown) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEYS.token, token);
  localStorage.setItem(STORAGE_KEYS.worker, JSON.stringify(worker));
}

export function clearAuthState() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEYS.token);
  localStorage.removeItem(STORAGE_KEYS.worker);
}

export function getAuthToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(STORAGE_KEYS.token) || "";
}


