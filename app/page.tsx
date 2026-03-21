import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { listAccountsForUser } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth");
  }

  const accounts = await listAccountsForUser(user.id);
  if (accounts.length === 0) {
    redirect("/onboarding");
  }

  redirect(`/${accounts[0].slug}`);
}
