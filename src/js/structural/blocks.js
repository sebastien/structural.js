// Project: structural.js
// Author:  Sebastien Pierre
// License: Revised BSD License
// Created: 2026-07-28

// Module: blocks
// Declarative structural-block editing: role schema, transforms, input rules, menus.

import { BlockMenus } from "./features/blocks/block-menus.js";
import { el, ListMenu } from "./features/blocks/menus.js";
import { Blocks } from "./features/blocks/plugin.js";
import { defaultBlockInput } from "./features/blocks/rules.js";
import { BlockSchema, blockKeymap, blockSchema } from "./features/blocks/schema.js";

export {
	BlockMenus,
	BlockSchema,
	Blocks,
	ListMenu,
	defaultBlockInput,
	el as blockEl,
	blockKeymap,
	blockSchema,
};

export default {
	BlockMenus,
	BlockSchema,
	Blocks,
	ListMenu,
	defaultBlockInput,
	blockEl: el,
	blockKeymap,
	blockSchema,
};
