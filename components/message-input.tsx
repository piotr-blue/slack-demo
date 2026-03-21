"use client";

import { FormEvent, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function MessageInput({
  chatId,
  onSent,
}: {
  chatId: string;
  onSent?: () => void;
}) {
  const [text, setText] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const value = text;
    if (!value.trim()) {
      return;
    }

    setText("");
    startTransition(async () => {
      try {
        const response = await fetch(`/api/chats/${chatId}/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ text: value }),
        });
        if (!response.ok) {
          throw new Error("Message failed");
        }
        onSent?.();
      } catch (submitError) {
        setText(value);
        setError(submitError instanceof Error ? submitError.message : "Unknown error");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex gap-2">
        <Input
          placeholder="Type message"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <Button disabled={isPending} type="submit">
          Send
        </Button>
      </div>
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </form>
  );
}
