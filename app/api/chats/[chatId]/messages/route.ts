import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth/api-user";
import { getChatForUser } from "@/lib/chats";
import { createAppMessageFlow, listMessagesForChat } from "@/lib/messages";

const createMessageSchema = z.object({
  text: z.string().min(1).max(4000),
});

const listMessagesQuerySchema = z.object({
  beforeSortKey: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  const auth = await requireApiUser();
  if (!auth.user) {
    return auth.response!;
  }

  const { chatId } = await context.params;
  const chat = await getChatForUser(auth.user.id, chatId);
  if (!chat) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const parsedQuery = listMessagesQuerySchema.safeParse({
    beforeSortKey: url.searchParams.get("beforeSortKey") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsedQuery.success) {
    return NextResponse.json({ error: "Invalid query params" }, { status: 400 });
  }

  const limit = parsedQuery.data.limit ?? 30;
  const messages = await listMessagesForChat({
    userId: auth.user.id,
    chatId,
    limit,
    beforeSortKey: parsedQuery.data.beforeSortKey,
  });

  const orderedMessages = [...messages].reverse();
  const oldestMessage = orderedMessages[0];
  const oldestSortKey = oldestMessage ? Number(oldestMessage.sort_key) : null;

  return NextResponse.json({
    messages: orderedMessages,
    nextBeforeSortKey: oldestSortKey,
    hasMore: messages.length === limit,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  const auth = await requireApiUser();
  if (!auth.user) {
    return auth.response!;
  }

  const { chatId } = await context.params;
  const body = await request.json();
  const parsed = createMessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const result = await createAppMessageFlow({
      userId: auth.user.id,
      chatId,
      text: parsed.data.text,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 },
    );
  }
}
