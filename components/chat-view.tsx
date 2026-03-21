"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageInput } from "@/components/message-input";
import { MessageList } from "@/components/message-list";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { Message } from "@/lib/types";

type BroadcastPayload = {
  payload?: {
    record?: Message;
  };
};

export function ChatView({
  chatId,
  initialMessages,
  initialHasMore,
  pageSize = 30,
}: {
  chatId: string;
  initialMessages: Message[];
  initialHasMore: boolean;
  pageSize?: number;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [paginationError, setPaginationError] = useState<string | null>(null);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  useEffect(() => {
    setMessages(initialMessages);
    setHasMore(initialHasMore);
    setPaginationError(null);
  }, [initialHasMore, initialMessages]);

  async function loadOlderMessages() {
    if (isLoadingOlder || !hasMore) {
      return;
    }
    const oldest = messages[0];
    if (!oldest) {
      setHasMore(false);
      return;
    }

    setPaginationError(null);
    setIsLoadingOlder(true);
    try {
      const response = await fetch(
        `/api/chats/${chatId}/messages?beforeSortKey=${Number(oldest.sort_key)}&limit=${pageSize}`,
      );
      if (!response.ok) {
        throw new Error("Failed to load older messages");
      }

      const payload = (await response.json()) as {
        messages: Message[];
        hasMore: boolean;
      };

      setMessages((current) => {
        const existing = new Set(current.map((message) => message.id));
        const mergedOlder = payload.messages.filter((message) => !existing.has(message.id));
        return [...mergedOlder, ...current];
      });
      setHasMore(payload.hasMore);
    } catch (error) {
      setPaginationError(error instanceof Error ? error.message : "Failed to load older messages");
    } finally {
      setIsLoadingOlder(false);
    }
  }

  useEffect(() => {
    let isMounted = true;
    const topic = `room:${chatId}:messages`;

    async function subscribe() {
      const session = await supabase.auth.getSession();
      if (session.data.session?.access_token) {
        await supabase.realtime.setAuth(session.data.session.access_token);
      }

      const channel = supabase
        .channel(topic, { config: { private: true } })
        .on("broadcast", { event: "INSERT" }, (payload: BroadcastPayload) => {
          const record = payload.payload?.record;
          if (!isMounted || !record) return;
          setMessages((current) => {
            if (current.some((message) => message.id === record.id)) {
              return current;
            }
            return [...current, record];
          });
        })
        .subscribe();

      return channel;
    }

    let activeChannel: ReturnType<typeof supabase.channel> | null = null;
    void subscribe().then((channel) => {
      activeChannel = channel;
    });

    return () => {
      isMounted = false;
      if (activeChannel) {
        void supabase.removeChannel(activeChannel);
      }
    };
  }, [chatId, supabase]);

  return (
    <div className="space-y-4">
      {hasMore ? (
        <Button
          type="button"
          variant="outline"
          onClick={loadOlderMessages}
          disabled={isLoadingOlder}
        >
          {isLoadingOlder ? "Loading…" : "Load older messages"}
        </Button>
      ) : null}
      {paginationError ? <p className="text-xs text-rose-600">{paginationError}</p> : null}
      <MessageList messages={messages} />
      <MessageInput chatId={chatId} />
    </div>
  );
}
