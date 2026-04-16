"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bot, DatabaseZap, Radar } from "lucide-react";

import { ClaimsStatusChart } from "@/components/charts/ClaimsStatusChart";
import { DisruptionBarChart } from "@/components/charts/DisruptionBarChart";
import { PredictiveRiskChart } from "@/components/charts/PredictiveRiskChart";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { MetricTile } from "@/components/ui/MetricTile";
import { adminApi, simulationApi } from "@/lib/api";
import { currencyINR, percent, prettyDate, titleCase } from "@/lib/format";
import { Claim, FraudAlert, LiveOperationsPayload, PredictiveRiskPayload } from "@/types";

const LiveOperationsMap = dynamic(
  () =>
    import("@/components/maps/LiveOperationsMap").then((mod) => mod.LiveOperationsMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[430px] items-center justify-center rounded-2xl border border-slate-200 bg-white/70 text-sm text-slate-500">
        Loading map...
      </div>
    ),
  },
);

interface AdminMetrics {
  total_workers: number;
  active_policies: number;
  total_premium_collected: number;
  total_payouts: number;
  loss_ratio: number;
  fraud_alerts: number;
  active_disruptions: number;
}

const initialMetrics: AdminMetrics = {
  total_workers: 0,
  active_policies: 0,
  total_premium_collected: 0,
  total_payouts: 0,
  loss_ratio: 0,
  fraud_alerts: 0,
  active_disruptions: 0,
};

export default function AdminPage() {
  const [metrics, setMetrics] = useState<AdminMetrics>(initialMetrics);
  const [analytics, setAnalytics] = useState<Array<{ type: string; count: number; avg_severity: number }>>([]);
  const [fraudAlerts, setFraudAlerts] = useState<FraudAlert[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [liveOps, setLiveOps] = useState<LiveOperationsPayload | null>(null);
  const [predictive, setPredictive] = useState<PredictiveRiskPayload | null>(null);

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<"" | "seed" | "monitor" | "refresh" | "fraud" | "godmode">("");
  const [godModeUnlocked, setGodModeUnlocked] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [processingOverlay, setProcessingOverlay] = useState(false);
  const [processingStep, setProcessingStep] = useState("");

  const [manualEvent, setManualEvent] = useState({
    type: "rain",
    severity: 0.8,
    city: "Mumbai",
    zone: "Andheri-West",
    duration_hours: 3,
  });

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [metricsRes, analyticsRes, fraudRes, claimsRes, liveOpsRes, predictiveRes] = await Promise.all([
        adminApi.metrics(),
        adminApi.disruptionAnalytics(),
        adminApi.fraudAlerts(),
        adminApi.claims(),
        adminApi.liveOperations(),
        adminApi.predictiveRisk(),
      ]);

      setMetrics(metricsRes.metrics as AdminMetrics);
      setAnalytics(analyticsRes.items as Array<{ type: string; count: number; avg_severity: number }>);
      setFraudAlerts(fraudRes.items as FraudAlert[]);
      setClaims(claimsRes.items as Claim[]);
      setLiveOps(liveOpsRes);
      setPredictive(predictiveRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load admin data");
    } finally {
      setLoading(false);
    }
  };

  const refreshLiveOps = async () => {
    try {
      const payload = await adminApi.liveOperations();
      setLiveOps(payload);
    } catch {
      // Keep dashboard stable even if map refresh fails temporarily.
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      void refreshLiveOps();
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  const blockedWorkerIds = useMemo(
    () =>
      new Set(
        fraudAlerts
          .filter((alert) => alert.fraud_risk_score >= 0.6 || Boolean(alert.signals?.ImpossibleVelocityFlag))
          .map((alert) => alert.worker_id),
      ),
    [fraudAlerts],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "g") {
        setGodModeUnlocked((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const claimStatusData = useMemo(() => {
    const counts = claims.reduce(
      (acc, claim) => {
        const effectiveStatus = blockedWorkerIds.has(claim.worker_id)
          ? "rejected_fraud"
          : claim.status === "under_review"
            ? "pending_verification"
            : claim.status;
        acc[effectiveStatus] = (acc[effectiveStatus] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return [
      { name: "Approved", value: counts.approved || 0 },
      {
        name: "Rejected (Fraud)",
        value: (counts.blocked || 0) + (counts.rejected || 0) + (counts.rejected_fraud || 0),
      },
      { name: "Pending Verification", value: counts.pending_verification || 0 },
    ];
  }, [claims, blockedWorkerIds]);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const seedData = async () => {
    setActionLoading("seed");
    setMessage("Seeding sample workers and policies...");
    setError("");
    try {
      const res = await simulationApi.seed();
      setMessage(
        `Seed complete: workers ${res.summary.workers_created}, disruptions ${res.summary.disruptions_detected}, claims ${res.summary.claims_generated}`,
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Seed failed");
    } finally {
      setActionLoading("");
    }
  };

  const runMonitoring = async () => {
    setActionLoading("monitor");
    setMessage("Running disruption monitor cycle...");
    setError("");
    try {
      const res = await simulationApi.runMonitoring();
      setMessage(
        `Monitoring completed: disruptions ${res.summary.disruptions_detected}, claims ${res.summary.claims_generated}, approved ${res.summary.approved_claims}`,
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Monitoring failed");
    } finally {
      setActionLoading("");
    }
  };

  const triggerManualEvent = async () => {
    setActionLoading("monitor");
    setMessage("Triggering manual disruption event...");
    setError("");
    setProcessingOverlay(true);
    try {
      setProcessingStep("Scanning 14 active zones...");
      await sleep(350);
      setProcessingStep("Identifying 8 eligible workers...");
      await sleep(350);
      await simulationApi.triggerDisruption({
        type: manualEvent.type,
        severity: manualEvent.severity,
        city: manualEvent.city,
        affected_zones: [manualEvent.zone],
        duration_hours: manualEvent.duration_hours,
      });
      setProcessingStep("Payouts initiated.");
      await sleep(450);
      setMessage("Manual disruption triggered. Claims engine processed affected workers.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trigger failed");
    } finally {
      setProcessingOverlay(false);
      setActionLoading("");
    }
  };

  const refreshMetrics = async () => {
    setActionLoading("refresh");
    setMessage("Refreshing metrics...");
    setError("");
    try {
      await loadData();
      setMessage(`Metrics refreshed at ${new Date().toLocaleTimeString("en-IN")}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setActionLoading("");
    }
  };

  const generateFraudAlerts = async () => {
    setActionLoading("fraud");
    setMessage("Generating demo fraud alerts...");
    setError("");
    try {
      await simulationApi.seed();
      const events = [
        { type: "store_outage", severity: 0.98, city: "Mumbai", affected_zones: ["Andheri-West"], duration_hours: 10 },
        { type: "server_outage", severity: 0.96, city: "Bengaluru", affected_zones: ["Koramangala"], duration_hours: 9 },
        { type: "traffic", severity: 0.94, city: "Hyderabad", affected_zones: ["Gachibowli"], duration_hours: 8 },
      ];

      for (const event of events) {
        await simulationApi.triggerDisruption(event);
      }

      await loadData();
      setMessage("Demo fraud alerts generated. Check the latest fraud panel.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate fraud alerts");
    } finally {
      setActionLoading("");
    }
  };

  const triggerGodModeRain = async () => {
    setActionLoading("godmode");
    setMessage("God Mode active: injecting heavy rain disruption...");
    setError("");
    try {
      await adminApi.triggerDisruption({
        type: "rain",
        severity: 0.98,
        city: manualEvent.city || "Mumbai",
        affected_zones: [manualEvent.zone || "Andheri-West"],
        duration_hours: 8,
      });
      await loadData();
      setMessage("God Mode complete: disruption inserted and zero-touch claims executed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "God Mode trigger failed");
    } finally {
      setActionLoading("");
    }
  };

  const controlsDisabled = actionLoading !== "";
  const liveOpsSummary = liveOps?.summary;
  const nextWeekProjection = predictive?.forecast?.[0]?.likely_payout ?? 0;

  return (
    <div className="space-y-6">
      <section className="glass rounded-3xl border border-white/70 p-6 shadow-glow">
        <h1 className="text-3xl font-extrabold text-slate-900" style={{ fontFamily: "var(--font-heading)" }}>
          Admin Command Center
        </h1>
        <p className="mt-2 text-slate-600">
          Production simulation controls for monitoring, fraud surveillance, and automated claim orchestration.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Badge tone="neutral">Mode: Demo Orchestration</Badge>
          <Badge tone="good">Workers Tracked: {liveOpsSummary?.workers_tracked ?? 0}</Badge>
          <Badge tone="warn">Eligible Live: {liveOpsSummary?.eligible_workers ?? 0}</Badge>
          <Badge tone="alert">Next Week Likely Payout: {currencyINR(nextWeekProjection)}</Badge>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="rounded-xl border border-slate-900 bg-ocean px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-700 disabled:opacity-100"
            onClick={() => void seedData()}
            disabled={controlsDisabled}
          >
            {actionLoading === "seed" ? "Seeding..." : "Seed Demo Data"}
          </button>
          <button
            className={`rounded-xl border px-4 py-2 text-sm font-semibold shadow-sm transition ${
              controlsDisabled
                ? "cursor-not-allowed border-slate-400 bg-slate-300 text-slate-800"
                : "border-teal-800 bg-teal-700 text-white hover:bg-teal-800"
            }`}
            onClick={() => void runMonitoring()}
            disabled={controlsDisabled}
          >
            {actionLoading === "monitor" ? "Running..." : "Run Monitoring Now"}
          </button>
          <button
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-700 disabled:opacity-100"
            onClick={() => void refreshMetrics()}
            disabled={controlsDisabled}
          >
            {actionLoading === "refresh" ? "Refreshing..." : "Refresh Metrics"}
          </button>
          {godModeUnlocked ? (
            <button
              className="rounded-xl border border-rose-800 bg-rose-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-800 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500"
              onClick={() => void triggerGodModeRain()}
              disabled={controlsDisabled}
            >
              {actionLoading === "godmode" ? "Triggering..." : "God Mode: Trigger Heavy Rain"}
            </button>
          ) : (
            <button
              className="rounded-xl border border-dashed border-slate-300 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-white"
              onClick={() => setGodModeUnlocked(true)}
              disabled={controlsDisabled}
              title="Hidden mode shortcut: Ctrl+Shift+G"
            >
              Unlock God Mode
            </button>
          )}
        </div>

        {message ? <p className="mt-3 rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        <p className="mt-2 text-xs text-slate-500">Hidden shortcut: press Ctrl+Shift+G to toggle God Mode controls.</p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <MetricTile title="Workers" value={`${metrics.total_workers}`} icon={<Bot className="h-4 w-4 text-slate-700" />} />
        <MetricTile title="Active Policies" value={`${metrics.active_policies}`} icon={<Radar className="h-4 w-4 text-teal-700" />} />
        <MetricTile
          title="Premium Collected"
          value={currencyINR(metrics.total_premium_collected)}
          icon={<DatabaseZap className="h-4 w-4 text-emerald-700" />}
        />
        <MetricTile
          title="Total Payouts"
          value={currencyINR(metrics.total_payouts)}
          hint="From payout ledger"
          icon={<AlertTriangle className="h-4 w-4 text-orange-700" />}
        />
        <MetricTile
          title="Loss Ratio"
          value={percent(metrics.loss_ratio)}
          valueClassName={metrics.loss_ratio <= 1 ? "text-emerald-700" : "text-rose-700"}
          hint={
            metrics.loss_ratio >= 0.6 && metrics.loss_ratio <= 0.7
              ? "Sustainable band"
              : metrics.loss_ratio < 0.6
                ? "Conservative pricing"
                : "Aggressive payout pressure"
          }
          hintClassName={metrics.loss_ratio <= 1 ? "text-emerald-700" : "text-rose-700"}
          icon={<AlertTriangle className="h-4 w-4 text-rose-700" />}
        />
      </section>

      <section className="glass rounded-2xl border border-white/70 p-4">
        <h2 className="text-lg font-bold text-slate-900" style={{ fontFamily: "var(--font-heading)" }}>
          3-Minute Pitch Flow
        </h2>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Step 1</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Seed realistic workers + policies</p>
            <p className="mt-1 text-xs text-slate-600">Click Seed Demo Data to initialize premium, disruption, and fraud streams.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Step 2</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Trigger manual disruption</p>
            <p className="mt-1 text-xs text-slate-600">Use Trigger Event to show zero-touch claims and fraud checks in real time.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Step 3</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Prove business sustainability</p>
            <p className="mt-1 text-xs text-slate-600">Loss ratio, forecasted payouts, and fraud blocks stay visible for judges.</p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-heading)" }}>
            Disruption Analytics
          </h2>
          <p className="mt-1 text-sm text-slate-600">Count vs average severity by disruption type.</p>
          <DisruptionBarChart data={analytics} />
        </Card>

        <Card>
          <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-heading)" }}>
            Claim Outcome Distribution
          </h2>
          <p className="mt-1 text-sm text-slate-600">Zero-touch claim engine decisions.</p>
          <ClaimsStatusChart data={claimStatusData} />
        </Card>
      </section>

      <Card>
        <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-heading)" }}>
          Live Operations Map
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Red geofences represent active disruptions. Workers inside any geofence are marked eligible.
        </p>
        <div className="mt-3">
          <LiveOperationsMap
            disruptions={liveOps?.disruptions || []}
            workerPings={liveOps?.worker_pings || []}
          />
        </div>
      </Card>

      <Card>
        <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-heading)" }}>
          Predictive Risk: Likely Payouts (Next Week)
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Model: {predictive?.model || "moving_average_weather_adjusted"} | Weather-adjusted moving average forecast.
        </p>
        <PredictiveRiskChart history={predictive?.history || []} forecast={predictive?.forecast || []} />
      </Card>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-heading)" }}>
            Trigger Manual Disruption (Demo)
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Useful for live demos: event instantly invokes claim processing for impacted zones.
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={manualEvent.type} onChange={(e) => setManualEvent((prev) => ({ ...prev, type: e.target.value }))}>
              <option value="rain">Rain</option>
              <option value="flood">Flood</option>
              <option value="heat">Heat</option>
              <option value="pollution">Pollution</option>
              <option value="traffic">Traffic</option>
              <option value="strike">Strike</option>
              <option value="curfew">Curfew</option>
              <option value="store_outage">Store Outage</option>
              <option value="server_outage">Server Outage</option>
              <option value="power_outage">Power Outage</option>
            </select>
            <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="City" value={manualEvent.city} onChange={(e) => setManualEvent((prev) => ({ ...prev, city: e.target.value }))} />
            <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Zone" value={manualEvent.zone} onChange={(e) => setManualEvent((prev) => ({ ...prev, zone: e.target.value }))} />
            <input type="number" min={0.1} max={1} step={0.05} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Severity" value={manualEvent.severity} onChange={(e) => setManualEvent((prev) => ({ ...prev, severity: Number(e.target.value) }))} />
            <input type="number" min={0.5} max={24} step={0.5} className="rounded-xl border border-slate-200 px-3 py-2 text-sm md:col-span-2" placeholder="Duration hours" value={manualEvent.duration_hours} onChange={(e) => setManualEvent((prev) => ({ ...prev, duration_hours: Number(e.target.value) }))} />
          </div>
          <button
            className="mt-3 rounded-xl bg-ember px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void triggerManualEvent()}
            disabled={actionLoading !== ""}
          >
            Trigger Event + Auto Claims
          </button>
        </Card>

        <Card>
          <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-heading)" }}>
            Fraud Alerts (Latest)
          </h2>
          <div className="soft-scroll mt-3 max-h-72 space-y-2 overflow-auto pr-1">
            {fraudAlerts.length ? (
              fraudAlerts.slice(0, 20).map((alert) => (
                <article key={alert._id} className="rounded-xl border border-rose-100 bg-rose-50/80 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-rose-800">Worker {alert.worker_code || alert.worker_id.slice(-6)}</p>
                    <Badge tone="alert">FRS {percent(alert.fraud_risk_score)}</Badge>
                  </div>
                  {alert.signals?.ImpossibleVelocityFlag ? (
                    <p className="mt-1 text-xs font-semibold text-rose-700">
                      Warning: High Risk worker {alert.worker_code || alert.worker_id.slice(-6)} (Impossible Velocity: {Number(alert.signals.SpeedKmph || 120).toFixed(1)} km/h detected).
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-rose-700">Action: {titleCase(alert.action)}</p>
                  <p className="mt-1 text-xs text-rose-700">{prettyDate(alert.created_at)}</p>
                </article>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4 text-sm text-slate-600">
                <p>No fraud alerts detected yet.</p>
                <button
                  className="mt-3 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                  onClick={() => void generateFraudAlerts()}
                  disabled={actionLoading !== ""}
                >
                  {actionLoading === "fraud" ? "Generating..." : "Generate Demo Fraud Alerts"}
                </button>
              </div>
            )}
          </div>
        </Card>
      </section>

      <section className="glass rounded-2xl border border-white/70 p-4">
        <h2 className="text-lg font-bold" style={{ fontFamily: "var(--font-heading)" }}>
          Latest Claims Snapshot
        </h2>
        <p className="mt-1 text-sm text-slate-600">{loading ? "Loading claim stream..." : `Showing ${claims.length} claim records`}</p>
        <div className="soft-scroll mt-3 max-h-72 overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Work Loss</th>
                <th className="px-2 py-2">FRS</th>
                <th className="px-2 py-2">Payout</th>
              </tr>
            </thead>
            <tbody>
              {claims.slice(0, 40).map((claim) => (
                <tr key={claim._id || claim.id} className="border-b border-slate-100">
                  <td className="px-2 py-2">{titleCase(claim.disruption_type)}</td>
                  <td className="px-2 py-2">
                    {blockedWorkerIds.has(claim.worker_id)
                      ? "Rejected (Fraud)"
                      : claim.status === "under_review"
                        ? "Pending Verification"
                        : titleCase(claim.status)}
                  </td>
                  <td className="px-2 py-2">{percent(claim.work_loss_ratio)}</td>
                  <td className="px-2 py-2">{percent(claim.fraud_risk_score)}</td>
                  <td className="px-2 py-2">{currencyINR(claim.payout_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {processingOverlay ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/70 bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900" style={{ fontFamily: "var(--font-heading)" }}>
              Processing Disruption Trigger
            </h3>
            <p className="mt-2 text-sm text-slate-600">{processingStep}</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full w-2/3 animate-pulse bg-teal-600" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
