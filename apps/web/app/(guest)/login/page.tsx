import { Suspense } from "react";
import { getTranslations } from "next-intl/server";

import { generateMeta } from "@/lib/utils";
import { LoginForm } from "./login-form";
import { GuestLocaleSwitch } from "@/components/layout/header/guest-locale-switch";

export async function generateMetadata() {
  const t = await getTranslations("Login");
  return generateMeta({ title: t("submit"), description: "Mailqivo" });
}

// 基于套件 app/dashboard/(guest)/login/v1/page.tsx：只保留一个密码输入框（§11.2）。
export default async function Page() {
  const t = await getTranslations("Login");

  return (
    <div className="flex pb-8 lg:h-screen lg:pb-0">
      <div className="hidden w-1/2 bg-gray-100 lg:block">
        <img
          width="1000px"
          height="1000px"
          src={`/images/extra/image4.jpg`}
          alt="Mailqivo"
          className="h-full w-full object-cover"
        />
      </div>

      <div className="relative flex w-full items-center justify-center lg:w-1/2">
        <div className="absolute top-4 right-4">
          <GuestLocaleSwitch />
        </div>
        <div className="w-full max-w-md space-y-8 px-4">
          <div className="text-center">
            <h2 className="mt-6 text-3xl font-bold">{t("welcome")}</h2>
          </div>

          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
