import Link from "next/link";
import { SlackStatusBadge } from "@/components/slack-status-badge";
import type { Chat } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ChatSidebar({
  chats,
  accountSlug,
  activeChatId,
}: {
  chats: Chat[];
  accountSlug: string;
  activeChatId: string | null;
}) {
  return (
    <div className="space-y-2">
      {chats.map((chat) => {
        const isActive = chat.id === activeChatId;
        return (
          <Link
            key={chat.id}
            href={`/${accountSlug}?chatId=${chat.id}`}
            className={cn(
              "block rounded-md border p-3 transition-colors",
              isActive
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white hover:bg-slate-100",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{chat.name}</span>
              <SlackStatusBadge status={chat.slack_status} />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
