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
  const [installations, membershipRows, chats] = await Promise.all([
    db<{ id: string; team_name: string | null; team_id: string }[]>`
      select id, team_name, team_id
      from slack_workspace_installations
      where account_id = ${account.id}::uuid
      order by updated_at desc
      limit 1
    `,
    db<{ role: "owner" }[]>`
      select role
      from account_members
      where account_id = ${account.id}::uuid
        and user_id = ${user.id}::uuid
      limit 1
    `,
    db<Chat[]>`
      select *
      from chats
      where account_id = ${account.id}::uuid
        and owner_user_id = ${user.id}::uuid
      order by created_at asc
    `,
  ]);
  const installation = installations[0] ?? null;
  const isOwner = membershipRows[0]?.role === "owner";

  const userLinkRows = installation
    ? await db<{
        id: string;
        slack_user_id: string;
        slack_dm_channel_id: string | null;
        last_error: string | null;
      }[]>`
        select id, slack_user_id, slack_dm_channel_id, last_error
        from slack_user_links
        where account_id = ${account.id}::uuid
          and app_user_id = ${user.id}::uuid
          and slack_team_id = ${installation.team_id}
        limit 1
      `
    : [];
  const userLink = userLinkRows[0] ?? null;
  const openDmUrl =
    installation && userLink?.slack_dm_channel_id
      ? `https://slack.com/app_redirect?team=${installation.team_id}&channel=${userLink.slack_dm_channel_id}`
      : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Slack workspace connection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {installation ? (
            <p className="text-sm text-slate-600">
              Connected to workspace <span className="font-medium">{installation.team_name ?? installation.team_id}</span>
            </p>
          ) : (
            <p className="text-sm text-slate-600">No Slack workspace connected.</p>
          )}
          {isOwner ? (
            <Link
              href={`/api/slack/install?accountId=${account.id}`}
              className={cn(buttonVariants({ variant: "default" }))}
            >
              Connect workspace to Slack
            </Link>
          ) : (
            <p className="text-xs text-slate-500">
              Only account owner can connect or reconnect the workspace app installation.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My Slack user link</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {userLink ? (
            <p className="text-sm text-slate-600">
              Linked as <span className="font-medium">{userLink.slack_user_id}</span>
            </p>
          ) : (
            <p className="text-sm text-slate-600">
              Your app user is not linked to a Slack DM yet.
            </p>
          )}
          {userLink?.last_error ? (
            <p className="text-xs text-rose-600">{userLink.last_error}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/api/slack/link?accountId=${account.id}`}
              className={cn(buttonVariants({ variant: "default" }))}
            >
              {userLink ? "Reconnect my Slack user" : "Link my Slack user"}
            </Link>
            {openDmUrl ? (
              <Link
                href={openDmUrl}
                className={cn(buttonVariants({ variant: "outline" }))}
                target="_blank"
                rel="noreferrer"
              >
                Open Slack DM
              </Link>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chat ↔ Slack thread mappings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {chats.map((chat) => (
            <div key={chat.id} className="rounded-md border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{chat.name}</p>
                  <p className="text-xs text-slate-500">
                    {chat.slack_thread_ts ? `Thread: ${chat.slack_thread_ts}` : "Thread not created yet"}
                  </p>
                  {chat.slack_last_error ? (
                    <p className="text-xs text-rose-600">{chat.slack_last_error}</p>
                  ) : null}
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
