import joplin from 'api';
import { ContentScriptType, MenuItemLocation, ToolbarButtonLocation } from 'api/types';

const COMMAND_NAME = 'toggleHtmlComment';
const CONTENT_SCRIPT_ID = 'htmlLineCommentEditorScript';
const DEFAULT_ACCELERATOR = 'CmdOrCtrl+Alt+/';

joplin.plugins.register({
	onStart: async function() {
		await registerEditorContentScript();
		await registerCommentCommand();
		await registerToolbarButton();
		await registerDesktopShortcut();
	},
});

async function registerEditorContentScript(): Promise<void> {
	await joplin.contentScripts.register(
		ContentScriptType.CodeMirrorPlugin,
		CONTENT_SCRIPT_ID,
		'./contentScript.js',
	);
}

async function registerCommentCommand(): Promise<void> {
	await joplin.commands.register({
		name: COMMAND_NAME,
		label: 'Toggle HTML Comment',
		iconName: 'fas fa-code',
		enabledCondition: 'markdownEditorPaneVisible && !richTextEditorVisible',
		execute: async () => {
			await joplin.commands.execute('editor.execCommand', {
				name: COMMAND_NAME,
			});
		},
	});
}

async function registerToolbarButton(): Promise<void> {
	await joplin.views.toolbarButtons.create(
		'toggleHtmlCommentToolbarButton',
		COMMAND_NAME,
		ToolbarButtonLocation.EditorToolbar,
	);
}

async function registerDesktopShortcut(): Promise<void> {
	const versionInfo = await joplin.versionInfo();
	if (versionInfo.platform === 'mobile') {
		return;
	}

	try {
		await joplin.views.menuItems.create(
			'toggleHtmlCommentMenuItem',
			COMMAND_NAME,
			MenuItemLocation.Edit,
			{ accelerator: DEFAULT_ACCELERATOR },
		);
	} catch (error) {
		console.warn('Unable to register desktop menu shortcut:', error);
	}
}
