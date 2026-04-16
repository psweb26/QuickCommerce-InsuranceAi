"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, BellRing, IndianRupee, ShieldCheck, TriangleAlert } from "lucide-react";

import { ClaimsStatusChart } from "@/components/charts/ClaimsStatusChart";
import { PayoutTrendChart } from "@/components/charts/PayoutTrendChart";
import { RiskRadarChart } from "@/components/charts/RiskRadarChart";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { MetricTile } from "@/components/ui/MetricTile";
import { PayoutSimulatorModal } from "@/components/ui/PayoutSimulatorModal";
import { authApi, clearAuthState, getAuthToken, saveAuthState, simulationApi, workerApi } from "@/lib/api";
import { currencyINR, percent, prettyDate, titleCase } from "@/lib/format";
import { Claim, DashboardPayload } from "@/types";

interface RegisterForm {
  name: string;
  age: number;
  phone: string;
  delivery_platform: "Blinkit" | "Zepto" | "Instamart";
  worker_id: string;
  city: string;
  state: string;
  zone: string;
  weekly_income: number;
  experience_months: number;
  avg_orders_per_hour: number;
  working_hours_per_day: number;
  gps_permission: boolean;
  upi_id: string;
  otp: string;
}

const initialRegisterForm: RegisterForm = {
  name: "",
  age: 25,
  phone: "",
  delivery_platform: "Blinkit",
  worker_id: "",
  city: "",
  state: "",
  zone: "",
  weekly_income: 7500,
  experience_months: 6,
  avg_orders_per_hour: 3,
  working_hours_per_day: 9,
  gps_permission: true,
  upi_id: "",
  otp: "",
};

const INDIAN_STATES = [
  "Andhra Pradesh",
  "Delhi",
  "Gujarat",
  "Haryana",
  "Karnataka",
  "Kerala",
  "Maharashtra",
  "Tamil Nadu",
  "Telangana",
  "Uttar Pradesh",
  "West Bengal",
];

export default function WorkerPage() {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [simulatedOtp, setSimulatedOtp] = useState("");
  const [registerForm, setRegisterForm] = useState<RegisterForm>(initialRegisterForm);

  const [token, setToken] = useState("");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [simulatingPayout, setSimulatingPayout] = useState(false);
  const [copiedTxnId, setCopiedTxnId] = useState("");
  const [seenPayoutTxnIds, setSeenPayoutTxnIds] = useState<Set<string>>(new Set());
  const [payoutFeedInitialized, setPayoutFeedInitialized] = useState(false);
  const [payoutModal, setPayoutModal] = useState<{
    open: boolean;
    amount: number;
    upiId: string;
    transactionId: string;
    createdAt: string;
  }>({
    open: false,
    amount: 0,
    upiId: "",
    transactionId: "",
    createdAt: "",
  });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadDashboard = async (authToken: string): Promise<boolean> => {
    if (!authToken) return false;
    setLoading(true);
    setError("");
    try {
      const payload = await workerApi.dashboard(authToken);
      setDashboard(payload);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const existing = getAuthToken();
    if (existing) {
      setToken(existing);
      void loadDashboard(existing);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    const interval = setInterval(() => {
      void loadDashboard(token);
    }, 30000);
    return () => clearInterval(interval);
  }, [token]);

  const requestOtp = async (targetPhone: string) => {
    setError("");
    setMessage("");
    try {
      const res = await authApi.requestOtp(targetPhone);
      setSimulatedOtp(res.otp);
      setMessage(`OTP generated in simulation mode for ${targetPhone}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request OTP");
    }
  };

  const onLogin = async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const res = await authApi.login(phone, otp);
      saveAuthState(res.access_token, res.worker);
      setToken(res.access_token);
      setSeenPayoutTxnIds(new Set());
      setPayoutFeedInitialized(false);
      setMessage("Login successful. Live dashboard unlocked.");
      await loadDashboard(res.access_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const onRegister = async () => {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const payload = {
        ...registerForm,
        worker_id: registerForm.worker_id || `${registerForm.delivery_platform.slice(0, 3).toUpperCase()}-${Date.now()}`,
      };
      const res = await authApi.register(payload);
      saveAuthState(res.access_token, res.worker);
      setToken(res.access_token);
      setSeenPayoutTxnIds(new Set());
      setPayoutFeedInitialized(false);
      setPhone(registerForm.phone);
      setOtp("");
      setRegisterForm(initialRegisterForm);
      setMessage("Registration complete. Policy generated instantly.");
      await loadDashboard(res.access_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    clearAuthState();
    setToken("");
    setDashboard(null);
    setSeenPayoutTxnIds(new Set());
    setPayoutFeedInitialized(false);
    setMessage("Session cleared.");
  };

  const onManualRefresh = async () => {
    if (!token) return;
    setRefreshing(true);
    setError("");
    try {
      const ok = await loadDashboard(token);
      if (ok) {
        setMessage(`Dashboard refreshed at ${new Date().toLocaleTimeString("en-IN")}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const simulatePayoutNow = async () => {
    if (!token || !dashboard) return;
    setSimulatingPayout(true);
    setError("");
    try {
      await simulationApi.triggerDisruption({
        type: "store_outage",
        severity: 0.95,
        city: dashboard.worker.city,
        affected_zones: [dashboard.worker.zone],
        duration_hours: 8,
      });
      const ok = await loadDashboard(token);
      if (ok) {
        setMessage("High-impact disruption simulated. Payout engine re-evaluated your claims.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to simulate payout event");
    } finally {
      setSimulatingPayout(false);
    }
  };

  const claimsStatusData = useMemo(() => {
    if (!dashboard?.claims?.length) {
      return [
        { name: "approved", value: 0 },
        { name: "under_review", value: 0 },
        { name: "blocked", value: 0 },
        { name: "rejected", value: 0 },
      ];
    }

    const counts = dashboard.claims.reduce(
      (acc, claim) => {
        acc[claim.status] = (acc[claim.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return [
      { name: "Approved", value: counts.approved || 0 },
      { name: "Under Review", value: counts.under_review || 0 },
      { name: "Blocked", value: counts.blocked || 0 },
      { name: "Rejected", value: counts.rejected || 0 },
    ];
  }, [dashboard]);

  const payoutTrendData = useMemo(() => {
    if (!dashboard?.claims) return [];
    const approved = dashboard.claims.filter((claim) => claim.status === "approved");
    const grouped = new Map<string, number>();

    for (const claim of approved) {
      const date = new Date(claim.created_at).toLocaleDateString("en-IN", {
        month: "short",
        day: "numeric",
      });
      grouped.set(date, (grouped.get(date) || 0) + claim.payout_amount);
    }

    return Array.from(grouped.entries()).map(([date, payout]) => ({ date, payout }));
  }, [dashboard]);

  const probabilityData = useMemo(() => {
    if (!dashboard?.policy?.disruption_probabilities) return [];
    const probs = dashboard.policy.disruption_probabilities;
    const reliability = dashboard.policy.reliability_score || 0;

    return [
      { disruption: "Rain", probability: Number(((probs.rain || 0) * 100).toFixed(2)) },
      { disruption: "Traffic", probability: Number(((probs.traffic || 0) * 100).toFixed(2)) },
      { disruption: "Heat", probability: Number(((probs.heat || 0) * 100).toFixed(2)) },
      { disruption: "AQI", probability: Number(((probs.pollution || 0) * 100).toFixed(2)) },
      { disruption: "Reliability", probability: Number((reliability * 100).toFixed(2)) },
    ];
  }, [dashboard]);

  const approvedClaims = dashboard?.claims?.filter((claim: Claim) => claim.status === "approved") || [];
  const pendingClaims = dashboard?.claims?.filter((claim: Claim) => claim.status === "under_review").length || 0;
  const blockedClaims = dashboard?.claims?.filter((claim: Claim) => claim.status === "blocked").length || 0;
  const riskScoreValue = dashboard?.policy?.risk_score ?? 0;
  const lowRiskWorker = riskScoreValue <= 0.3;
  const dominantRisk = useMemo(() => {
    if (!dashboard?.policy?.disruption_probabilities) return "No clear threat";
    const entries = Object.entries(dashboard.policy.disruption_probabilities);
    if (!entries.length) return "No clear threat";
    const [maxKey] = entries.reduce((best, current) => (current[1] > best[1] ? current : best));
    return titleCase(maxKey);
  }, [dashboard]);

  const getDurationLabel = (startTime: string) => {
    const start = new Date(startTime).getTime();
    const now = Date.now();
    const diffMs = Math.max(now - start, 0);
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `Active for ${hours}h ${mins}m`;
  };

  const copyTxn = async (txnId: string) => {
    try {
      await navigator.clipboard.writeText(txnId);
      setCopiedTxnId(txnId);
      setTimeout(() => setCopiedTxnId(""), 1500);
    } catch {
      setError("Unable to copy transaction ID");
    }
  };

  const parseTxnId = (note: { message: string; transaction_id?: string }) => {
    if (note.transaction_id) return note.transaction_id;
    const match = note.message.match(/Txn:\s*([A-Z0-9]+)/i);
    return match?.[1] || "";
  };

  const parseUpiId = (note: { message: string; upi_id?: string }) => {
    if (note.upi_id) return note.upi_id;
    const match = note.message.match(/UPI\s+([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+)/i);
    return match?.[1] || "";
  };

  useEffect(() => {
    if (!dashboard?.payout_notifications?.length) return;
    if (!payoutFeedInitialized) {
      const initialTxnIds = dashboard.payout_notifications
        .map((note) => parseTxnId(note))
        .filter(Boolean);
      setSeenPayoutTxnIds(new Set(initialTxnIds));
      setPayoutFeedInitialized(true);
      return;
    }

    const latest = dashboard.payout_notifications.find((note) => parseTxnId(note));
    if (!latest) return;

    const txnId = parseTxnId(latest);
    if (!txnId || seenPayoutTxnIds.has(txnId)) return;

    setSeenPayoutTxnIds((prev) => new Set(prev).add(txnId));
    setPayoutModal({
      open: true,
      amount: latest.amount,
      upiId: parseUpiId(latest),
      transactionId: txnId,
      createdAt: latest.created_at,
    });
  }, [dashboard, seenPayoutTxnIds, payoutFeedInitialized]);

  if (!token || !dashboard) {
    return (
      <div className="space-y-6">
        <section className="glass rounded-3xl border border-white/70 p-6 shadow-glow">
          <h1 className="text-3xl font-extrabold text-slate-900" style={{ fontFamily: "var(--font-heading)" }}>
            Worker Console: OTP Login + Policy Onboarding
          </h1>
          <p className="mt-2 text-slate-600">
            Request OTP, login instantly, or register a fresh worker profile to auto-generate coverage and premium.
          </p>
          {message ? <p className="mt-3 rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-700">{message}</p> : null}
          {error ? <p className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
          {simulatedOtp ? (
            <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">Simulation OTP: {simulatedOtp}</p>
          ) : null}
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-heading)" }}>
              Existing Worker Login
            </h2>
            <div className="mt-4 space-y-3">
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm"
                placeholder="Phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
              <div className="flex gap-2">
                <button
                  className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void requestOtp(phone)}
                  disabled={!phone || loading}
                >
                  Request OTP
                </button>
                <input
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm"
                  placeholder="Enter OTP"
                  value={otp}
                  onChange={(event) => setOtp(event.target.value)}
                />
                <button
                  className="rounded-xl bg-ocean px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void onLogin()}
                  disabled={!phone || !otp || loading}
                >
                  {loading ? "Loading..." : "Login"}
                </button>
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-heading)" }}>
              New Worker Registration
            </h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-xs font-semibold text-slate-600">
                Full Name
                <input className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal" placeholder="e.g. Rohan Das" value={registerForm.name} onChange={(e) => setRegisterForm((prev) => ({ ...prev, name: e.target.value }))} />
              </label>
              <label className="space-y-1 text-xs font-semibold text-slate-600">
                Phone Number
                <input className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal" placeholder="10-digit mobile" value={registerForm.phone} onChange={(e) => setRegisterForm((prev) => ({ ...prev, phone: e.target.value }))} />
              </label>
              <label className="space-y-1 text-xs font-semibold text-slate-600">
                Worker ID
                <input className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal" placeholder="e.g. BLK-MUM-101" value={registerForm.worker_id} onChange={(e) => setRegisterForm((prev) => ({ ...prev, worker_id: e.target.value }))} />
              </label>
              <label className="space-y-1 text-xs font-semibold text-slate-600">
                Delivery Platform
                <select className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal" value={registerForm.delivery_platform} onChange={(e) => setRegisterForm((prev) => ({ ...prev, delivery_platform: e.target.value as RegisterForm["delivery_platform"] }))}>
                  <option value="Blinkit">Blinkit</option>
                  <option value="Zepto">Zepto</option>
                  <option value="Instamart">Instamart</option>
                </select>
              </label>
              <label className="space-y-1 text-xs font-semibold text-slate-600">
                City
                <input className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal" placeholder="e.g. Bengaluru" value={registerForm.city} onChange={(e) => setRegisterForm((prev) => ({ ...prev, city: e.target.value }))} />
              </label>
              <label className="space-y-1 text-xs font-semibold text-slate-600">
                State
                <select className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal" value={registerForm.state} onChange={(e) => setRegisterForm((prev) => ({ ...prev, state: e.target.value }))}>
                  <option value="">Select State</option>
                  {INDIAN_STATES.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs font-semibold text-slate-600">
                Zone / Area
                <input className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal" placeholder="e.g. Koramangala" value={registerForm.zone} onChange={(e) => setRegisterForm((prev) => ({ ...prev, zone: e.target.value }))} />
              </label>
              <label className="space-y-1 text-xs font-semibold text-slate-600">
                UPI ID
                <input className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal" placeholder="e.g. rohan@okicici" value={registerForm.upi_id} onChange={(e) => setRegisterForm((prev) => ({ ...prev, upi_id: e.target.value }))} />
              </label>
              <label className="space-y-1 text-xs font-semibold text-slate-600">
                Weekly Income (INR)
                <input type="number" min={1000} step={100} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal" value={registerForm.weekly_income} onChange={(e) => setRegisterForm((prev) => ({ ...prev, weekly_income: Number(e.target.value) }))} />
              </label>
              <label className="space-y-1 text-xs font-semibold text-slate-600">
                Experience (Months)
                <input type="number" min={0} step={1} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal" value={registerForm.experience_months} onChange={(e) => setRegisterForm((prev) => ({ ...prev, experience_months: Number(e.target.value) }))} />
              </label>
              <label className="space-y-1 text-xs font-semibold text-slate-600">
                Avg Orders per Hour
                <input type="number" min={0.5} step={0.1} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal" value={registerForm.avg_orders_per_hour} onChange={(e) => setRegisterForm((prev) => ({ ...prev, avg_orders_per_hour: Number(e.target.value) }))} />
              </label>
              <label className="space-y-1 text-xs font-semibold text-slate-600">
                Working Hours per Day
                <input type="number" min={1} max={16} step={0.5} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal" value={registerForm.working_hours_per_day} onChange={(e) => setRegisterForm((prev) => ({ ...prev, working_hours_per_day: Number(e.target.value) }))} />
              </label>
              <label className="space-y-1 text-xs font-semibold text-slate-600">
                Age
                <input type="number" min={18} max={65} step={1} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal" value={registerForm.age} onChange={(e) => setRegisterForm((prev) => ({ ...prev, age: Number(e.target.value) }))} />
              </label>
              <label className="space-y-1 text-xs font-semibold text-slate-600">
                OTP
                <input className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal" placeholder="6-digit OTP" value={registerForm.otp} onChange={(e) => setRegisterForm((prev) => ({ ...prev, otp: e.target.value }))} />
              </label>
            </div>
            <p className="mt-2 text-xs text-slate-500">Prefilled numbers are demo defaults; you can edit them.</p>
            <div className="mt-3 flex gap-2">
              <button
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void requestOtp(registerForm.phone)}
                disabled={!registerForm.phone || loading}
              >
                Request OTP
              </button>
              <button
                className="rounded-xl bg-ember px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void onRegister()}
                disabled={loading}
              >
                {loading ? "Creating..." : "Register + Activate Policy"}
              </button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="glass rounded-3xl border border-white/70 p-6 shadow-glow">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900" style={{ fontFamily: "var(--font-heading)" }}>
              Welcome, {dashboard.worker.name}
            </h1>
            <p className="mt-1 text-slate-600">
              {dashboard.worker.delivery_platform} | {dashboard.worker.city}, {dashboard.worker.zone}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Badge tone={lowRiskWorker ? "good" : "warn"}>{lowRiskWorker ? "Low Risk Reward" : "Elevated Risk Watch"}</Badge>
              <Badge tone="neutral">Active Disruptions: {dashboard.live_disruptions.length}</Badge>
              <Badge tone="warn">Pending Verification: {pendingClaims}</Badge>
              <Badge tone={blockedClaims > 0 ? "alert" : "good"}>Fraud Blocks: {blockedClaims}</Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="neutral">Worker ID: {dashboard.worker.worker_id}</Badge>
            <button
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void onManualRefresh()}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white" onClick={logout}>
              Logout
            </button>
          </div>
        </div>

        {message ? <p className="mt-3 rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          title="Weekly Premium"
          value={currencyINR(dashboard.policy.premium_amount)}
          hint={dashboard.policy.pricing_tier}
          icon={<IndianRupee className="h-4 w-4 text-emerald-600" />}
        />
        <MetricTile
          title="Coverage Left"
          value={currencyINR(dashboard.policy.remaining_coverage)}
          hint={`Claims ${dashboard.policy.claims_used}/${dashboard.policy.max_claims_per_week}`}
          icon={<ShieldCheck className="h-4 w-4 text-teal-600" />}
        />
        <MetricTile
          title="Risk Score"
          value={dashboard.policy.risk_score.toFixed(3)}
          hint={`Exposure ${dashboard.policy.exposure_score.toFixed(3)}`}
          icon={<TriangleAlert className="h-4 w-4 text-orange-600" />}
        />
        <MetricTile
          title="Reliability"
          value={dashboard.policy.reliability_score.toFixed(3)}
          hint="Used in personalized payout"
          icon={<Activity className="h-4 w-4 text-slate-700" />}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-heading)" }}>
              Risk Profile Radar
            </h2>
            <Badge tone="warn">Current Threat: {dominantRisk}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-600">Rain, traffic, heat, AQI, and reliability are shown on explicit axes.</p>
          <RiskRadarChart data={probabilityData} />
        </Card>

        <Card>
          <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-heading)" }}>
            Claim Decision Mix
          </h2>
          <p className="mt-1 text-sm text-slate-600">Auto outcomes from eligibility + fraud engine.</p>
          <ClaimsStatusChart data={claimsStatusData} />
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-heading)" }}>
              Payout Trend
            </h2>
            <button
              className="rounded-lg bg-ocean px-3 py-1 text-xs font-semibold text-white"
              onClick={async () => {
                await workerApi.refreshPolicy(token);
                await loadDashboard(token);
                setMessage("Policy refreshed using latest risk intelligence.");
              }}
            >
              Reprice Policy
            </button>
          </div>
          {payoutTrendData.length ? (
            <PayoutTrendChart data={payoutTrendData} />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4 text-sm text-slate-600">
              <p>No approved payouts yet, so trend is empty right now.</p>
              <button
                className="mt-3 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void simulatePayoutNow()}
                disabled={simulatingPayout}
              >
                {simulatingPayout ? "Simulating..." : "Simulate Payout Event"}
              </button>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-heading)" }}>
            Payout Notifications
          </h2>
          <div className="soft-scroll mt-3 max-h-64 space-y-2 overflow-auto pr-1">
            {dashboard.payout_notifications.length ? (
              dashboard.payout_notifications.map((note) => (
                <div key={`${note.created_at}-${note.message}`} className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-3 text-sm text-emerald-800">
                  <p className="font-semibold">{note.message}</p>
                  {parseTxnId(note) ? (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-white/70 px-2 py-1 text-xs">
                      <span className="font-medium text-emerald-900">Txn ID: {parseTxnId(note)}</span>
                      <button
                        className="rounded-md border border-emerald-300 bg-white px-2 py-1 font-semibold text-emerald-700 hover:bg-emerald-50"
                        onClick={() => void copyTxn(parseTxnId(note))}
                      >
                        {copiedTxnId === parseTxnId(note) ? "Copied" : "Copy Transaction ID"}
                      </button>
                    </div>
                  ) : null}
                  <p className="mt-1 text-xs">{prettyDate(note.created_at)}</p>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4 text-sm text-slate-600">
                <p>No payout notifications yet.</p>
                <button
                  className="mt-3 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void simulatePayoutNow()}
                  disabled={simulatingPayout}
                >
                  {simulatingPayout ? "Simulating..." : "Generate Demo Payout"}
                </button>
              </div>
            )}
          </div>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-heading)" }}>
            Live Disruptions
          </h2>
          <div className="soft-scroll mt-3 max-h-72 space-y-2 overflow-auto pr-1">
            {dashboard.live_disruptions.length ? (
              dashboard.live_disruptions.map((event) => (
                <article key={event._id || event.id} className="rounded-xl border border-slate-200 bg-white/90 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-slate-900">{titleCase(event.type)}</p>
                    <Badge tone={event.severity > 0.7 ? "alert" : "warn"}>Severity {percent(event.severity)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {event.city} | {event.affected_zones.join(", ")}
                  </p>
                  <p className="mt-1 text-xs font-medium text-teal-700">{getDurationLabel(event.start_time)}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {prettyDate(event.start_time)} to {prettyDate(event.end_time)}
                  </p>
                </article>
              ))
            ) : (
              <p className="text-sm text-slate-500">No active disruptions around your zone.</p>
            )}
          </div>
        </Card>

        <Card>
          <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-heading)" }}>
            Recent Claims
          </h2>
          <div className="soft-scroll mt-3 max-h-72 space-y-2 overflow-auto pr-1">
            {dashboard.claims.length ? (
              dashboard.claims.slice(0, 12).map((claim) => (
                <article key={claim._id || claim.id} className="rounded-xl border border-slate-200 bg-white/90 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-slate-900">{titleCase(claim.disruption_type)}</p>
                    <Badge tone={claim.status === "approved" ? "good" : claim.status === "under_review" ? "warn" : "alert"}>
                      {titleCase(claim.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Work loss {percent(claim.work_loss_ratio)}</p>
                  <p className="mt-1 text-sm text-slate-800">Payout: {currencyINR(claim.payout_amount)}</p>
                  <p className="mt-1 text-xs text-slate-500">{claim.reason}</p>
                </article>
              ))
            ) : (
              <p className="text-sm text-slate-500">Claims will appear automatically after disruptions are detected.</p>
            )}
          </div>
        </Card>
      </section>

      <section className="glass rounded-2xl border border-white/70 p-4 text-sm text-slate-600">
        <p className="font-semibold text-slate-800">Zero-touch claims rule is active.</p>
        <p className="mt-1">
          Claims are generated only by disruption monitors. Manual claim submission is intentionally disabled.
        </p>
        <p className="mt-1 inline-flex items-center gap-2 rounded-md bg-white/80 px-2 py-1 text-xs font-medium text-slate-700">
          <BellRing className="h-3 w-3" />
          Approved payouts in this session: {approvedClaims.length}
        </p>
      </section>

      <PayoutSimulatorModal
        open={payoutModal.open}
        amount={payoutModal.amount}
        upiId={payoutModal.upiId}
        transactionId={payoutModal.transactionId}
        createdAt={payoutModal.createdAt}
        onClose={() => setPayoutModal((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
}



