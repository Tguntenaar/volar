import * as shared from '@volar/shared';
import type * as ts2 from '@volar/typescript-language-service';
import { EmbeddedLanguageServicePlugin } from '@volar/vue-language-service-types';
import type { VueCompilerOptions } from '@volar/vue-typescript';
import * as html from 'vscode-html-languageservice';
import * as vscode from 'vscode-languageserver-protocol';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { VueDocument } from '../vueDocuments';
import useHtmlPlugin from './html';

const dataProvider = html.newHTMLDataProvider('vue', {
	version: 1.1,
	tags: [
		{
			name: 'template',
			attributes: [
				{
					name: 'lang',
					values: [
						{ name: 'html' },
						{ name: 'pug' },
					],
				},
			],
		},
		{
			name: 'script',
			attributes: [
				{
					name: 'lang',
					values: [
						{ name: 'js' },
						{ name: 'ts' },
						{ name: 'jsx' },
						{ name: 'tsx' },
					],
				},
				{ name: 'setup', valueSet: 'v' },
			],
		},
		{
			name: 'style',
			attributes: [
				{
					name: 'lang',
					values: [
						{ name: 'css' },
						{ name: 'scss' },
						{ name: 'less' },
						{ name: 'stylus' },
						{ name: 'postcss' },
						{ name: 'sass' },
					],
				},
				{ name: 'scoped', valueSet: 'v' },
				{ name: 'module', valueSet: 'v' },
			],
		},
	],
	globalAttributes: [
		{
			name: 'src',
		},
		{
			name: 'lang',
			// all other embedded languages
			values: [
				// template
				{ name: 'html' },
				{ name: 'pug' },
				// script
				{ name: 'js' },
				{ name: 'ts' },
				{ name: 'jsx' },
				{ name: 'tsx' },
				// style
				{ name: 'css' },
				{ name: 'scss' },
				{ name: 'less' },
				{ name: 'stylus' },
				{ name: 'postcss' },
				{ name: 'sass' },
				// custom block
				{ name: 'md' },
				{ name: 'json' },
				{ name: 'jsonc' },
				{ name: 'yaml' },
				{ name: 'toml' },
				{ name: 'gql' },
				{ name: 'graphql' },
			],
		}
	]
});

export default function (options: {
	getVueDocument(document: TextDocument): VueDocument | undefined,
	tsLs: ts2.LanguageService | undefined,
	vueCompilerOptions: VueCompilerOptions,
}): EmbeddedLanguageServicePlugin {

	const htmlPlugin = useHtmlPlugin({
		validLang: 'vue',
		disableCustomData: true,
	});
	htmlPlugin.htmlLs.setDataProviders(false, [dataProvider]);

	return {

		...htmlPlugin,

		doValidation(document) {
			return worker(document, (vueDocument) => {

				const result: vscode.Diagnostic[] = [];
				const sfc = vueDocument.file.getDescriptor();
				const scriptSetupRanges = vueDocument.file.getScriptSetupRanges();

				if (scriptSetupRanges && sfc.scriptSetup) {
					for (const range of scriptSetupRanges.notOnTopTypeExports) {
						result.push(vscode.Diagnostic.create(
							{
								start: document.positionAt(range.start + sfc.scriptSetup.startTagEnd),
								end: document.positionAt(range.end + sfc.scriptSetup.startTagEnd),
							},
							'type and interface export statements must be on the top in <script setup>',
							vscode.DiagnosticSeverity.Warning,
							undefined,
							'volar',
						));
					}
				}

				if (options.tsLs && !options.tsLs.__internal__.isValidFile(vueDocument.file.getScriptTsFile().fileName)) {
					for (const script of [sfc.script, sfc.scriptSetup]) {

						if (!script || script.content === '')
							continue;

						const error = vscode.Diagnostic.create(
							{
								start: document.positionAt(script.start),
								end: document.positionAt(script.startTagEnd),
							},
							'Virtual script not found, may missing <script lang="ts"> / "allowJs": true / jsconfig.json.',
							vscode.DiagnosticSeverity.Information,
							undefined,
							'volar',
						);
						result.push(error);
					}
				}

				if (options.tsLs && sfc.template && vueDocument.file.isJsxMissing()) {
					const error = vscode.Diagnostic.create(
						{
							start: document.positionAt(sfc.template.start),
							end: document.positionAt(sfc.template.startTagEnd),
						},
						'TypeScript intellisense is disabled on template. To enable, configure `"jsx": "preserve"` in the `"compilerOptions"` property of tsconfig or jsconfig. To disable this prompt instead, configure `"experimentalDisableTemplateSupport": true` in `"vueCompilerOptions"` property.',
						vscode.DiagnosticSeverity.Information,
						undefined,
						'volar',
					);
					result.push(error);
				}

				const scriptRanges = vueDocument.file.getScriptRanges();
				if (sfc.script && scriptRanges?.exportDefault && vueDocument.file.refs.sfcScriptForScriptLs.codeGen.value.shimedComponentOptions && (options.vueCompilerOptions.experimentalShamefullySupportOptionsApi ?? 'warning') === 'warning') {
					const error = vscode.Diagnostic.create(
						{
							start: document.positionAt(sfc.script.startTagEnd + scriptRanges.exportDefault.expression.start),
							end: document.positionAt(sfc.script.startTagEnd + scriptRanges.exportDefault.expression.start),
						},
						'Component options are wrapped by `defineComponent()` internally to support intellisense on IDE for backward compatible, but this is an hacking which lead to this component type inconsistent with same script code on .js / .ts. Recommended wrap component options by `Vue.extends()` or `defineComponent()`. Or you can configure `"experimentalShamefullySupportOptionsApi": true / false` in `"vueCompilerOptions"` property in tsconfig / jsconfig to disable this warning.',
						vscode.DiagnosticSeverity.Warning,
						undefined,
						'volar',
					);
					result.push(error);
				}

				return result;
			});
		},

		findDocumentSymbols(document) {
			return worker(document, (vueDocument) => {

				const result: vscode.SymbolInformation[] = [];
				const descriptor = vueDocument.file.getDescriptor();

				if (descriptor.template) {
					result.push({
						name: 'template',
						kind: vscode.SymbolKind.Module,
						location: vscode.Location.create(document.uri, vscode.Range.create(
							document.positionAt(descriptor.template.startTagEnd),
							document.positionAt(descriptor.template.startTagEnd + descriptor.template.content.length),
						)),
					});
				}
				if (descriptor.script) {
					result.push({
						name: 'script',
						kind: vscode.SymbolKind.Module,
						location: vscode.Location.create(document.uri, vscode.Range.create(
							document.positionAt(descriptor.script.startTagEnd),
							document.positionAt(descriptor.script.startTagEnd + descriptor.script.content.length),
						)),
					});
				}
				if (descriptor.scriptSetup) {
					result.push({
						name: 'script setup',
						kind: vscode.SymbolKind.Module,
						location: vscode.Location.create(document.uri, vscode.Range.create(
							document.positionAt(descriptor.scriptSetup.startTagEnd),
							document.positionAt(descriptor.scriptSetup.startTagEnd + descriptor.scriptSetup.content.length),
						)),
					});
				}
				for (const style of descriptor.styles) {
					result.push({
						name: `${['style', style.scoped ? 'scoped' : undefined, style.module ? 'module' : undefined].filter(shared.notEmpty).join(' ')}`,
						kind: vscode.SymbolKind.Module,
						location: vscode.Location.create(document.uri, vscode.Range.create(
							document.positionAt(style.startTagEnd),
							document.positionAt(style.startTagEnd + style.content.length),
						)),
					});
				}
				for (const customBlock of descriptor.customBlocks) {
					result.push({
						name: `${customBlock.type}`,
						kind: vscode.SymbolKind.Module,
						location: vscode.Location.create(document.uri, vscode.Range.create(
							document.positionAt(customBlock.startTagEnd),
							document.positionAt(customBlock.startTagEnd + customBlock.content.length),
						)),
					});
				}

				return result;
			});
		},

		getFoldingRanges(document) {
			return worker(document, (vueDocument) => {

				const sfcWithEmptyBlocks = getSfcCodeWithEmptyBlocks(vueDocument, document.getText());
				const sfcWithEmptyBlocksDocument = TextDocument.create(document.uri, document.languageId, document.version, sfcWithEmptyBlocks);

				return htmlPlugin.htmlLs.getFoldingRanges(sfcWithEmptyBlocksDocument);
			});
		},

		getSelectionRanges(document, positions) {
			return worker(document, (vueDocument) => {

				const sfcWithEmptyBlocks = getSfcCodeWithEmptyBlocks(vueDocument, document.getText());
				const sfcWithEmptyBlocksDocument = TextDocument.create(document.uri, document.languageId, document.version, sfcWithEmptyBlocks);

				return htmlPlugin.htmlLs.getSelectionRanges(sfcWithEmptyBlocksDocument, positions);
			});
		},

		format: undefined,
	};

	function worker<T>(document: TextDocument, callback: (vueDocument: VueDocument) => T) {

		const vueDocument = options.getVueDocument(document);
		if (!vueDocument)
			return;

		return callback(vueDocument);
	}
}

function getSfcCodeWithEmptyBlocks(vueDocument: VueDocument, sfcCode: string) {

	const descriptor = vueDocument.file.getDescriptor();
	const blocks = [
		descriptor.template, // relate to below
		descriptor.script,
		descriptor.scriptSetup,
		...descriptor.styles,
		...descriptor.customBlocks,
	].filter(shared.notEmpty);

	// TODO: keep this for now and check why has this logic later
	// if (descriptor.template && descriptor.template.lang !== 'html') {
	//     blocks.push(descriptor.template);
	// }

	for (const block of blocks) {
		const content = sfcCode.substring(block.startTagEnd, block.startTagEnd + block.content.length);
		sfcCode = sfcCode.substring(0, block.startTagEnd)
			+ content.split('\n').map(line => ' '.repeat(line.length)).join('\n')
			+ sfcCode.substring(block.startTagEnd + block.content.length);
	}

	return sfcCode;
}
