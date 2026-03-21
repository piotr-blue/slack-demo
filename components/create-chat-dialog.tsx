"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateChatDialog({
  accountId,
}: {
  accountId: string;
}) {
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const chatName = name.trim();
    if (!chatName) {
      setError("Name is required");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/chats", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            accountId,
            name: chatName,
          }),
        });
        if (!response.ok) {
          throw new Error("Could not create chat");
        }
        setName("");
        router.refresh();
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "Unknown error");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <Input
        placeholder="Create chat"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button type="submit" disabled={isPending} className="w-full">
        New chat
      </Button>
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </form>
  );
}
