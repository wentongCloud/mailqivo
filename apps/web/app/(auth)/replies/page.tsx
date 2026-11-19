import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ReplyInbox } from "@/components/edm/replies/reply-inbox";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Pages");
  return { title: `${t("repliesTitle")} | Mailqivo` };
}

export default function RepliesPage() {
  return <ReplyInbox />;
}
