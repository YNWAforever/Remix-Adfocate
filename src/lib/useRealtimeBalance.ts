import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { Balance } from "./queries/kocmax";

export function applyBalancePayload(payload: { new: { balance: number; available_to: string | null } }): Balance {
  return { balance: payload.new.balance, available_to: payload.new.available_to };
}

export function useRealtimeBalance(creatorId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!creatorId) return;
    const channel = supabase
      .channel("point_balance")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "point_balances", filter: `creator_id=eq.${creatorId}` },
        (payload) => qc.setQueryData(["balance"], applyBalancePayload(payload as never)),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [creatorId, qc]);
}
