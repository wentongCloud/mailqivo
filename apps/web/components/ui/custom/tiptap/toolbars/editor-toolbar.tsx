import { Separator } from "@/components/ui/separator";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToolbarProvider } from "./toolbar-provider";
import { Editor } from "@tiptap/core";
import { UndoToolbar } from "./undo";
import { RedoToolbar } from "./redo";
import { HeadingsToolbar } from "./headings";
import { BlockquoteToolbar } from "./blockquote";
import { BoldToolbar } from "./bold";
import { ItalicToolbar } from "./italic";
import { UnderlineToolbar } from "./underline";
import { StrikeThroughToolbar } from "./strikethrough";
import { LinkToolbar } from "./link";
import { BulletListToolbar } from "./bullet-list";
import { OrderedListToolbar } from "./ordered-list";
import { AlignmentTooolbar } from "./alignment";
import { ColorHighlightToolbar } from "./color-and-highlight";
import { TableToolbar } from "./table";

export const EditorToolbar = ({ editor, variant = "full" }: { editor: Editor; variant?: "full" | "signature" }) => {
  return (
    <div className="sticky top-0 z-20 w-full border-b bg-background">
      <ToolbarProvider editor={editor}>
        <TooltipProvider>
          <ScrollArea className="h-fit py-0.5">
            <div>
              <div className="flex items-center gap-1 px-2">
                <UndoToolbar />
                <RedoToolbar />
                <Separator orientation="vertical" className="mx-1 h-7" />

                {variant === "full" && (
                  <>
                    <HeadingsToolbar />
                    <ColorHighlightToolbar />
                    <Separator orientation="vertical" className="mx-1 h-7" />
                  </>
                )}

                <BoldToolbar />
                <ItalicToolbar />
                <UnderlineToolbar />
                <StrikeThroughToolbar />

                {variant === "signature" ? (
                  <>
                    <LinkToolbar />
                    <Separator orientation="vertical" className="mx-1 h-7" />
                    <AlignmentTooolbar />
                  </>
                ) : (
                  <>
                    <Separator orientation="vertical" className="mx-1 h-7" />
                    <AlignmentTooolbar />
                    <OrderedListToolbar />
                    <BulletListToolbar />
                    <BlockquoteToolbar />
                    <LinkToolbar />
                    <TableToolbar />
                  </>
                )}
              </div>
            </div>
            <ScrollBar className="hidden" orientation="horizontal" />
          </ScrollArea>
        </TooltipProvider>
      </ToolbarProvider>
    </div>
  );
};
