// Project: structural.js
// Author: Sebastien Pierre
// License: Revised BSD License

// Records the lifecycle, modified steps, and outcome of dispatching a command.
class EditorTransaction {
	constructor(command, options = {}) {
		this.command = command;
		this.steps = options.steps ?? [];
		this.inverse = options.inverse ?? [];
		this.selectionBefore = options.selectionBefore ?? null;
		this.selectionAfter = options.selectionAfter ?? null;
		this.result = options.result ?? false;
	}

	get handled() {
		return this.result !== false;
	}

	toJSON() {
		return {
			command: this.command?.toJSON?.() ?? this.command,
			steps: this.steps,
			inverse: this.inverse,
			selectionBefore: this.selectionBefore,
			selectionAfter: this.selectionAfter,
			result: this.result,
		};
	}
}

export { EditorTransaction };
