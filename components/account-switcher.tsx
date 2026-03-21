"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";

type AccountOption = {
  id: string;
  slug: string;
  name: string;
};

export function AccountSwitcher({
  accounts,
  activeAccountSlug,
}: {
  accounts: AccountOption[];
  activeAccountSlug: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  return (
    <Select
      value={activeAccountSlug}
      disabled={isPending || accounts.length <= 1}
      onChange={(event) => {
        const nextSlug = event.target.value;
        if (!nextSlug || nextSlug === activeAccountSlug) {
          return;
        }
        startTransition(() => {
          const nextPath = pathname.replace(`/${activeAccountSlug}`, `/${nextSlug}`);
          router.push(nextPath);
        });
      }}
      className="w-full"
    >
      {accounts.map((account) => (
        <option key={account.id} value={account.slug}>
          {account.name}
        </option>
      ))}
    </Select>
  );
}
