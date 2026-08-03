// Project: structural.js
// Author: Sebastien Pierre
// License: Revised BSD License

import { EditorCommand } from "../core/command.js";
import { EditorTransaction } from "../core/transaction.js";

// Schema-driven parser that sanitizes, unwraps, and repairs structural DOM trees.
class EditorNormalizer {
	constructor(schema, options = {}) {
		this.schema = schema;
		this.options = options;
	}

	normalize(target, context = {}) {
		const root = context.root ?? context.editor?.root ?? target;
		const command = new EditorCommand("normalize", {
			actor: context.session?.actor ?? context.actor ?? null,
			meta: { target: this.schema.tag(target) ?? "#node" },
		});
		const transaction = new EditorTransaction(command, { result: false });
		const normalized = this.normalizeNode(target, root, transaction);
		if (normalized?.nodeType === Node.ELEMENT_NODE) this.normalizeEmpty(normalized, root, transaction);
		transaction.result = transaction.steps.length > 0;
		return transaction;
	}

	normalizeNode(node, root, transaction) {
		if (!node || node.nodeType !== Node.ELEMENT_NODE) return node;
		node = this.renameAlias(node, transaction);
		this.pruneEmptyTextChildren(node, transaction);
		for (const child of [...node.childNodes]) {
			if (!child.isConnected) continue;
			let normalizedChild = child;
			if (normalizedChild.nodeType === Node.ELEMENT_NODE) {
				normalizedChild = this.normalizeNode(normalizedChild, root, transaction);
				if (!normalizedChild?.isConnected) continue;
			}
			this.normalizeChild(node, normalizedChild, root, transaction);
		}
		this.normalizeEmpty(node, root, transaction);
		return node;
	}

	renameAlias(node, transaction) {
		const alias = this.schema.aliasFor(node);
		if (!alias || this.schema.tag(node) === alias) return node;
		const next = document.createElement(alias);
		while (node.firstChild) next.appendChild(node.firstChild);
		for (const attr of node.attributes) next.setAttribute(attr.name, attr.value);
		node.replaceWith(next);
		transaction.steps.push({ type: "renameElement", from: node.tagName.toLowerCase(), to: alias });
		return next;
	}

	pruneEmptyTextChildren(node, transaction) {
		if (!this.schema.options.normalize?.pruneEmptyText) return;
		for (const child of [...node.childNodes]) {
			if (child.nodeType === Node.TEXT_NODE && child.data.length === 0) {
				child.remove();
				transaction.steps.push({ type: "removeEmptyText" });
			}
		}
	}

	normalizeChild(parent, child, root, transaction) {
		const parentTag = this.schemaTag(parent, root);
		const childTag = this.schema.tag(child);
		if (childTag === "br" || this.schema.contains(parentTag, childTag)) return;
		if (child.nodeType === Node.TEXT_NODE) {
			this.normalizeText(parent, child, root, transaction);
			return;
		}
		if (child.nodeType !== Node.ELEMENT_NODE || this.schema.isAtom?.(child) || childTag.includes("-")) {
			return;
		}
		const action = this.schema.rule(childTag)
			? this.schema.normalizeAction(parentTag, "invalidChild", "preserve")
			: (this.schema.options.normalize?.unknownElement ?? "unwrap");
		this.applyInvalidAction(parent, child, action, root, transaction);
	}

	normalizeText(parent, child, root, transaction) {
		if (child.data.length === 0) return;
		const parentTag = this.schemaTag(parent, root);
		if (!this.schema.contains(parentTag, "#text") && child.data.trim() === "") {
			child.remove();
			transaction.steps.push({ type: "pruneWhitespace" });
			return;
		}
		const action = this.schema.normalizeAction(parentTag, "text", "preserve");
		if (action === "prune") {
			child.remove();
			transaction.steps.push({ type: "pruneText" });
		} else if (action === "wrap") {
			const wrapper = document.createElement(this.schema.defaultChild(parentTag));
			parent.insertBefore(wrapper, child);
			wrapper.appendChild(child);
			transaction.steps.push({ type: "wrapText", tag: wrapper.tagName.toLowerCase() });
		}
	}

	applyInvalidAction(parent, child, action, root, transaction) {
		if (action === "prune") {
			child.remove();
			transaction.steps.push({ type: "pruneNode", tag: this.schema.tag(child) });
		} else if (action === "unwrap") {
			this.unwrapElement(child);
			transaction.steps.push({ type: "unwrapNode", tag: this.schema.tag(child) });
		} else if (action === "wrap") {
			const wrapper = document.createElement(this.schema.defaultChild(this.schemaTag(parent, root)));
			parent.insertBefore(wrapper, child);
			wrapper.appendChild(child);
			transaction.steps.push({
				type: "wrapNode",
				tag: this.schema.tag(child),
				wrapper: wrapper.tagName.toLowerCase(),
			});
		} else if (action === "lift") {
			parent.parentNode?.insertBefore(child, parent.nextSibling);
			transaction.steps.push({ type: "liftNode", tag: this.schema.tag(child) });
		}
	}

	normalizeEmpty(node, root, transaction) {
		if (node.nodeType !== Node.ELEMENT_NODE || !this.isEmpty(node)) return;
		const tag = this.schemaTag(node, root);
		const action = this.schema.normalizeAction(tag, "empty", "preserve");
		if (action === "prune" && node.parentNode) {
			node.remove();
			transaction.steps.push({ type: "pruneEmpty", tag });
		} else if (action === "fill") {
			const child = document.createElement(this.schema.defaultChild(tag));
			node.appendChild(child);
			this.normalizeEmpty(child, root, transaction);
			transaction.steps.push({ type: "fillEmpty", tag });
		} else if (action === "placeholder") {
			const placeholders = [...node.childNodes].filter(
				(child) => child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === "br",
			);
			if (placeholders.length === 0) node.appendChild(document.createElement("br"));
			else if (placeholders.length > 1 || placeholders.length !== node.childNodes.length) {
				node.replaceChildren(document.createElement("br"));
			}
			transaction.steps.push({ type: "placeholder", tag });
		} else if (action === "unwrap" && node.parentNode) {
			this.unwrapElement(node);
			transaction.steps.push({ type: "unwrapEmpty", tag });
		}
	}

	schemaTag(node, root) {
		return node === root ? ":root" : this.schema.tag(node);
	}

	isEmpty(node) {
		return [...node.childNodes].every(
			(child) =>
				(child.nodeType === Node.TEXT_NODE && child.data.length === 0) ||
				(child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === "br"),
		);
	}

	unwrapElement(node) {
		const parent = node.parentNode;
		while (node.firstChild) parent.insertBefore(node.firstChild, node);
		node.remove();
	}
}

export { EditorNormalizer };
