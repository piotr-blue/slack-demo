import { redirect } from "next/navigation";
import { createAccountForUser, listAccountsForUser } from "@/lib/accounts";
import { createChatForAccount } from "@/lib/chats";
import { requireSessionUser } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireSessionUser();
  const existingAccounts = await listAccountsForUser(user.id);

  if (existingAccounts.length > 0) {
    redirect(`/${existingAccounts[0].slug}`);
  }

  async function createAccountAction(formData: FormData) {
    "use server";
    const accountName = String(formData.get("accountName") ?? "").trim();
    if (!accountName) {
      return;
    }

    const currentUser = await requireSessionUser();
    const account = await createAccountForUser({
      name: accountName,
      userId: currentUser.id,
    });
    await createChatForAccount({
      accountId: account.id,
      userId: currentUser.id,
      name: "general",
    });

    redirect(`/${account.slug}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="mx-auto w-full max-w-md">
        <CardHeader>
          <CardTitle>Create your first account</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createAccountAction} className="space-y-3">
            <Input name="accountName" placeholder="Acme Inc" required />
            <Button type="submit" className="w-full">
              Continue
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
