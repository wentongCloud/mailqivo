"use client";

import { useParams } from "next/navigation";
import { CampaignEditor } from "@/components/edm/campaigns/campaign-editor";

export default function Page() {
  const params = useParams<{ id: string }>();
  return <CampaignEditor id={params.id} />;
}
