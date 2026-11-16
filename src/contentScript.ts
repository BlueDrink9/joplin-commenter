interface LineToggleResult {
	newText: string;
	cursorOffsetFromLineStart?: number;
}

interface InlineToggleResult {
	from: number;
	to: number;
	insert: string;
	newSelectionFrom: number;
	newSelectionTo: number;
}

interface TextChange {
	from: number;
	to: number;
	insert: string;
}

interface SelectionRangeSpec {
	anchor: number;
	head: number;
}

const COMMAND_NAME = 'toggleHtmlComment';
const CM6_SHORTCUT = 'Mod-Alt-/';

export default function(_context: { contentScriptId: string; postMessage: any }) {
	return {
		plugin: (codeMirrorWrapper: any) => {
			if (codeMirrorWrapper.cm6) {
				initializeCodeMirror6(codeMirrorWrapper);
			} else {
				initializeCodeMirror5(codeMirrorWrapper);
			}
		},
	};
}

function initializeCodeMirror6(codeMirrorWrapper: any): void {
	codeMirrorWrapper.registerCommand(COMMAND_NAME, () => {
		toggleHtmlCommentInCm6(codeMirrorWrapper.cm6);
	});

	try {
		// Joplin externalizes @codemirror/view at runtime so plugins share the host editor instance
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { keymap } = require('@codemirror/view');
		codeMirrorWrapper.addExtension(
			keymap.of([
				{
					key: CM6_SHORTCUT,
					run: (view: any) => {
						toggleHtmlCommentInCm6(view);
						return true;
					},
				},
			]),
		);
	} catch (error) {
		console.warn('CodeMirror 6 keymap extension unavailable:', error);
	}
}

function initializeCodeMirror5(codeMirror: any): void {
	codeMirror.commands[COMMAND_NAME] = (cm: any) => {
		toggleHtmlCommentInCm5(cm);
	};
}

function toggleHtmlCommentInCm6(view: any): void {
	const ranges = [...view.state.selection.ranges].sort((a, b) => a.from - b.from);
	const isInlineOnly = ranges.every((range) => isPartialSingleLineSelection(view.state.doc, range));

	if (isInlineOnly) {
		applyInlineChangesInCm6(view, ranges);
		return;
	}

	applyLineChangesInCm6(view, ranges);
}

function applyInlineChangesInCm6(view: any, ranges: any[]): void {
	const changes: TextChange[] = [];
	const nextRanges: SelectionRangeSpec[] = [];
	let offsetDelta = 0;

	for (const range of ranges) {
		const line = view.state.doc.lineAt(range.from);
		const result = toggleInlineHtmlComment(
			line.text,
			range.from - line.from,
			range.to - line.from,
		);

		const absFrom = line.from + result.from;
		const absTo = line.from + result.to;

		changes.push({
			from: absFrom,
			to: absTo,
			insert: result.insert,
		});

		const newFrom = line.from + result.newSelectionFrom + offsetDelta;
		const newTo = line.from + result.newSelectionTo + offsetDelta;
		nextRanges.push({ anchor: newFrom, head: newTo });

		offsetDelta += result.insert.length - (absTo - absFrom);
	}

	view.dispatch({
		changes,
		selection: createCm6Selection(nextRanges),
	});
	view.focus();
}

function applyLineChangesInCm6(view: any, ranges: any[]): void {
	const lineNumbers = getUniqueSelectedLineNumbers(view.state.doc, ranges);
	const changes: TextChange[] = [];
	let singleEmptyLineCursorPos: number | undefined;

	for (const lineNumber of lineNumbers) {
		const line = view.state.doc.line(lineNumber);
		const result = toggleLineHtmlComment(line.text);

		changes.push({
			from: line.from,
			to: line.to,
			insert: result.newText,
		});

		if (lineNumbers.length === 1 && result.cursorOffsetFromLineStart !== undefined) {
			singleEmptyLineCursorPos = line.from + result.cursorOffsetFromLineStart;
		}
	}

	view.dispatch({
		changes,
		selection: singleEmptyLineCursorPos !== undefined
			? { anchor: singleEmptyLineCursorPos }
			: undefined,
	});
	view.focus();
}

function toggleHtmlCommentInCm5(cm: any): void {
	cm.operation(() => {
		const selections = cm.listSelections();
		const isInlineOnly = selections.every((range: any) => {
			if (range.anchor.line !== range.head.line) return false;
			if (range.anchor.ch === range.head.ch) return false;
			const startCh = Math.min(range.anchor.ch, range.head.ch);
			const endCh = Math.max(range.anchor.ch, range.head.ch);
			const lineLength = cm.getLine(range.anchor.line).length;
			return !(startCh === 0 && endCh === lineLength);
		});

		if (isInlineOnly) {
			for (const range of selections) {
				const lineNum = range.anchor.line;
				const startCh = Math.min(range.anchor.ch, range.head.ch);
				const endCh = Math.max(range.anchor.ch, range.head.ch);
				const lineText = cm.getLine(lineNum);
				const result = toggleInlineHtmlComment(lineText, startCh, endCh);

				cm.replaceRange(
					result.insert,
					{ line: lineNum, ch: result.from },
					{ line: lineNum, ch: result.to },
				);
				cm.setSelection(
					{ line: lineNum, ch: result.newSelectionFrom },
					{ line: lineNum, ch: result.newSelectionTo },
				);
			}
			return;
		}

		const lineSet = new Set<number>();
		for (const range of selections) {
			const startLine = Math.min(range.anchor.line, range.head.line);
			const endLine = Math.max(range.anchor.line, range.head.line);
			for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
				lineSet.add(lineNum);
			}
		}

		const sortedLines = Array.from(lineSet).sort((a, b) => a - b);
		for (const lineNum of sortedLines) {
			const lineText = cm.getLine(lineNum);
			const result = toggleLineHtmlComment(lineText);
			cm.replaceRange(
				result.newText,
				{ line: lineNum, ch: 0 },
				{ line: lineNum, ch: lineText.length },
			);

			if (sortedLines.length === 1 && result.cursorOffsetFromLineStart !== undefined) {
				cm.setCursor({ line: lineNum, ch: result.cursorOffsetFromLineStart });
			}
		}
	});
}

function isPartialSingleLineSelection(doc: any, range: any): boolean {
	if (range.empty) return false;
	const startLine = doc.lineAt(range.from);
	const endLine = doc.lineAt(range.to);
	if (startLine.number !== endLine.number) return false;
	return !(range.from === startLine.from && range.to === startLine.to);
}

function getUniqueSelectedLineNumbers(doc: any, ranges: any[]): number[] {
	const lineNumbers = new Set<number>();

	for (const range of ranges) {
		const startLine = doc.lineAt(range.from).number;
		const endLine = doc.lineAt(range.to).number;
		for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
			lineNumbers.add(lineNum);
		}
	}

	return Array.from(lineNumbers).sort((a, b) => a - b);
}

function createCm6Selection(ranges: SelectionRangeSpec[]): any {
	if (ranges.length === 1) {
		return { anchor: ranges[0].anchor, head: ranges[0].head };
	}

	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { EditorSelection } = require('@codemirror/state');
		return EditorSelection.create(
			ranges.map((r) => EditorSelection.range(r.anchor, r.head)),
		);
	} catch {
		return { anchor: ranges[0].anchor, head: ranges[0].head };
	}
}

function toggleInlineHtmlComment(
	lineText: string,
	startCol: number,
	endCol: number,
): InlineToggleResult {
	const selected = lineText.slice(startCol, endCol);

	if (isSingleHtmlComment(selected)) {
		const inner = unwrapHtmlComment(selected);
		return {
			from: startCol,
			to: endCol,
			insert: inner,
			newSelectionFrom: startCol,
			newSelectionTo: startCol + inner.length,
		};
	}

	const before = lineText.slice(0, startCol);
	const after = lineText.slice(endCol);
	const beforeMatch = before.match(/<!-- ?$/);
	const afterMatch = after.match(/^ ?-->/);

	if (beforeMatch && afterMatch) {
		const replaceFrom = startCol - beforeMatch[0].length;
		const replaceTo = endCol + afterMatch[0].length;
		return {
			from: replaceFrom,
			to: replaceTo,
			insert: selected,
			newSelectionFrom: replaceFrom,
			newSelectionTo: replaceFrom + selected.length,
		};
	}

	const wrapped = `<!-- ${selected} -->`;
	return {
		from: startCol,
		to: endCol,
		insert: wrapped,
		newSelectionFrom: startCol,
		newSelectionTo: startCol + wrapped.length,
	};
}

function toggleLineHtmlComment(lineText: string): LineToggleResult {
	const leadingWhitespaceMatch = lineText.match(/^(\s*)/);
	const indent = leadingWhitespaceMatch ? leadingWhitespaceMatch[1] : '';
	const trimmed = lineText.slice(indent.length).trimEnd();

	if (trimmed.length === 0) {
		return {
			newText: `${indent}<!--  -->`,
			cursorOffsetFromLineStart: indent.length + 5,
		};
	}

	if (isSingleHtmlComment(trimmed)) {
		return {
			newText: `${indent}${unwrapHtmlComment(trimmed)}`,
		};
	}

	return {
		newText: `${indent}<!-- ${trimmed} -->`,
	};
}

function isSingleHtmlComment(text: string): boolean {
	return (
		text.startsWith('<!--') &&
		text.endsWith('-->') &&
		text.indexOf('-->') === text.length - 3
	);
}

function unwrapHtmlComment(commentText: string): string {
	return commentText
		.slice(4, -3)
		.replace(/^ /, '')
		.replace(/ $/, '');
}
