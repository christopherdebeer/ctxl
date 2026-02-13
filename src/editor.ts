/**
 * editor.ts — CodeMirror 6 wrapper for the dev-harness VFS editor.
 *
 * Provides a thin abstraction so boot.ts can get/set content and
 * listen for changes without touching CM internals directly.
 */

import { basicSetup, EditorView } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorState, Compartment } from "@codemirror/state";
import { keymap } from "@codemirror/view";

export interface EditorInstance {
  /** Get the full document text. */
  getValue(): string;
  /** Replace the entire document. */
  setValue(text: string): void;
  /** Focus the editor. */
  focus(): void;
  /** The underlying CM6 EditorView (escape hatch). */
  view: EditorView;
}

/**
 * Mount a CodeMirror 6 editor inside `parent`.
 *
 * @param parent   DOM element to mount into (replaces its children)
 * @param opts.onChange  Called on every document change
 * @param opts.onSave   Called when Ctrl/Cmd+S is pressed inside the editor
 */
export function createEditor(
  parent: HTMLElement,
  opts: {
    onChange?: () => void;
    onSave?: () => void;
  } = {},
): EditorInstance {
  const language = new Compartment();

  const saveKeymap = keymap.of([
    {
      key: "Mod-s",
      run() {
        opts.onSave?.();
        return true;
      },
    },
  ]);

  const changeListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) opts.onChange?.();
  });

  const theme = EditorView.theme({
    "&": { height: "100%" },
    ".cm-scroller": { overflow: "auto" },
    ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace", fontSize: "12px", lineHeight: "1.4" },
    ".cm-gutters": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: "12px" },
  });

  const view = new EditorView({
    state: EditorState.create({
      doc: "",
      extensions: [
        basicSetup,
        language.of(javascript({ jsx: true, typescript: true })),
        oneDark,
        theme,
        saveKeymap,
        changeListener,
        EditorView.lineWrapping,
      ],
    }),
    parent,
  });

  return {
    getValue() {
      return view.state.doc.toString();
    },
    setValue(text: string) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
    focus() {
      view.focus();
    },
    view,
  };
}
