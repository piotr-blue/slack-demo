import { notFound } from "next/navigation";
import { ChatSidebar } from "@/components/chat-sidebar";
import { ChatView } from "@/components/chat-view";
import { CreateChatDialog } from "@/components/create-chat-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSessionUser } from "@/lib/auth/session";
import { getAccountBySlugForUser } from "@/lib/accounts";
import { getChatForUser, listChatsForAccount } from "@/lib/chats";
import { listMessagesForChat } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function AccountChatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountSlug: string }>;
  searchParams: Promise<{ chatId?: string }>;
}) {
  const user = await requireSessionUser();
  const { accountSlug } = await params;
  const { chatId } = await searchParams;

  const account = await getAccountBySlugForUser(user.id, accountSlug);
  if (!account) {
    notFound();
  }

  const chats = await listChatsForAccount(account.id);
  const activeChatId = chatId ?? chats[0]?.id ?? null;
  const activeChat = activeChatId ? await getChatForUser(user.id, activeChatId) : null;

  const messages = activeChat
    ? await listMessagesForChat({ userId: user.id, chatId: activeChat.id, limit: 50 })
    : [];

  const orderedMessages = [...messages].reverse();

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Chats</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CreateChatDialog accountId={account.id} />
          <ChatSidebar
            chats={chats}
            accountSlug={account.slug}
            activeChatId={activeChat?.id ?? null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{activeChat ? activeChat.name : "No chat selected"}</CardTitle>
        </CardHeader>
        <CardContent>
          {activeChat ? (
            <ChatView chatId={activeChat.id} initialMessages={orderedMessages} />
          ) : (
            <p className="text-sm text-slate-500">Create your first chat to get started.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
