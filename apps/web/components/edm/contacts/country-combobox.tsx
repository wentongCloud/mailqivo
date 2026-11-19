"use client";

import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { ISO_3166_1, standardCountryName } from "@mailqivo/shared";
import { cn } from "@/lib/utils";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { FormControl } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { selectTriggerClassName } from "@/components/ui/select";

type CountryOption = { value: string; code: string };

const STANDARD_OPTIONS: CountryOption[] = ISO_3166_1.map(([code, name]) => ({ value: name, code }));

/**
 * 国家/地区选择：外观与表单内其他 Select 一致（同一份 selectTriggerClassName、w-full），
 * 名称取 messages 的 `Countries`（按二位代码），只显示当前界面语言；存库仍为标准中文名称。
 * 弹层与触发器同宽、列表高度受 CommandList 的 max-h 限制；可按中文名称或二位代码搜索，只能选 ISO 3166-1 标准表中的值。
 * 已有的非标准值（历史数据）作为一项保留并标注，避免打开表单就丢数据。
 */
export function CountrySelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useTranslations("Contacts");
  const countryLabel = useTranslations("Countries");
  // 只显示当前界面语言的名称；搜索同时匹配中文名称、当前语言名称和二位代码。
  const label = (option: CountryOption) => (option.code ? countryLabel(option.code) : `${option.value}（${t("nonStandardValue")}）`);
  const [open, setOpen] = React.useState(false);
  const listId = React.useId();
  const current = standardCountryName(value) ?? value.trim();
  const options = React.useMemo(() => {
    if (!current || STANDARD_OPTIONS.some((option) => option.value === current)) return STANDARD_OPTIONS;
    return [{ value: current, code: "" }, ...STANDARD_OPTIONS];
  }, [current]);
  const selected = options.find((option) => option.value === current);

  const choose = (next: string) => {
    onChange(next === current ? "" : next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FormControl>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            data-slot="select-trigger"
            data-size="default"
            data-placeholder={selected ? undefined : ""}
            className={cn(selectTriggerClassName, "w-full")}
          >
            <span data-slot="select-value">
              {selected ? label(selected) : t("countryPlaceholder")}
            </span>
            <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
          </button>
        </FormControl>
      </PopoverTrigger>
      <PopoverContent id={listId} align="start" className="w-(--radix-popover-trigger-width) p-0">
        <Command>
          <CommandInput placeholder={t("countrySearch")} />
          <CommandList>
            <CommandEmpty>{t("countryEmpty")}</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.value}
                value={`${label(option)} ${option.value} ${option.code}`}
                data-checked={option.value === current}
                onSelect={() => choose(option.value)}
              >
                <span className="flex-1 truncate">{label(option)}</span>
                {option.code ? <span className="text-muted-foreground text-xs">{option.code}</span> : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
