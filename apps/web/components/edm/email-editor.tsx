"use client";

import * as React from "react";
import { Editor, Node, nodeInputRule } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Typography from "@tiptap/extension-typography";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import CodeMirror from "@uiw/react-codemirror";
import { html as htmlLanguage } from "@codemirror/lang-html";
import { Decoration, MatchDecorator, ViewPlugin, type EditorView } from "@codemirror/view";
import { CodeXml, Variable } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ImageExtension } from "@/components/ui/custom/tiptap/extensions/image";
import { ImagePlaceholder } from "@/components/ui/custom/tiptap/extensions/image-placeholder";
import SearchAndReplace from "@/components/ui/custom/tiptap/extensions/search-and-replace";
import { EditorToolbar } from "@/components/ui/custom/tiptap/toolbars/editor-toolbar";
import "@/components/ui/custom/tiptap/tiptap.css";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { clearEditorDraft, promoteTemplateVariables, readEditorDraft, writeEditorDraft } from "@/lib/template-variables";
import { cn } from "@/lib/utils";

/** Product variable keys stay Chinese (and sys.*) regardless of UI locale. */
const VARIABLE_KEYS = ["姓名", "公司", "职位", "邮箱"] as const;
const compact = (value: string) => value.replace(/\s+/g, "");
const AUTOSAVE_MS = 10_000;

const TemplateVariable = Node.create({
  name: "templateVariable",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { key: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-template-variable]",
        getAttrs: (element) => ({ key: (element as HTMLElement).dataset.templateVariable ?? "" })
      }
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      {
        ...HTMLAttributes,
        "data-template-variable": node.attrs.key,
        class: "bg-primary/10 text-primary inline-flex rounded-md px-1.5 py-0.5 text-xs",
        contenteditable: "false"
      },
      `{{${node.attrs.key}}}`
    ];
  },
  renderText({ node }) {
    return `{{${node.attrs.key}}}`;
  },
  addInputRules() {
    return [
      nodeInputRule({
        find: /\{\{([^{}]+)\}\}$/,
        type: this.type,
        getAttributes: (match) => ({ key: match[1]!.trim() })
      })
    ];
  }
});

function richExtensions(placeholder: string) {
  return [
    StarterKit,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TextStyleKit,
    Color,
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
    Typography,
    Link.configure({ openOnClick: false }),
    ImageExtension,
    ImagePlaceholder,
    SearchAndReplace,
    Underline,
    Placeholder.configure({ placeholder }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    TemplateVariable
  ];
}

function serializeRichHtml(editor: Editor): string {
  return editor
    .getHTML()
    .replace(/<span[^>]*data-template-variable="([^"]+)"[^>]*>\{\{[^}]+\}\}<\/span>/g, "{{$1}}");
}

function loadRichContent(html: string): string {
  return promoteTemplateVariables(html);
}

const variableDecorator = new MatchDecorator({
  regexp: /\{\{[^{}]+\}\}/g,
  decoration: Decoration.mark({ class: "cm-template-variable" })
});
const variableHighlight = ViewPlugin.fromClass(
  class {
    decorations;
    constructor(view: EditorView) {
      this.decorations = variableDecorator.createDeco(view);
    }
    update(update: { docChanged: boolean; view: EditorView }) {
      if (update.docChanged) this.decorations = variableDecorator.createDeco(update.view);
    }
  },
  { decorations: (value) => value.decorations }
);

export type EmailEditorAutosaveResult = { updated_at?: string } | void;

export type EmailEditorProps = {
  value: string;
  onChange: (html: string) => void;
  mode: "rich" | "html";
  onModeChange: (mode: "rich" | "html") => void;
  className?: string;
  /** 签名只显示基础文本格式工具；模板与活动使用完整工具列。 */
  toolbarVariant?: "full" | "signature";
  /** localStorage / 自动保存键；规格以 campaign_id 为键，模板/签名用 `template:` / `signature:` 前缀。 */
  autosaveKey?: string;
  /** 服务端当前 `updated_at`，用于判断本地草稿是否更新。 */
  serverUpdatedAt?: string;
  /** 有改动时每 10 秒调用（同时写 localStorage）。 */
  onAutosave?: (payload: { html: string; mode: "rich" | "html" }) => Promise<EmailEditorAutosaveResult>;
};

/** §11.3 双模式邮件编辑器。 */
export function EmailEditor({
  value,
  onChange,
  mode,
  onModeChange,
  className,
  toolbarVariant = "full",
  autosaveKey,
  serverUpdatedAt,
  onAutosave
}: EmailEditorProps) {
  const t = useTranslations("EmailEditor");
  const tc = useTranslations("Common");
  const [pendingRich, setPendingRich] = React.useState<string | null>(null);
  const dirtyRef = React.useRef(false);
  const valueRef = React.useRef(value);
  const modeRef = React.useRef(mode);
  const onAutosaveRef = React.useRef(onAutosave);
  const onChangeRef = React.useRef(onChange);
  const onModeChangeRef = React.useRef(onModeChange);
  const restorePromptedRef = React.useRef<string | null>(null);
  const placeholder = t("placeholder");

  valueRef.current = value;
  modeRef.current = mode;
  onAutosaveRef.current = onAutosave;
  onChangeRef.current = onChange;
  onModeChangeRef.current = onModeChange;

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: richExtensions(placeholder),
      content: loadRichContent(value),
      editorProps: { attributes: { class: "min-h-72 max-w-none p-4 focus:outline-none" } },
      onUpdate: ({ editor: current }) => {
        dirtyRef.current = true;
        onChange(serializeRichHtml(current));
      }
    },
    [placeholder]
  );

  React.useEffect(() => {
    if (!editor || mode !== "rich") return;
    if (compact(serializeRichHtml(editor)) !== compact(value)) {
      editor.commands.setContent(loadRichContent(value), { emitUpdate: false });
    }
  }, [editor, mode, value]);

  const hydratedRef = React.useRef(false);
  React.useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      return;
    }
    dirtyRef.current = true;
  }, [value, mode]);

  React.useEffect(() => {
    if (!autosaveKey || restorePromptedRef.current === autosaveKey) return;
    restorePromptedRef.current = autosaveKey;
    const draft = readEditorDraft(autosaveKey);
    if (!draft) return;
    const localTime = Date.parse(draft.savedAt);
    const serverTime = serverUpdatedAt ? Date.parse(serverUpdatedAt) : 0;
    if (!Number.isFinite(localTime) || localTime <= serverTime) return;
    if (draft.html === valueRef.current && draft.mode === modeRef.current) return;
    toast(t("restoreDraft"), {
      description: t("restoreDraftDesc"),
      action: {
        label: t("restore"),
        onClick: () => {
          onChangeRef.current(draft.html);
          onModeChangeRef.current(draft.mode);
          dirtyRef.current = true;
        }
      },
      cancel: {
        label: t("discardDraft"),
        onClick: () => clearEditorDraft(autosaveKey)
      }
    });
  }, [autosaveKey, serverUpdatedAt, t]);

  React.useEffect(() => {
    if (!autosaveKey) return;
    const timer = window.setInterval(() => {
      void (async () => {
        if (!dirtyRef.current) return;
        const html = valueRef.current;
        const currentMode = modeRef.current;
        const savedAt = new Date().toISOString();
        writeEditorDraft(autosaveKey, { html, mode: currentMode, savedAt });
        dirtyRef.current = false;
        const save = onAutosaveRef.current;
        if (!save) return;
        try {
          await save({ html, mode: currentMode });
        } catch {
          dirtyRef.current = true;
          toast.error(t("autosaveFail"));
        }
      })();
    }, AUTOSAVE_MS);
    return () => window.clearInterval(timer);
  }, [autosaveKey, t]);

  function switchMode(next: "rich" | "html") {
    if (next === mode) return;
    if (next === "html") {
      if (editor) onChange(serializeRichHtml(editor));
      dirtyRef.current = true;
      onModeChange("html");
      return;
    }
    const temporary = new Editor({ extensions: richExtensions(placeholder), content: loadRichContent(value) });
    const normalized = serializeRichHtml(temporary);
    temporary.destroy();
    if (compact(normalized) !== compact(value)) setPendingRich(normalized);
    else {
      onChange(normalized);
      dirtyRef.current = true;
      onModeChange("rich");
    }
  }

  return (
    <div className={cn("min-w-0 max-w-full space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-md border p-0.5">
          <Button size="sm" variant={mode === "rich" ? "secondary" : "ghost"} onClick={() => switchMode("rich")}>
            <Variable />
            {t("rich")}
          </Button>
          <Button size="sm" variant={mode === "html" ? "secondary" : "ghost"} onClick={() => switchMode("html")}>
            <CodeXml />
            {t("html")}
          </Button>
        </div>
        {mode === "rich" && editor && (
          <div className="flex gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  <Variable />
                  {t("variables")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {VARIABLE_KEYS.map((key) => (
                  <DropdownMenuItem
                    key={key}
                    onSelect={() =>
                      editor.chain().focus().insertContent({ type: "templateVariable", attrs: { key } }).run()
                    }
                  >
                    {`{{${key}}}`}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      {mode === "rich" ? (
        <div className="min-w-0 max-w-full overflow-hidden rounded-lg border bg-card">
          {editor && <EditorToolbar editor={editor} variant={toolbarVariant} />}
          <EditorContent editor={editor} />
        </div>
      ) : (
        <div className="min-w-0 max-w-full overflow-hidden rounded-lg border [&_.cm-template-variable]:rounded [&_.cm-template-variable]:bg-primary/15 [&_.cm-template-variable]:px-1 [&_.cm-template-variable]:text-primary">
          <CodeMirror
            value={value}
            height="360px"
            extensions={[htmlLanguage(), variableHighlight]}
            onChange={(next) => {
              dirtyRef.current = true;
              onChange(next);
            }}
            basicSetup={{ foldGutter: true }}
          />
        </div>
      )}
      <AlertDialog open={pendingRich !== null} onOpenChange={(open) => !open && setPendingRich(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("switchRichTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("switchRichConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRich !== null) onChange(pendingRich);
                setPendingRich(null);
                dirtyRef.current = true;
                onModeChange("rich");
              }}
            >
              {t("switchRichContinue")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export { clearEditorDraft };
