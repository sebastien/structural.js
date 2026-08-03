// Project: structural.js
// Author: Sebastien Pierre
// License: Revised BSD License

// Collects plugin-provided capabilities without coupling Editor to feature types.
class EditorPluginHost {
	constructor(editor) {
		this.editor = editor;
		this._capabilities = new Map();
	}

	register(name, value) {
		if (!name || !value) return value;
		const values = this._capabilities.get(name) ?? [];
		if (!values.includes(value)) values.push(value);
		this._capabilities.set(name, values);
		return value;
	}

	registerPlugin(plugin) {
		if (!plugin) return plugin;
		const name = plugin.constructor?.pluginName ?? plugin.pluginName ?? null;
		if (name) this.register(name, plugin);
		this.register("plugin", plugin);
		if (typeof plugin.scopeNodes === "function") this.register("scope-provider", plugin);
		return plugin;
	}

	get(name) {
		return this._capabilities.get(name)?.[0] ?? null;
	}

	all(name) {
		return [...(this._capabilities.get(name) ?? [])];
	}

	clear() {
		this._capabilities.clear();
	}
}

export { EditorPluginHost };
