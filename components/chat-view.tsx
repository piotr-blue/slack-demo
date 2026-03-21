"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageInput } from "@/components/message-input";
import { MessageList } from "@/components/message-list";
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
}: {
  chatId: string;
  initialMessages: Message[];
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

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
      <MessageList messages={messages} />
      <MessageInput chatId={chatId} />
    </div>
  );
}
