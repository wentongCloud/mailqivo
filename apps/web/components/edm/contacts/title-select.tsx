"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { MANAGEMENT_TITLES } from "@mailqivo/shared";
import { FormControl } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const UNSET = "unset";

/**
 * 职位选择：选项为 @mailqivo/shared 的 MANAGEMENT_TITLES（常见管理层职位），存简体中文值；
 * 显示文案取 messages 的 `Titles`，只显示当前界面语言。
 * 写法与 IndustrySelect 一致；选项较多，弹层贴在触发器下方，与触发器同宽、最高 max-h-72（与国家/地区选择一致）。已有的非标准职位（导入或 API 写入的任意文本）作为一项保留并标注，避免打开表单就丢数据。
 */
export function TitleSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useTranslations("Contacts");
  const titleLabel = useTranslations("Titles");
  const current = value.trim();
  const isStandard = MANAGEMENT_TITLES.some((title) => title.value === current);

  return (
    <Select value={current || UNSET} onValueChange={(next) => onChange(next === UNSET ? "" : next)}>
      <FormControl>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t("titlePlaceholder")} />
        </SelectTrigger>
      </FormControl>
      <SelectContent position="popper" className="max-h-72 w-(--radix-select-trigger-width)">
        <SelectItem value={UNSET}>{t("titlePlaceholder")}</SelectItem>
        {current && !isStandard ? (
          <SelectItem value={current}>{`${current}（${t("nonStandardValue")}）`}</SelectItem>
        ) : null}
        {MANAGEMENT_TITLES.map((title) => (
          <SelectItem key={title.value} value={title.value}>
            {titleLabel(title.key)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
