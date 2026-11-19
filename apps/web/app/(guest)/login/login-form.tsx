"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiFetch } from "@/lib/api/client";

/** 只允许站内相对路径，防止开放重定向 */
function safeNext(next: string | null) {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/campaigns";
}

export function LoginForm() {
  const t = useTranslations("Login");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password })
      });
      router.replace(safeNext(searchParams.get("next")));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t("wrongPassword") : t("failed"));
      setPending(false);
    }
  }

  return (
    <form className="mt-8 space-y-6" onSubmit={onSubmit}>
      <div className="space-y-2">
        <Label htmlFor="password" className="sr-only">
          {t("password")}
        </Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full"
          placeholder={t("password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
      </div>

      <div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t("submitting") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
