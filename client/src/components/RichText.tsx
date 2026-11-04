import React, { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Code,
  Heading2,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Underline,
} from "lucide-react";

// ============================================================================
// Rich-text task description (bold, italic, underline, strike, code,
// headings, lists, quotes, links). Content is rendered through the editor's
// schema in both edit and read-only mode, so unknown/unsafe markup is dropped.
// ============================================================================

export const DESCRIPTION_LIMIT = 10000;

function extensions(placeholder: string) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
    }),
    Placeholder.configure({ placeholder }),
  ];
}

const ToolbarButton: React.FC<{
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, active, onClick, children }) => (
  <button
    type="button"
    className={`rt-btn ${active ? "active" : ""}`}
    aria-label={label}
    title={label}
    aria-pressed={active}
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
  >
    {children}
  </button>
);

const Toolbar: React.FC<{ editor: Editor }> = ({ editor }) => {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      h2: e.isActive("heading", { level: 2 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      link: e.isActive("link"),
    }),
  });
  const chain = () => editor.chain().focus();
  // Inline link editor (window.prompt is unavailable inside Root's client).
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const openLink = () => {
    setLinkValue((editor.getAttributes("link").href as string | undefined) ?? "");
    setLinkOpen(true);
  };
  const applyLink = () => {
    const url = linkValue.trim();
    if (!url) chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href: /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}` }).run();
    setLinkOpen(false);
  };
  return (
    <>
    <div className="rt-toolbar" role="toolbar" aria-label="Formatting">
      <ToolbarButton label="Bold" active={s.bold} onClick={() => chain().toggleBold().run()}><Bold size={15} /></ToolbarButton>
      <ToolbarButton label="Italic" active={s.italic} onClick={() => chain().toggleItalic().run()}><Italic size={15} /></ToolbarButton>
      <ToolbarButton label="Underline" active={s.underline} onClick={() => chain().toggleUnderline().run()}><Underline size={15} /></ToolbarButton>
      <ToolbarButton label="Strikethrough" active={s.strike} onClick={() => chain().toggleStrike().run()}><Strikethrough size={15} /></ToolbarButton>
      <ToolbarButton label="Inline code" active={s.code} onClick={() => chain().toggleCode().run()}><Code size={15} /></ToolbarButton>
      <span className="rt-sep" />
      <ToolbarButton label="Heading" active={s.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}><Heading2 size={15} /></ToolbarButton>
      <ToolbarButton label="Bulleted list" active={s.bullet} onClick={() => chain().toggleBulletList().run()}><List size={15} /></ToolbarButton>
      <ToolbarButton label="Numbered list" active={s.ordered} onClick={() => chain().toggleOrderedList().run()}><ListOrdered size={15} /></ToolbarButton>
      <ToolbarButton label="Quote" active={s.quote} onClick={() => chain().toggleBlockquote().run()}><Quote size={15} /></ToolbarButton>
      <ToolbarButton label="Link" active={s.link || linkOpen} onClick={() => (linkOpen ? setLinkOpen(false) : openLink())}><LinkIcon size={15} /></ToolbarButton>
    </div>
    {linkOpen && (
      <div className="rt-linkbar">
        <input
          autoFocus
          placeholder="Paste or type a link"
          value={linkValue}
          onChange={(e) => setLinkValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              applyLink();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setLinkOpen(false);
            }
          }}
        />
        <button type="button" className="btn btn-quiet btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={applyLink}>
          Apply
        </button>
        {s.link && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              chain().extendMarkRange("link").unsetLink().run();
              setLinkOpen(false);
            }}
          >
            Remove
          </button>
        )}
      </div>
    )}
    </>
  );
};

interface Props {
  value: string;
  editable: boolean;
  placeholder?: string;
  onChange?: (html: string, textLength: number) => void;
  onBlur?: () => void;
  minHeight?: number;
  emptyText?: string;
}

export const RichText: React.FC<Props> = ({
  value,
  editable,
  placeholder = "Add a description…",
  onChange,
  onBlur,
  minHeight = 96,
  emptyText = "No description",
}) => {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;
  const [focused, setFocused] = useState(false);
  const [length, setLength] = useState(0);

  const editor = useEditor({
    extensions: extensions(placeholder),
    content: value || "",
    editable,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    onCreate: ({ editor: e }) => setLength(e.getText().length),
    onUpdate: ({ editor: e }) => {
      const len = e.getText().length;
      setLength(len);
      onChangeRef.current?.(e.isEmpty ? "" : e.getHTML(), len);
    },
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      onBlurRef.current?.();
    },
  });

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);

  // Accept outside updates (another member edited) unless we're typing.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const current = editor.isEmpty ? "" : editor.getHTML();
    if ((value || "") !== current) {
      editor.commands.setContent(value || "", { emitUpdate: false });
      setLength(editor.getText().length);
    }
  }, [editor, value]);

  if (!editor) return null;
  const isEmptyReadOnly = !editable && !value;

  return (
    <div className={`rt ${editable ? "rt-editable" : "rt-readonly"} ${focused ? "rt-focused" : ""}`}>
      {editable && <Toolbar editor={editor} />}
      {isEmptyReadOnly ? (
        <div className="rt-empty">{emptyText}</div>
      ) : (
        <EditorContent editor={editor} className="rt-content" style={{ minHeight: editable ? minHeight : undefined }} />
      )}
      {editable && length > DESCRIPTION_LIMIT * 0.9 && (
        <div className={`rt-count ${length > DESCRIPTION_LIMIT ? "over" : ""}`}>
          {length.toLocaleString()} / {DESCRIPTION_LIMIT.toLocaleString()}
        </div>
      )}
    </div>
  );
};
