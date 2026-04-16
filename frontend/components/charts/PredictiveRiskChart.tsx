"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface RiskPoint {
  date: string;
  payout?: number;
  likely_payout?: number;
}

export function PredictiveRiskChart({ history, forecast }: { history: RiskPoint[]; forecast: RiskPoint[] }) {
  const merged = [...history.map((h) => ({ date: h.date.slice(5), historical: h.payout ?? 0, forecast: null })), ...forecast.map((f) => ({ date: f.date.slice(5), historical: null, forecast: f.likely_payout ?? 0 }))];

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={merged} margin={{ top: 10, right: 20, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.14)" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="historical"
            stroke="#0ea5a4"
            strokeWidth={2}
            dot={false}
            name="Historical Payouts"
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="forecast"
            stroke="#f97316"
            strokeWidth={2}
            dot={false}
            strokeDasharray="5 4"
            name="Predicted Next Week"
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

