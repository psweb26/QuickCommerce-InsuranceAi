export type Platform = "Blinkit" | "Zepto" | "Instamart";

export interface Worker {
  _id?: string;
  id?: string;
  name: string;
  age: number;
  phone: string;
  delivery_platform: Platform;
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
  completed_orders: number;
  assigned_orders: number;
  weekly_working_hours: number;
  fraud_flags: number;
  current_risk_score?: number;
  current_exposure_score?: number;
  current_reliability_score?: number;
  created_at?: string;
}

export interface Policy {
  _id?: string;
  id?: string;
  worker_id: string;
  status: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  max_claims_per_week: number;
  claims_used: number;
  remaining_coverage: number;
  coverage_amount: number;
  premium_amount: number;
  risk_score: number;
  exposure_score: number;
  reliability_score: number;
  coverage_factor: number;
  base_rate: number;
  pricing_tier: string;
  disruption_probabilities: Record<string, number>;
}

export interface Disruption {
  _id?: string;
  id?: string;
  type: string;
  severity: number;
  city: string;
  affected_zones: string[];
  start_time: string;
  end_time: string;
  source: string;
  trigger_metrics: Record<string, number | boolean>;
  geofence?: {
    center_lat: number;
    center_lng: number;
    radius_km: number;
  };
}

export interface Claim {
  _id?: string;
  id?: string;
  worker_id: string;
  policy_id: string;
  disruption_id: string;
  disruption_type: string;
  duration_hours: number;
  severity: number;
  expected_orders: number;
  actual_orders: number;
  work_loss_ratio: number;
  fraud_risk_score: number;
  payout_amount: number;
  payout_txn_id?: string | null;
  payout_message?: string | null;
  status: "approved" | "rejected" | "under_review" | "blocked";
  reason?: string;
  created_at: string;
}

export interface FraudAlert {
  _id: string;
  worker_id: string;
  worker_code?: string;
  claim_id?: string | null;
  fraud_risk_score: number;
  action: string;
  signals: Record<string, number | boolean>;
  created_at: string;
}

export interface DashboardPayload {
  success: boolean;
  worker: Worker;
  policy: Policy;
  live_disruptions: Disruption[];
  claims: Claim[];
  payout_notifications: Array<{
    message: string;
    amount: number;
    created_at: string;
    transaction_id?: string;
    trigger_event?: string;
    upi_id?: string;
  }>;
}

export interface WorkerPing {
  _id?: string;
  worker_id: string;
  worker_code?: string;
  city: string;
  zone: string;
  lat: number;
  lng: number;
  speed_kmph: number;
  jump_km?: number;
  pinged_at: string;
  eligible: boolean;
  matching_disruptions?: string[];
}

export interface LiveOperationsDisruption extends Disruption {}

export interface LiveOperationsPayload {
  success: boolean;
  city_filter?: string | null;
  zone_filter?: string | null;
  disruptions: LiveOperationsDisruption[];
  worker_pings: WorkerPing[];
  summary: {
    active_disruptions: number;
    workers_tracked: number;
    eligible_workers: number;
    avg_worker_speed_kmph: number;
  };
}

export interface PredictiveRiskPoint {
  date: string;
  payout?: number;
  weather_pressure?: number;
  likely_payout?: number;
  weather_delta?: number;
}

export interface PredictiveRiskPayload {
  success: boolean;
  model: string;
  lookback_days: number;
  horizon_days: number;
  history: PredictiveRiskPoint[];
  forecast: PredictiveRiskPoint[];
}

