import { Bot } from "lucide-react";

export function AgentAvatar() {
  return (
    <div
      className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#1a365d] to-[#0891b2] flex items-center justify-center text-white shrink-0 mt-0.5 select-none"
      aria-hidden
    >
      <Bot className="h-4 w-4" strokeWidth={2} />
    </div>
  );
}
