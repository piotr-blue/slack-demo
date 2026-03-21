import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AccountSwitcher } from "@/components/account-switcher";
import { requireSessionUser } from "@/lib/auth/session";
import { getAccountBySlugForUser, listAccountsForUser } from "@/lib/accounts";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AccountLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ accountSlug: string }>;
}) {
  const user = await requireSessionUser();
  const { accountSlug } = await params;
  const [accounts, activeAccount] = await Promise.all([
    listAccountsForUser(user.id),
    getAccountBySlugForUser(user.id, accountSlug),
  ]);

  if (!activeAccount) {
    if (accounts.length === 0) {
      redirect("/onboarding");
    }
    notFound();
  }

  return (
    <main className="min-h-screen p-4 md:p-6">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
        <aside className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
          <h1 className="text-lg font-semibold">slack-demo-app</h1>
          <AccountSwitcher accounts={accounts} activeAccountSlug={activeAccount.slug} />
          <div className="flex gap-2">
            <Link
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              href={`/${activeAccount.slug}`}
            >
              Chats
            </Link>
            <Link
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              href={`/${activeAccount.slug}/settings`}
            >
              Settings
            </Link>
          </div>
        </aside>
        <section>{children}</section>
      </div>
    </main>
  );
}
