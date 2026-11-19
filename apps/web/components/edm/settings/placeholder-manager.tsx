"use client";

import { Check, Copy, Info } from "lucide-react";
import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PLACEHOLDER_KEYS = [
  { key: "姓名", aliases: ["name"], sourceKey: "p_name_source", fallbackKey: "p_name_fallback" },
  { key: "公司", aliases: ["company"], sourceKey: "p_company_source", fallbackKey: "p_company_fallback" },
  { key: "职位", aliases: ["title"], sourceKey: "p_title_source", fallbackKey: "p_title_fallback" },
  { key: "邮箱", aliases: ["email"], sourceKey: "p_email_source", fallbackKey: "p_email_fallback" },
  { key: "称呼", aliases: [], sourceKey: "p_salutation_source", fallbackKey: "p_salutation_fallback" },
  {
    key: "ai.<block_key>",
    aliases: ["ai_<block_key>"],
    sourceKey: "p_ai_source",
    fallbackKey: "p_ai_fallback"
  },
  { key: "<自定义字段>", aliases: [], sourceKey: "p_custom_source", fallbackKey: "p_custom_fallback" }
] as const;

export function PlaceholderManager() {
  const t = useTranslations("Placeholders");
  const tc = useTranslations("Common");
  const [copied, setCopied] = React.useState<string>();

  async function copy(key: string) {
    const value = key.startsWith("<") ? t("customSyntax") : `{{${key}}}`;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      toast.success(t("copied", { value }));
      window.setTimeout(() => setCopied((current) => (current === key ? undefined : current)), 1500);
    } catch {
      toast.error(t("copyFail"));
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription className="mt-1">{t("desc")}</CardDescription>
      </div>
      <Alert>
        <Info />
        <AlertTitle>{t("tipTitle")}</AlertTitle>
        <AlertDescription>{t("tipDesc")}</AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("listTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-44">{t("colVar")}</TableHead>
                  <TableHead className="min-w-52">{t("colSource")}</TableHead>
                  <TableHead className="min-w-72">{t("colFallback")}</TableHead>
                  <TableHead className="w-20">
                    <span className="sr-only">{tc("actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {PLACEHOLDER_KEYS.map((item) => (
                  <TableRow key={item.key}>
                    <TableCell>
                      <code className="text-sm font-medium">{`{{${item.key}}}`}</code>
                      {item.aliases.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {item.aliases.map((alias) => (
                            <Badge key={alias} variant="secondary">
                              {t("alias", { alias })}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{t(item.sourceKey)}</TableCell>
                    <TableCell className="text-muted-foreground">{t(item.fallbackKey)}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("copyAria", { key: item.key })}
                        onClick={() => copy(item.key)}
                      >
                        {copied === item.key ? <Check /> : <Copy />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-2 rounded-lg bg-muted/50 p-4 text-sm">
            <p className="font-medium">{t("rulesTitle")}</p>
            <ul className="text-muted-foreground list-disc space-y-1 pl-5">
              <li>{t("rule1")}</li>
              <li>{t("rule2")}</li>
              <li>{t("rule3")}</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
