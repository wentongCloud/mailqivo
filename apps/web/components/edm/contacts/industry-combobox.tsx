"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { canonicalIndustry } from "@mailqivo/shared";
import { industryOptions } from "@/lib/gics";
import { FormControl } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const UNSET = "unset";

export function IndustrySelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useTranslations("Industry");
  const options = React.useMemo(() => industryOptions(t, value), [t, value]);

  return (
    <Select value={canonicalIndustry(value) || UNSET} onValueChange={(next) => onChange(next === UNSET ? "" : next)}>
      <FormControl>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t("placeholder")} />
        </SelectTrigger>
      </FormControl>
      <SelectContent>
        <SelectItem value={UNSET}>{t("placeholder")}</SelectItem>
        {options.map(({ value, label }) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
