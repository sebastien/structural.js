// Project: structural.js
// Author:  Sébastien Pierre
// License: Revised BSD License
// Created: 2026-06-16

// Module: selection
// Compatibility barrel for selection helpers and controller classes.

import {
	clientToHostLocal,
	clientToOffsetParent,
	prepareOverlayHost,
} from "./selection/geometry.js";
import SelectionOverlay from "./rendering/selection-overlay.js";
import TextSelection from "./selection/text-selection.js";
import { EditorSelectionController } from "./selection/controller.js";

export {
	EditorSelectionController,
	SelectionOverlay,
	TextSelection,
	prepareOverlayHost,
	clientToHostLocal,
	clientToOffsetParent,
};

// EOF
