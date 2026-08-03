// Project: structural.js
// Author: Sebastien Pierre
// License: Revised BSD License

// Legacy structural DOM markers. Keep these compatibility aliases outside core
// editor behavior so applications can migrate to schema-defined roles over time.
export function isLegacySkipped(node) {
	return (
		node?.classList?.contains("skipped") ||
		node?.classList?.contains("skip") ||
		node?.classList?.contains("S")
	);
}

export function isLegacyContainer(node) {
	return node?.classList?.contains("container") || node?.classList?.contains("C");
}

export function isLegacyAtom(node) {
	return node?.classList?.contains("atom") || node?.classList?.contains("atomic");
}

export const LEGACY_STRUCTURAL_SELECTOR = ".atom, .atomic, .container, .C";
export const LEGACY_ATOM_SELECTOR = ".atom, .atomic";
export const LEGACY_CONTAINER_SELECTOR = ".container, .C";
export const LEGACY_SKIPPED_SELECTOR = ".skipped, .skip, .S";
