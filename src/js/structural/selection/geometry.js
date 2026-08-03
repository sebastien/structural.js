// Project: structural.js
// Author: Sebastien Pierre
// License: Revised BSD License

// Prepares a virtual overlay host and optionally mounts it under `container`.
export function prepareOverlayHost(node, container = null) {
	if (!node) return null;
	node.style.position = "absolute";
	if (!node.style.left) node.style.left = "0px";
	if (!node.style.top) node.style.top = "0px";
	if (!node.style.visibility) node.style.visibility = "hidden";
	node.setAttribute("aria-hidden", "true");
	node.style.pointerEvents = "none";
	if (container && container.nodeType === Node.ELEMENT_NODE) {
		const containerPos = container.style.position || getComputedStyle(container).position;
		if (!containerPos || containerPos === "static") container.style.position = "relative";
		if (node.parentNode !== container) container.appendChild(node);
	}
	return node;
}

// Converts viewport client coordinates to coordinates relative to an overlay host.
export function clientToHostLocal(clientX, clientY, host) {
	if (!host) return { x: clientX + window.scrollX, y: clientY + window.scrollY };
	const origin = host.getBoundingClientRect();
	return { x: clientX - origin.left, y: clientY - origin.top };
}

// Converts viewport client coordinates to an absolutely positioned node's offset parent.
export function clientToOffsetParent(clientX, clientY, node) {
	const parent = node?.offsetParent;
	if (!parent) return { x: clientX + window.scrollX, y: clientY + window.scrollY };
	const origin = parent.getBoundingClientRect();
	return {
		x: clientX - origin.left - parent.clientLeft + parent.scrollLeft,
		y: clientY - origin.top - parent.clientTop + parent.scrollTop,
	};
}
