"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { signOut } from "@/features/auth/api/sign-in";

export function SignOutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={async () => {
        await signOut();
        startTransition(() => {
          router.replace("/login");
          router.refresh();
        });
      }}
    >
      Выйти
    </Button>
  );
}
