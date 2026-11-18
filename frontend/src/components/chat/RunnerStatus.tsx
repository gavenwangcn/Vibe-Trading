import { memo } from "react";
import type { LiveStatus } from "@/lib/api";

interface Props {
  status: LiveStatus | null;
  unavailable?: boolean;
  halted?: boolean;
  onRefresh: () => void;
}

/** Broker runtime status is not part of this agent. */
export const RunnerStatus = memo(function RunnerStatus(_props: Props) {
  return null;
});
