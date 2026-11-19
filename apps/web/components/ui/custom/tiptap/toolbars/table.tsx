"use client";

import { Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToolbar } from "./toolbar-provider";

export function TableToolbar() {
  const { editor } = useToolbar();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 p-0 sm:h-9 sm:w-9"
          aria-label="插入表格"
          onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        >
          <Table2 className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>插入表格</TooltipContent>
    </Tooltip>
  );
}
