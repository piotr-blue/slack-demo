import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { SlackStatusBadge } from "@/components/slack-status-badge";
import { requireSessionUser } from "@/lib/auth/session";
import { getAccountBySlugForUser } from "@/lib/accounts";
import { getDb } from "@/lib/db";
import type { Chat } from "@/lib/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage({
  params,
}: {
  params: Promise<{ accountSlug: string }>;
}) {
  const user = await requireSessionUser();
  const { accountSlug } = await params;
  const account = await getAccountBySlugForUser(user.id, accountSlug);
  if (!account) {
    notFound();
  }

  const db = getDb();
  const [installations, chats] = await Promise.all([
    db<{ id: string; team_name: string | null; team_id: string }[]>`
      select id, team_name, team_id
      from slack_installations
      where account_id = ${account.id}::uuid
      order by updated_at desc
      limit 1
    `,
    db<Chat[]>`
      select *
      from chats
      where account_id = ${account.id}::uuid
      order by created_at asc
    `,
  ]);
  const installation = installations[0] ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Slack connection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {installation ? (
            <p className="text-sm text-slate-600">
              Connected to workspace <span className="font-medium">{installation.team_name ?? installation.team_id}</span>
            </p>
          ) : (
            <p className="text-sm text-slate-600">No Slack workspace connected.</p>
          )}

          <Link
            href={`/api/slack/install?accountId=${account.id}`}
            className={cn(buttonVariants({ variant: "default" }))}
          >
            Connect Slack
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chat ↔ Slack channel mappings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {chats.map((chat) => (
            <div key={chat.id} className="rounded-md border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{chat.name}</p>
                  <p className="text-xs text-slate-500">
                    {chat.slack_channel_name ? `#${chat.slack_channel_name}` : "Not mapped yet"}
                  </p>
                </div>
                <SlackStatusBadge status={chat.slack_status} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
