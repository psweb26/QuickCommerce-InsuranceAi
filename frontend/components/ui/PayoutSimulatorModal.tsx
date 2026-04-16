"use client";

import { motion } from "framer-motion";

import { currencyINR, prettyDate } from "@/lib/format";

interface PayoutSimulatorModalProps {
  open: boolean;
  amount: number;
  upiId: string;
  transactionId: string;
  createdAt: string;
  onClose: () => void;
}

export function PayoutSimulatorModal({
  open,
  amount,
  upiId,
  transactionId,
  createdAt,
  onClose,
}: PayoutSimulatorModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl"
      >
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-4 text-white">
          <p className="text-xs font-semibold uppercase tracking-wider">UPI Simulator</p>
          <h3 className="mt-1 text-xl font-bold">Instant Payout Success</h3>
        </div>
        <div className="space-y-3 px-5 py-5">
          <motion.div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl"
            animate={{ scale: [1, 1.15, 1] }}
            transition={{ repeat: 1, duration: 0.7 }}
          >
            ✓
          </motion.div>
          <p className="text-center text-xl font-extrabold text-emerald-700">{currencyINR(amount)} Credited</p>
          <p className="text-center text-sm text-slate-700">₹{amount.toFixed(2)} Credited to UPI</p>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <p><span className="font-semibold">UPI ID:</span> {upiId || "N/A"}</p>
            <p className="mt-1"><span className="font-semibold">Txn ID:</span> {transactionId}</p>
            <p className="mt-1 text-xs text-slate-500">{prettyDate(createdAt)}</p>
          </div>
          <button
            className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </motion.div>
    </div>
  );
}

