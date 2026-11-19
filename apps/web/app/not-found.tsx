import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("Common");

  return (
    <div className="bg-background grid h-screen items-center pb-8 lg:grid-cols-2 lg:pb-0">
      <div className="text-center">
        <p className="text-muted-foreground text-base font-semibold">404</p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-5xl lg:text-7xl">
          {t("notFound")}
        </h1>
        <div className="mt-10 flex items-center justify-center gap-x-2">
          <Button size="lg" asChild>
            <Link href="/campaigns">{t("back")}</Link>
          </Button>
        </div>
      </div>
      <div className="hidden lg:block">
        <img
          src={`/404.svg`}
          width="300px"
          height="400px"
          className="w-full object-contain lg:max-w-2xl"
          alt={t("notFound")}
        />
      </div>
    </div>
  );
}
