import * as Y from "https://esm.sh/yjs@13.6.15";
import { Editor } from "../src/js/structural/editor.js";
import { Modification } from "../src/js/structural/modification.js";
import { RichText, richTextClasses, richTextKeymap, richTextSchema } from "../src/js/structural/richtext.js";

const STYLE_ID = "collaboration-editor-styles";

function ensureStyles(doc = document) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .collab-shell {
      --collab-bg: #f5f5f5;
      --collab-panel: #ffffff;
      --collab-border: #d9d9d9;
      --collab-fg: #1e1e1e;
      --collab-muted: #666666;
      --collab-accent: #0e639c;
      --collab-header: #1e1e1e;
      background: var(--collab-bg);
      color: var(--collab-fg);
      font-family: system-ui, -apple-system, sans-serif;
    }
    .collab-shell, .collab-shell * { box-sizing: border-box; }
    .collab-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      background: var(--collab-header);
      color: #fff;
      border-bottom: 1px solid #2f2f2f;
    }
    .collab-status {
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 12px;
      background: #3a3a3a;
    }
    .collab-toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 10px 16px;
      background: #f0f0f0;
      border-bottom: 1px solid var(--collab-border);
    }
    .collab-toolbar button {
      border: 1px solid #c8c8c8;
      border-radius: 6px;
      padding: 6px 10px;
      background: #fff;
      cursor: pointer;
      font: inherit;
    }
    .collab-toolbar button:hover { border-color: var(--collab-accent); }
    .collab-toolbar button.active {
      background: var(--collab-accent);
      border-color: var(--collab-accent);
      color: #fff;
    }
    .collab-editor-wrap { padding: 24px; }
    .collab-editor {
      min-height: 420px;
      max-width: 720px;
      margin: 0 auto;
      padding: 24px;
      background: var(--collab-panel);
      border: 1px solid var(--collab-border);
      border-radius: 10px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
      outline: none;
      overflow-wrap: anywhere;
      line-height: 1.6;
    }
    .collab-editor > :first-child { margin-top: 0; }
    .collab-editor > :last-child { margin-bottom: 0; }
    .collab-editor p,
    .collab-editor h1,
    .collab-editor h2,
    .collab-editor h3 { margin: 0 0 0.75em; }
    .collab-editor:focus {
      border-color: var(--collab-accent);
      box-shadow: 0 0 0 3px rgba(14, 99, 156, 0.15);
    }
    .collab-info {
      max-width: 720px;
      margin: 12px auto 0;
      color: var(--collab-muted);
      font-size: 13px;
    }
    .collab-selection {
      position: absolute;
      left: 0;
      top: 0;
      visibility: hidden;
      pointer-events: none;
      z-index: 9998;
    }
    .collab-caret {
      position: absolute;
      width: 2px;
      height: 1lh;
      background: #ff0044;
      opacity: 0.9;
      visibility: hidden;
      pointer-events: none;
      z-index: 9999;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.45);
    }
    .collab-editor .focus {
      outline: 2px solid rgba(14, 99, 156, 0.9);
      outline-offset: 2px;
    }
    .collab-editor .focus-within { background: rgba(14, 99, 156, 0.08); }
    .collab-editor .selected { background: rgba(14, 99, 156, 0.16); }
    .collab-editor .selected-within { background: rgba(14, 99, 156, 0.1); }
  `;
  doc.head.appendChild(style);
}

function shellMarkup(infoText) {
  return `
    <div class="collab-shell">
      <div class="collab-header">
        <strong>Collaboration Editor</strong>
        <span class="collab-status">Connecting...</span>
        <span style="margin-left:auto;font-size:12px;opacity:0.75;">Yjs + BroadcastChannel</span>
      </div>
      <div class="collab-toolbar">
        <button type="button" data-kind="inline" data-tag="strong"><strong>B</strong></button>
        <button type="button" data-kind="inline" data-tag="em"><em>I</em></button>
        <button type="button" data-kind="block" data-tag="h1">H1</button>
        <button type="button" data-kind="block" data-tag="blockquote">Quote</button>
        <span style="margin-left:auto;color:#666;font-size:12px;">Structural editor backed by shared Y.XmlFragment</span>
      </div>
      <div class="collab-editor-wrap">
        <div class="collab-editor" contenteditable="true" spellcheck="false"></div>
        <div class="collab-info">${infoText}</div>
      </div>
      <div id="selection" class="collab-selection"></div>
      <div id="caret" class="collab-caret"></div>
    </div>
  `;
}

function createPeerId() {
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `peer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createCollaborationEditor(mount, options = {}) {
  const doc = mount.ownerDocument;
  ensureStyles(doc);

  const room = options.room ?? "structural-collaboration-demo";
  const canSeed = options.canSeed === true;
  const infoText = options.infoText ?? "Open another editor in the same room to collaborate live.";
  const seedMarkup = options.seedMarkup ?? "<h1>Collaborative document</h1><p>Type in one editor and the other editor should update through Yjs and BroadcastChannel.</p><p>Formatting and block structure are shared by replicating the editor DOM through Y.XmlFragment.</p>";

  mount.innerHTML = shellMarkup(infoText);

  const shell = mount.querySelector(".collab-shell");
  const statusEl = shell.querySelector(".collab-status");
  const toolbarEl = shell.querySelector(".collab-toolbar");
  const editorEl = shell.querySelector(".collab-editor");

  const peerId = createPeerId();
  const localOrigin = { peerId, type: "local" };
  const remoteOrigin = { peerId, type: "remote" };

  const ydoc = new Y.Doc();
  const yxml = ydoc.getXmlFragment("content");
  const channel = new BroadcastChannel(`structural-collaboration:${room}`);

  const editor = new Editor(editorEl, {
    schema: richTextSchema(),
    keymap: richTextKeymap(),
    classes: richTextClasses(),
    plugins: [RichText],
  });
  editor.localSession.nativeSelection = "sync";
  editor.localSession.cursor.selection.mode = "native";
  const mod = new Modification(editor);

  editor.configureActions({
    toggleInline: command => mod.toggleInline(command.args.tag ?? command.args.value),
    toggleBlock: command => mod.toggleBlock(command.args.tag ?? command.args.value),
  });

  let suppressObserver = false;
  let pendingLocalSync = false;
  let localSyncTimer = 0;
  let observing = false;

  const observer = new MutationObserver(() => scheduleLocalSync());

  function pauseObservation() {
    if (!observing) return;
    observer.disconnect();
    observing = false;
  }

  function resumeObservation() {
    if (observing) return;
    observer.observe(editorEl, { childList: true, characterData: true, subtree: true });
    observing = true;
  }

  function updateToolbar() {
    const state = mod.formats();
    for (const button of toolbarEl.querySelectorAll("button[data-tag]")) {
      button.classList.toggle("active", !!state[button.dataset.tag]);
    }
  }

  function setStatus(text, color = "#0e639c") {
    statusEl.textContent = text;
    statusEl.style.background = color;
  }

  function normalizeMarkup(markup) {
    const value = (markup || "").trim();
    return value.length > 0 ? value : "<p><br></p>";
  }

  function serializedEditorMarkup() {
    const clone = editorEl.cloneNode(true);
    for (const element of clone.querySelectorAll("[class]")) {
      element.removeAttribute("class");
    }
    return normalizeMarkup(clone.innerHTML);
  }

  function parseMarkup(markup) {
    const template = doc.createElement("template");
    template.innerHTML = normalizeMarkup(markup);
    return Array.from(template.content.childNodes);
  }

  function fragmentMarkup() {
    return normalizeMarkup(yxml.toJSON());
  }

  function domChildren(parent) {
    return Array.from(parent.childNodes).filter(node =>
      node.nodeType === Node.TEXT_NODE || node.nodeType === Node.ELEMENT_NODE
    );
  }

  function sameDomKind(currentNode, nextNode) {
    if (!currentNode || !nextNode) return false;
    if (currentNode.nodeType !== nextNode.nodeType) return false;
    if (currentNode.nodeType === Node.TEXT_NODE) return true;
    return currentNode.tagName.toLowerCase() === nextNode.tagName.toLowerCase();
  }

  function syncedAttributes(element) {
    return Array.from(element.attributes).filter(({ name }) => name !== "class");
  }

  function selectionWithinEditor(selection) {
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    return editor.root.contains(range.startContainer) && editor.root.contains(range.endContainer);
  }

  function domCharacterOffsets(range) {
    const startRange = doc.createRange();
    startRange.selectNodeContents(editor.root);
    startRange.setEnd(range.startContainer, range.startOffset);
    const endRange = doc.createRange();
    endRange.selectNodeContents(editor.root);
    endRange.setEnd(range.endContainer, range.endOffset);
    return { domStart: startRange.toString().length, domEnd: endRange.toString().length };
  }

  function locateDomTextPosition(offset) {
    const walker = doc.createTreeWalker(editor.root, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let node = walker.nextNode();
    while (node) {
      const length = node.textContent?.length || 0;
      if (remaining <= length) return { node, offset: remaining };
      remaining -= length;
      node = walker.nextNode();
    }
    return null;
  }

  function captureStructuralSelection() {
    const selection = doc.defaultView.getSelection();
    if (selection?.rangeCount) {
      const range = selection.getRangeAt(0);
      if (editor.range.within(editor.root, range)) {
        editor.text.refresh();
        editor.selection.syncFromNative(editor.root, editor.localSession);
        const start = editor.text.indexOfPoint({ node: range.startContainer, offset: range.startOffset });
        const end = editor.text.indexOfPoint({ node: range.endContainer, offset: range.endOffset });
        const snapshot = editor.localSession.snapshotSelection();
        const domOffsets = domCharacterOffsets(range);
        return {
          ...snapshot,
          start: start >= 0 ? start : snapshot.offset ?? 0,
          end: end >= 0 ? end : snapshot.offset ?? 0,
          domStart: domOffsets.domStart,
          domEnd: domOffsets.domEnd,
        };
      }
    }
    if (doc.activeElement === editor.root || editor.localSession.currentBlock?.isConnected) {
      const snapshot = editor.localSession.snapshotSelection();
      return {
        ...snapshot,
        start: snapshot.offset ?? 0,
        end: snapshot.offset ?? 0,
        domStart: snapshot.offset ?? 0,
        domEnd: snapshot.offset ?? 0,
      };
    }
    return null;
  }

  function syncDomAttributes(currentElement, nextElement) {
    const current = Object.fromEntries(syncedAttributes(currentElement).map(({ name, value }) => [name, value]));
    const next = Object.fromEntries(syncedAttributes(nextElement).map(({ name, value }) => [name, value]));
    for (const name of Object.keys(current)) {
      if (!(name in next)) currentElement.removeAttribute(name);
    }
    for (const [name, value] of Object.entries(next)) {
      if (current[name] !== value) currentElement.setAttribute(name, value);
    }
  }

  function patchDomNode(currentNode, nextNode) {
    if (currentNode.nodeType === Node.TEXT_NODE && nextNode.nodeType === Node.TEXT_NODE) {
      if (currentNode.textContent !== nextNode.textContent) currentNode.textContent = nextNode.textContent;
      return currentNode;
    }
    syncDomAttributes(currentNode, nextNode);
    patchDomChildren(currentNode, domChildren(nextNode));
    return currentNode;
  }

  function patchDomChildren(parent, nextNodes) {
    let index = 0;
    while (index < nextNodes.length || index < parent.childNodes.length) {
      const currentNode = parent.childNodes[index] || null;
      const nextNode = nextNodes[index] || null;
      if (!nextNode) {
        currentNode?.remove();
        continue;
      }
      if (!currentNode) {
        parent.appendChild(nextNode.cloneNode(true));
        index += 1;
        continue;
      }
      if (!sameDomKind(currentNode, nextNode)) {
        const nextCurrent = parent.childNodes[index + 1] || null;
        const nextDesired = nextNodes[index + 1] || null;
        if (nextCurrent && sameDomKind(nextCurrent, nextNode)) {
          currentNode.remove();
          continue;
        }
        if (nextDesired && sameDomKind(currentNode, nextDesired)) {
          parent.insertBefore(nextNode.cloneNode(true), currentNode);
          index += 1;
          continue;
        }
        currentNode.replaceWith(nextNode.cloneNode(true));
        index += 1;
        continue;
      }
      patchDomNode(currentNode, nextNode);
      index += 1;
    }
  }

  function restoreStructuralSelection(snapshot) {
    if (!snapshot) return;
    editor.text.refresh();
    editor.root.focus();
    const start = editor.text.clampIndex(snapshot.start ?? snapshot.offset ?? 0);
    const end = editor.text.clampIndex(snapshot.end ?? snapshot.offset ?? 0);
    if (snapshot.selectionKind === "range" && start !== end) {
      editor.selection.select(start, end, editor.localSession);
    } else {
      editor.localSession.cursor.moveTo(end);
    }
    editor.localSession.currentBlock = editor.blockFor(editor.localSession.cursor.anchor) ?? editor.currentEditableBlock(editor.localSession);
    editor._currentBlock = editor.localSession.currentBlock;
    const synced = editor.selection.syncToNative(editor.localSession);
    const nativeSelection = doc.defaultView.getSelection();
    if ((!synced || !nativeSelection?.rangeCount) && start >= 0 && end >= 0) {
      const startPoint = editor.text.pointAt(start);
      const endPoint = editor.text.pointAt(end);
      if (startPoint?.node?.isConnected && endPoint?.node?.isConnected) {
        const range = doc.createRange();
        range.setStart(startPoint.node, startPoint.offset);
        range.setEnd(endPoint.node, endPoint.offset);
        nativeSelection?.removeAllRanges();
        nativeSelection?.addRange(range);
      }
    }
    if (!doc.defaultView.getSelection()?.rangeCount) {
      const startPoint = locateDomTextPosition(snapshot.domStart ?? 0);
      const endPoint = locateDomTextPosition(snapshot.domEnd ?? snapshot.domStart ?? 0);
      if (startPoint?.node?.isConnected && endPoint?.node?.isConnected) {
        const range = doc.createRange();
        range.setStart(startPoint.node, Math.min(startPoint.offset, startPoint.node.textContent.length));
        range.setEnd(endPoint.node, Math.min(endPoint.offset, endPoint.node.textContent.length));
        const selection = doc.defaultView.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
    editor.localSession.classes?.update();
    updateToolbar();
  }

  function domNodeToYNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const ytext = new Y.XmlText();
      ytext.insert(0, node.textContent || "");
      return ytext;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const yelement = new Y.XmlElement(node.tagName.toLowerCase());
    for (const { name, value } of syncedAttributes(node)) yelement.setAttribute(name, value);
    const children = Array.from(node.childNodes).map(domNodeToYNode).filter(Boolean);
    if (children.length > 0) yelement.insert(0, children);
    return yelement;
  }

  function markupToYNodes(markup) {
    return parseMarkup(markup).map(domNodeToYNode).filter(Boolean);
  }

  function sameNodeKind(yNode, domNode) {
    if (yNode instanceof Y.XmlText) return domNode.nodeType === Node.TEXT_NODE;
    if (yNode instanceof Y.XmlElement) {
      return domNode.nodeType === Node.ELEMENT_NODE && yNode.nodeName.toLowerCase() === domNode.tagName.toLowerCase();
    }
    return false;
  }

  function syncYText(yText, domText) {
    const nextText = domText.textContent || "";
    const currentText = yText.toString();
    if (currentText === nextText) return;
    if (yText.length > 0) yText.delete(0, yText.length);
    if (nextText.length > 0) yText.insert(0, nextText);
  }

  function syncYAttributes(yElement, domElement) {
    const current = yElement.getAttributes();
    const next = Object.fromEntries(syncedAttributes(domElement).map(({ name, value }) => [name, value]));
    for (const name of Object.keys(current)) {
      if (!(name in next)) yElement.removeAttribute(name);
    }
    for (const [name, value] of Object.entries(next)) {
      if (current[name] !== value) yElement.setAttribute(name, value);
    }
  }

  function syncYChildren(yParent, domNodes) {
    let index = 0;
    while (index < domNodes.length || index < yParent.length) {
      const domNode = domNodes[index] || null;
      const yNode = index < yParent.length ? yParent.get(index) : null;
      if (!domNode) {
        yParent.delete(index, 1);
        continue;
      }
      if (!yNode) {
        yParent.insert(index, [domNodeToYNode(domNode)]);
        index += 1;
        continue;
      }
      if (!sameNodeKind(yNode, domNode)) {
        const nextYNode = index + 1 < yParent.length ? yParent.get(index + 1) : null;
        const nextDomNode = domNodes[index + 1] || null;
        if (nextYNode && sameNodeKind(nextYNode, domNode)) {
          yParent.delete(index, 1);
          continue;
        }
        if (nextDomNode && sameNodeKind(yNode, nextDomNode)) {
          yParent.insert(index, [domNodeToYNode(domNode)]);
          index += 1;
          continue;
        }
        yParent.delete(index, 1);
        yParent.insert(index, [domNodeToYNode(domNode)]);
        index += 1;
        continue;
      }
      if (yNode instanceof Y.XmlText) {
        syncYText(yNode, domNode);
      } else {
        syncYAttributes(yNode, domNode);
        syncYChildren(yNode, domChildren(domNode));
      }
      index += 1;
    }
  }

  function seedYFragment(markup, origin) {
    const ynodes = markupToYNodes(markup);
    ydoc.transact(() => {
      if (yxml.length > 0) yxml.delete(0, yxml.length);
      if (ynodes.length > 0) yxml.insert(0, ynodes);
    }, origin);
  }

  function renderFromYXml() {
    const nextMarkup = fragmentMarkup();
    const currentMarkup = normalizeMarkup(editorEl.innerHTML.replace(/ class="[^"]*"/g, ""));
    if (currentMarkup === nextMarkup) return;

    const selectionSnapshot = captureStructuralSelection();
    const hadFocus = doc.activeElement === editor.root;

    suppressObserver = true;
    pauseObservation();
    patchDomChildren(editorEl, Array.from(yxml.toDOM().childNodes));
    editor.text.refresh();
    editor.normalize(editor.root, { session: editor.localSession });
    editor.localSession.currentBlock = editor.currentEditableBlock(editor.localSession);
    editor._currentBlock = editor.localSession.currentBlock;
    editor.localSession.classes?.update();

    const nativeSelection = doc.defaultView.getSelection();
    if (hadFocus && !selectionWithinEditor(nativeSelection)) {
      restoreStructuralSelection(selectionSnapshot);
    } else {
      updateToolbar();
    }
    suppressObserver = false;
    resumeObservation();
  }

  function writeDOMToYXml() {
    if (suppressObserver) return;
    suppressObserver = true;
    pauseObservation();
    editor.text.refresh();
    editor.normalize(editor.root, { session: editor.localSession });
    const selection = doc.defaultView.getSelection();
    if (selection?.rangeCount) {
      const range = selection.getRangeAt(0);
      if (editor.range.within(editor.root, range)) {
        editor.selection.syncFromNative(editor.root, editor.localSession);
      }
    }
    editor.localSession.currentBlock = editor.currentEditableBlock(editor.localSession);
    editor._currentBlock = editor.localSession.currentBlock;
    editor.localSession.classes?.update();
    suppressObserver = false;
    resumeObservation();

    const nextMarkup = serializedEditorMarkup();
    const currentMarkup = fragmentMarkup();
    if (currentMarkup === nextMarkup) return;
    ydoc.transact(() => {
      syncYChildren(yxml, domChildren(editorEl));
    }, localOrigin);
  }

  function scheduleLocalSync() {
    if (suppressObserver || pendingLocalSync) return;
    pendingLocalSync = true;
    localSyncTimer = doc.defaultView.setTimeout(() => {
      pendingLocalSync = false;
      localSyncTimer = 0;
      writeDOMToYXml();
    }, 0);
  }

  function post(message) {
    channel.postMessage({ ...message, sender: peerId });
  }

  function requestSync() {
    post({ type: "sync-request", stateVector: Array.from(Y.encodeStateVector(ydoc)) });
  }

  const onChannelMessage = event => {
    const message = event.data;
    if (!message || message.sender === peerId) return;
    if (message.type === "sync-request") {
      const update = Y.encodeStateAsUpdate(ydoc, new Uint8Array(message.stateVector));
      post({ type: "sync-response", update: Array.from(update) });
      return;
    }
    if (message.type === "sync-response" || message.type === "doc-update") {
      Y.applyUpdate(ydoc, new Uint8Array(message.update), remoteOrigin);
    }
  };

  const onDocUpdate = (update, origin) => {
    if (origin === remoteOrigin) return;
    post({ type: "doc-update", update: Array.from(update) });
  };

  const onRemoteTree = (_events, transaction) => {
    if (transaction.origin === localOrigin) return;
    renderFromYXml();
  };

  resumeObservation();

  const onInput = () => scheduleLocalSync();
  const onEditorMouseDownCapture = event => {
    if (event.button !== 0) return;
    event.stopPropagation();
  };
  const onBlur = () => {
    if (editorEl.innerHTML.trim() !== "") return;
    suppressObserver = true;
    editorEl.innerHTML = "<p><br></p>";
    suppressObserver = false;
    editor.syncAfterMutation(editor.firstBlockIn(editor.root) ? { block: editor.firstBlockIn(editor.root) } : null, editor.localSession);
    scheduleLocalSync();
  };
  const onToolbarMouseDown = event => event.preventDefault();
  const onToolbarClick = event => {
    const button = event.target.closest("button[data-tag]");
    if (!button) return;
    const tag = button.dataset.tag;
    if (button.dataset.kind === "inline") {
      editor.action(`toggleInline:${tag}`);
    } else {
      editor.action(`toggleBlock:${tag}`);
    }
    updateToolbar();
    scheduleLocalSync();
  };
  const onSelectionChange = () => {
    const selection = doc.defaultView.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.range.within(editor.root, range)) return;
    editor.text.refresh();
    editor.selection.syncFromNative(editor.root, editor.localSession);
    editor.localSession.currentBlock = editor.currentEditableBlock(editor.localSession);
    editor._currentBlock = editor.localSession.currentBlock;
    updateToolbar();
  };
  const onCursorMove = () => {
    editor.localSession.currentBlock = editor.blockFor(editor.input.cursor.anchor) ?? editor.localSession.currentBlock;
    editor._currentBlock = editor.localSession.currentBlock;
    updateToolbar();
  };

  channel.addEventListener("message", onChannelMessage);
  ydoc.on("update", onDocUpdate);
  yxml.observeDeep(onRemoteTree);
  editorEl.addEventListener("input", onInput);
  editorEl.addEventListener("mousedown", onEditorMouseDownCapture, true);
  editorEl.addEventListener("blur", onBlur);
  toolbarEl.addEventListener("mousedown", onToolbarMouseDown);
  toolbarEl.addEventListener("click", onToolbarClick);
  doc.addEventListener("selectionchange", onSelectionChange);
  editor.root.addEventListener("CursorMove", onCursorMove);

  requestSync();
  setStatus(`Connected: ${room}`);
  renderFromYXml();
  updateToolbar();

  const seedTimer = doc.defaultView.setTimeout(() => {
    if (!canSeed || yxml.length > 0) return;
    seedYFragment(seedMarkup, localOrigin);
    renderFromYXml();
    updateToolbar();
  }, 150);

  return {
    destroy() {
      doc.defaultView.clearTimeout(seedTimer);
      if (localSyncTimer) doc.defaultView.clearTimeout(localSyncTimer);
      observer.disconnect();
      editorEl.removeEventListener("input", onInput);
      editorEl.removeEventListener("mousedown", onEditorMouseDownCapture, true);
      editorEl.removeEventListener("blur", onBlur);
      toolbarEl.removeEventListener("mousedown", onToolbarMouseDown);
      toolbarEl.removeEventListener("click", onToolbarClick);
      doc.removeEventListener("selectionchange", onSelectionChange);
      editor.root.removeEventListener("CursorMove", onCursorMove);
      channel.removeEventListener("message", onChannelMessage);
      channel.close();
      yxml.unobserveDeep(onRemoteTree);
      editor.destroy();
    },
  };
}
