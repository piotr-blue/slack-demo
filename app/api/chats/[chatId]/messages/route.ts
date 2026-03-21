import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth/api-user";
import { createAppMessageFlow } from "@/lib/messages";

const createMessageSchema = z.object({
  text: z.string().min(1).max(4000),
});

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
