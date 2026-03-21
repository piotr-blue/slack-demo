import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth/api-user";
import { createChatForAccount } from "@/lib/chats";

const createChatSchema = z.object({
  accountId: z.string().uuid(),
  name: z.string().min(1).max(100),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.user) {
    return auth.response!;
  }

  const body = await request.json();
  const parsed = createChatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const chat = await createChatForAccount({
      accountId: parsed.data.accountId,
      name: parsed.data.name,
      userId: auth.user.id,
    });
    return NextResponse.json({ chat }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(
      { error: "Failed to create chat" },
      { status: 500 },
    );
  }
}
