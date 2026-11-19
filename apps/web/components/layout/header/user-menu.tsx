"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOutIcon } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api/client";

// §11.1 第 5 条：用户菜单里只有退出登录。
export default function UserMenu() {
  const t = useTranslations("Common");
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function logout() {
    setPending(true);
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      toast.error(t("logout"));
      setPending(false);
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Avatar className="cursor-pointer">
          <AvatarFallback className="rounded-lg">A</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48" align="end">
        <DropdownMenuLabel className="text-sm font-semibold">Admin</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={pending} onSelect={() => void logout()}>
          <LogOutIcon className="text-muted-foreground" />
          {t("logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
