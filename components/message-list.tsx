import type { Message } from "@/lib/types";
import { cn } from "@/lib/utils";

export function MessageList({ messages }: { messages: Message[] }) {
  if (messages.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        No messages yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {messages.map((message) => (
        <div
          key={message.id}
          className={cn(
            "rounded-md border px-3 py-2",
            message.role === "assistant" ? "border-indigo-200 bg-indigo-50" : "border-slate-200 bg-white",
          )}
        >
          <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
            <span className="font-medium">{message.role}</span>
            <span>origin: {message.origin}</span>
            {message.author_display_name ? <span>author: {message.author_display_name}</span> : null}
            {message.slack_user_id ? <span>slack: {message.slack_user_id}</span> : null}
          </div>
          <p className="whitespace-pre-wrap text-sm">{message.text}</p>
        </div>
      ))}
    </div>
  );
}
