'use client';
import { useState, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
export function RichEditor({ name, initial = '' }: { name: string; initial?: string }) {
  const [html, setHtml] = useState(initial);
  const root = useRef<HTMLDivElement>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
      }),
    ],
    content: initial,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      setHtml(editor.getHTML());
      root.current?.dispatchEvent(new Event('input', { bubbles: true }));
    },
    editorProps: { attributes: { 'aria-label': 'Rich text content', class: 'prose' } },
  });
  return (
    <div className="rich-editor" ref={root}>
      <input type="hidden" name={name} value={html} />
      <div className="editor-toolbar" aria-label="Text formatting">
        {[
          { name: 'Bold', active: 'bold', run: () => editor?.chain().focus().toggleBold().run() },
          {
            name: 'Italic',
            active: 'italic',
            run: () => editor?.chain().focus().toggleItalic().run(),
          },
          {
            name: 'List',
            active: 'bulletList',
            run: () => editor?.chain().focus().toggleBulletList().run(),
          },
          { name: 'Undo', active: '', run: () => editor?.chain().focus().undo().run() },
          { name: 'Redo', active: '', run: () => editor?.chain().focus().redo().run() },
        ].map((item) => (
          <button
            type="button"
            key={item.name}
            aria-pressed={item.active ? editor?.isActive(item.active) : undefined}
            className={item.active && editor?.isActive(item.active) ? 'active' : ''}
            onClick={item.run}
          >
            {item.name}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
