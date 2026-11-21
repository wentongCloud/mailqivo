"use client";

import { useTranslations } from "next-intl";
import React from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useToolbar } from "./toolbar-provider";
import { useMediaQuery } from "@uidotdev/usehooks";
import { MobileToolbarGroup, MobileToolbarItem } from "./mobile-toolbar-group";

const levels = [1, 2, 3, 4] as const;

export const HeadingsToolbar = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => {
  const { editor } = useToolbar();
  const t = useTranslations("Editor");
  const isMobile = useMediaQuery("(max-width: 640px)");
  const activeLevel = levels.find((level) => editor?.isActive("heading", { level }));

  if (isMobile) {
    return (
      <MobileToolbarGroup label={activeLevel ? `H${activeLevel}` : t("normal")}>
        <MobileToolbarItem
          onClick={() => {
            if (editor?.isActive("heading") && editor) {
              (editor.chain().focus() as any).setNode("paragraph").run();
            }
          }}
          active={!editor?.isActive("heading")}>
          {t("normal")}
        </MobileToolbarItem>
        {levels.map((level) => (
          <MobileToolbarItem
            key={level}
            onClick={() => (editor?.chain().focus() as any).toggleHeading({ level }).run()}
            active={editor?.isActive("heading", { level })}>
            H{level}
          </MobileToolbarItem>
        ))}
      </MobileToolbarGroup>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className={cn(
                "h-8 w-max gap-1 px-3 font-normal",
                editor?.isActive("heading") && "bg-accent",
                className
              )}
              ref={ref}
              {...props}>
              {activeLevel ? `H${activeLevel}` : t("normal")}
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onClick={() => {
                if (editor?.isActive("heading") && editor) {
                  (editor.chain().focus() as any).setNode("paragraph").run();
                }
              }}
              className={cn(
                "flex h-fit items-center gap-2",
                !editor?.isActive("heading") && "bg-accent"
              )}>
              {t("normal")}
            </DropdownMenuItem>
            {levels.map((level) => (
              <DropdownMenuItem
                key={level}
                onClick={() => (editor?.chain().focus() as any).toggleHeading({ level }).run()}
                className={cn(
                  "flex items-center gap-2",
                  editor?.isActive("heading", { level }) && "bg-accent"
                )}>
                H{level}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipTrigger>
      <TooltipContent>
        <span>{t("headings")}</span>
      </TooltipContent>
    </Tooltip>
  );
});

HeadingsToolbar.displayName = "HeadingsToolbar";
