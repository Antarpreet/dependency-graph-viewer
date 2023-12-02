// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as d3 from '../webview/d3.min.js';
import * as ts from 'typescript';
import fs from 'fs';
import { JSDOM } from 'jsdom';
import {
	API, Repository, Status, SVGNodeCategory
} from './models/models';
import path from 'path';

const defaultState: any = {
	graphHTML: '',
	imports: [],
	exports: [],
	classes: [],
	functions: [],
	filename: '',
	filePath: '',
	files: {},
	colors: {
		imports: '#c586b6',
		exports: '#c586b6',
		classes: '#56bb7f',
		functions: '#dcdcaa',
		file: '#d0824d',
		property: '#9cdcfe',
		git: {
			added: 'green',
			deleted: 'red',
			modified: 'yellow'
		}
	}
};

let state: any = JSON.parse(JSON.stringify(defaultState));

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('dependency-graph-viewer activated!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('dependency-graph-viewer.openDependencyGraph', async (file: vscode.Uri) => {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Opening dependency graph for ${file.path.split('/').pop()}`,
			cancellable: false
		}, async (progress) => {
			try {
				const workspaceFolders = vscode.workspace.workspaceFolders;
				if (workspaceFolders) {
					const workspaceFolder = workspaceFolders[0]; // Get the first workspace folder
					const pattern = new vscode.RelativePattern(workspaceFolder, '**/*.{js,jsx,ts,tsx}');
					const excludePattern = new vscode.RelativePattern(workspaceFolder, '**/node_modules/**'); // Exclude pattern for node_modules
					const files = await vscode.workspace.findFiles(pattern, excludePattern, 1000); // Adjust the maximum number of files as needed

					// Open all TypeScript files in the workspace
					await Promise.all(files.map(file => vscode.workspace.openTextDocument(file)));
				}

				await openFileDependencyGraph(context, file);
			} catch (error) {
				console.error(error);
			}
		});
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {
	console.log('dependency-graph-viewer deactivated!');
}

async function openFileDependencyGraph(context: vscode.ExtensionContext, file?: vscode.Uri) {
	try {
		// clear state
		state = {
			...JSON.parse(JSON.stringify(defaultState)),
			files: state.files,
			filePath: file?.fsPath
		};
		// get file content
		let content: Uint8Array;
		if (state.files[file.path]) {
			content = state.files[file.path];
		} else {
			content = await vscode.workspace.fs.readFile(file);
			state.files[file.path] = content;
		}
		const contentString = Buffer.from(content).toString();

		await parseFile(file, contentString);
		await addExportReferences(file, contentString);
		// parse filename from path
		state.filename = file.path.split('/').pop();

		await createWebView(context, file);
	} catch (error) {
		console.log(error);
	}
}

async function parseFile(file: vscode.Uri, contentString: string) {
	const document = await vscode.workspace.openTextDocument(file);
	const language = document.languageId;

	switch (language) {
		case 'typescript':
		case 'typescriptreact':
		case 'javascript':
		case 'javascriptreact':
			await parseJsTsFile(file, contentString);
			break;
		default:
			vscode.window.showWarningMessage('File type not supported');
			return;
	}

	// console.log('Imports:', state.imports);
	// console.log('Exports:', state.exports);
	// console.log('Classes:', state.classes);
	// console.log('Functions:', state.functions);
}

async function parseJsTsFile(file: vscode.Uri, contentString: string) {
	// Parse the contentString to a SourceFile object
	const sourceFile = ts.createSourceFile('temp.ts', contentString, ts.ScriptTarget.Latest, true);

	// Walk the AST (Abstract Syntax Tree)
	function visit(node: ts.Node) {
		if (ts.isImportDeclaration(node) || (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
			// if import declaration
			const moduleName = (node as any).moduleSpecifier?.getText(sourceFile).replace(/['"`]/g, '') ?? (node as any).arguments?.[0]?.getText(sourceFile).replace(/['"`]/g, '');
			const importedItems = (node as any).importClause?.namedBindings
				? (node as any).importClause.namedBindings.getText(sourceFile)
				: '*';
			// get the directory of the current file
			const fileDir = path.dirname(file.fsPath);

			// resolve the module name
			let absolutePath;
			try {
				absolutePath = require.resolve(path.resolve(fileDir, moduleName));
			} catch (error) {
				// If the module could not be resolved, try adding a .ts or .tsx extension
				if (fs.existsSync(path.resolve(fileDir, `${moduleName}.ts`))) {
					absolutePath = path.resolve(fileDir, `${moduleName}.ts`);
				} else if (fs.existsSync(path.resolve(fileDir, `${moduleName}.tsx`))) {
					absolutePath = path.resolve(fileDir, `${moduleName}.tsx`);
				} else if (fs.existsSync(path.resolve(fileDir, `${moduleName}/index.ts`))) {
					absolutePath = path.resolve(fileDir, `${moduleName}/index.ts`);
				} else {
					// If the file still could not be resolved, look for a node_modules directory
					let currentDir = fileDir;
					while (currentDir !== path.parse(currentDir).root) {
						if (fs.existsSync(path.resolve(currentDir, 'node_modules', `${moduleName}.d.ts`))) {
							absolutePath = path.resolve(currentDir, 'node_modules', `${moduleName}.d.ts`);
						} else if (fs.existsSync(path.resolve(currentDir, 'node_modules', `${moduleName}/dist/index.d.ts`))) {
							absolutePath = path.resolve(currentDir, 'node_modules', `${moduleName}/dist/index.d.ts`);
						} else if (fs.existsSync(path.resolve(currentDir, 'node_modules', `${moduleName}/lib/index.d.ts`))) {
							absolutePath = path.resolve(currentDir, 'node_modules', `${moduleName}/lib/index.d.ts`);
						} else if (fs.existsSync(path.resolve(currentDir, 'node_modules', `${moduleName}/index.d.ts`))) {
							absolutePath = path.resolve(currentDir, 'node_modules', `${moduleName}/index.d.ts`);
						} else if (fs.existsSync(path.resolve(currentDir, 'node_modules', `${moduleName}/src/index.ts`))) {
							absolutePath = path.resolve(currentDir, 'node_modules', `${moduleName}/src/index.ts`);
						} else if (fs.existsSync(path.resolve(currentDir, 'node_modules', `${moduleName}/src/index.tsx`))) {
							absolutePath = path.resolve(currentDir, 'node_modules', `${moduleName}/src/index.tsx`);
						} else if (fs.existsSync(path.resolve(currentDir, 'node_modules/@types', `${moduleName}.d.ts`))) {
							absolutePath = path.resolve(currentDir, 'node_modules/@types', `${moduleName}.d.ts`);
						} else if (fs.existsSync(path.resolve(currentDir, 'node_modules/@types', `${moduleName}/dist/index.d.ts`))) {
							absolutePath = path.resolve(currentDir, 'node_modules/@types', `${moduleName}/dist/index.d.ts`);
						} else if (fs.existsSync(path.resolve(currentDir, 'node_modules/@types', `${moduleName}/lib/index.d.ts`))) {
							absolutePath = path.resolve(currentDir, 'node_modules/@types', `${moduleName}/lib/index.d.ts`);
						} else if (fs.existsSync(path.resolve(currentDir, 'node_modules/@types', `${moduleName}/index.d.ts`))) {
							absolutePath = path.resolve(currentDir, 'node_modules/@types', `${moduleName}/index.d.ts`);
						}
						if (absolutePath) {
							break;
						}
						currentDir = path.dirname(currentDir); // go up one directory
					}

					if (!absolutePath) {
						console.log(`Could not resolve module: ${moduleName}`);
					}
				}
			}
			state.imports.push({ moduleName, importedItems, absolutePath });
		}
		if (ts.isExportDeclaration(node) || ts.isExportAssignment(node) || ((ts.getCombinedModifierFlags(node as any) & (ts.ModifierFlags.Export | ts.ModifierFlags.Default)) !== 0) ||
			(ts.isBinaryExpression(node) && ts.isPropertyAccessExpression(node.left) && node.left.expression.getText(sourceFile) === 'module' && node.left.name.getText(sourceFile) === 'exports')) {
			// if export declaration
			const exportName = (node as any).name?.getText(sourceFile);
			const exportBody = node.getText(sourceFile);
			if (exportName) {
				state.exports.push({ name: exportName, body: exportBody });
			}
		}
		if (ts.isClassDeclaration(node)) {
			// if class declaration
			const className = node.name?.getText(sourceFile);
			const classBody = node.members
				.filter(member => ts.isMethodDeclaration(member) || ts.isGetAccessor(member) || ts.isSetAccessor(member) || ts.isConstructorDeclaration(member) || (ts.isPropertyDeclaration(member) && member.initializer && ts.isArrowFunction(member.initializer)))
				.map(member => {
					const functionName = ts.isConstructorDeclaration(member) ? 'constructor' : member.name?.getText(sourceFile);
					const functionBody = (member as any).body?.getText(sourceFile);
					return { name: functionName, body: functionBody };
				});
			state.classes.push({ name: className, body: classBody });
		}
		if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
			// if function declaration, arrow function, or function expression
			const functionName = node.name?.getText(sourceFile);
			const functionBody = node.body?.getText(sourceFile);
			if (functionName) {
				state.functions.push({ name: functionName, body: functionBody });
			}
		} else if (ts.isVariableDeclaration(node) && ts.isFunctionLike(node.initializer)) {
			// if variable declaration where the initializer is a function or arrow function
			const functionName = node.name.getText(sourceFile);
			const functionBody = node.initializer.body?.getText(sourceFile);
			if (functionName) {
				state.functions.push({ name: functionName, body: functionBody });
			}
		}
		ts.forEachChild(node, visit);
	}

	visit(sourceFile);
}

async function createWebView(context: vscode.ExtensionContext, file?: vscode.Uri) {
	// create a new tab with the webview
	const panel = vscode.window.createWebviewPanel(
		'dependencyGraphViewer', // Identifies the type of the webview. Used internally
		`Dependency Graph Viewer (${state.filename})`, // Title of the panel displayed to the user
		vscode.ViewColumn.Active, // Editor column to show the new webview panel in.
		{ enableScripts: true } // Webview options
	);
	try {
		// get git repo if it exists, generate graph with it and add listener for changes
		const response = await getGitStatus();
		// if no git repo, generate graph without it
		if (!response) {
			generateFileGraph();
		}
	} catch (error) {
		console.log(error);
	}

	// set webview's HTML content
	panel.webview.html = getFileWebviewContent(file);
	// Handle messages from the webview
	panel.webview.onDidReceiveMessage(
		message => {
			switch (message.command) {
				case 'alert':
					vscode.window.showInformationMessage(message.text);
					return;
				case 'openDescriptionPanel':
					openDescriptionPanel(message.data);
					return;
			}
		},
		undefined,
		context.subscriptions
	);
}

function getFileWebviewContent(file?: vscode.Uri) {

	return `<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8">
		<title>Dependency Graph Viewer</title>
		<style>
			.square {
				width: 15px;
				height: 15px;
			}
			.circle {
				width: 10px;
				height: 10px;
				border-radius: 50%;
			}
			.item {
				display: flex;
				align-items: center;
				justify-content: space-between;
				flex-direction: row;
				color: white;
				font-size: 12px;
				margin-bottom: 10px;
			}
			.container {
				width: 200px;
				position: absolute;
			}
			.label {
				flex-grow: 1;
				margin-left: 10px;
			}
		</style>
	</head>
	<body>
		<h1>Dependency Graph</h1>
		<div class="container">
			<div class="item">
				<div class="square" style="background-color: ${state.colors.imports}"></div>
				<span class="label">Import/Export</span>
			</div>
			<div class="item">
				<div class="square" style="background-color: ${state.colors.classes}"></div>
				<span class="label">Class</span>
			</div>
			<div class="item">
				<div class="square" style="background-color: ${state.colors.functions}"></div>
				<span class="label">Function</span>
			</div>
			<div class="item">
				<div class="square" style="background-color: ${state.colors.file}"></div>
				<span class="label">File</span>
			</div>
			<div class="item">
				<div class="square" style="background-color: ${state.colors.property}"></div>
				<span class="label">Property</span>
			</div>
			<div class="item">
				<div class="circle" style="background-color: ${state.colors.git.added}"></div>
				<span class="label">Git Added</span>
			</div>
			<div class="item">
				<div class="circle" style="background-color: ${state.colors.git.deleted}"></div>
				<span class="label">Git Deleted</span>
			</div>
			<div class="item">
				<div class="circle" style="background-color: ${state.colors.git.modified}"></div>
				<span class="label">Git Modified</span>
			</div>
		</div>
		${state.graphHTML}
		<script>
			const vscode = acquireVsCodeApi();

			const items = [...document.querySelectorAll('rect'), ...document.querySelectorAll('text')];
			for (let index = 0; index < items.length; index++) {
				items[index].addEventListener('click', function() {
					const metadata = JSON.parse(this.dataset.metadata); // access the metadata
	
					vscode.postMessage({
						command: 'openDescriptionPanel',
						data: metadata
					});
				});
			}
		</script>
	</body>
	</html>`;
}

async function getGitStatus() {
	// Get the Git extension
	const gitExtension = vscode.extensions.getExtension('vscode.git');
	if (!gitExtension) {
		vscode.window.showWarningMessage('Cannot find the Git extension (Enable Git extension to load git status on files in the graph)');
		return false;
	}

	// Make sure the extension is activated
	const git = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
	if (!git) {
		vscode.window.showWarningMessage('Cannot activate the Git extension (Enable Git extension to load git status on files in the graph)');
		return false;
	}

	// Get the API
	const api = git.getAPI(1) as API;
	if (!api) {
		vscode.window.showWarningMessage('Cannot get the Git API (Enable Git extension to load git status on files in the graph)');
		return false;
	}

	// Get the repositories
	const repositories = api.repositories;
	if (!repositories.length) {
		vscode.window.showWarningMessage('No Git repositories found (Enable Git in the folder to load git status on files in the graph)');
		return false;
	}

	// Get the working tree changes of the first repository
	const repository = repositories[0];

	// Generate graph on load
	generateFileGraph(repository);
	// add listener for changes to the repository to regenerate the graph
	repository?.state?.onDidChange(() => {
		generateFileGraph(repository);
	});

	return true;
}

function generateFileGraph(repository?: Repository) {
	// create a new tree layout
	// console.log('repository', repository);
	const root = d3.hierarchy({
		name: state.filename,
		badge: true,
		path: state.filePath,
		category: SVGNodeCategory.root,
		children: [
			{
				name: 'imports',
				category: SVGNodeCategory.category,
				fillColor: state.colors.imports,
				children: state.imports.map((item: any) => {
					return {
						name: item.moduleName,
						category: SVGNodeCategory.file,
						fillColor: state.colors.file,
						path: item.absolutePath,
						badge: true,
						children: item.importedItems === '*' ? [] : item.importedItems.replace(/[{} ]/g, '').split(',').filter(i => i.trim().length > 0).map((name: string) => {
							return {
								name: name.trim(),
								path: item.absolutePath, // fix this to go to position by adding range from references for each import and filtering by moduleName
								category: SVGNodeCategory.property,
								fillColor: state.colors.property
							};
						})
					};
				})
			},
			{
				name: 'exports',
				category: SVGNodeCategory.category,
				fillColor: state.colors.exports,
				children: state.exports.map((item: any) => {
					const groupedReferences = item.references as Map<string, vscode.Location[]>;
					return {
						name: item.name,
						body: item.body,
						category: SVGNodeCategory.property,
						fillColor: state.colors.exports,
						children: Array.from(groupedReferences.keys())?.map((key: string) => {
							const references = groupedReferences.get(key);
							return {
								name: `${key.split('\\').pop()} (${references.length})`,
								badge: true,
								path: key,
								category: SVGNodeCategory.file,
								fillColor: state.colors.file,
								references
							};
						}) || []
					};
				})
			},
			{
				name: 'classes',
				category: SVGNodeCategory.category,
				fillColor: state.colors.classes,
				children: state.classes.map((item: any) => {
					return {
						name: item.name,
						category: SVGNodeCategory.class,
						fillColor: state.colors.classes,
						children: item.body.map((method: any) => {
							return {
								name: method.name,
								category: SVGNodeCategory.function,
								fillColor: state.colors.functions,
								body: method.body
							};
						})
					};
				})
			},
			{
				name: 'functions',
				category: SVGNodeCategory.category,
				fillColor: state.colors.functions,
				children: state.functions.map((item: any) => {
					return {
						name: item.name,
						category: SVGNodeCategory.function,
						fillColor: state.colors.functions,
						body: item.body
					};
				})
			}
		]
	});
	// calculate the total number of nodes
	const totalNodes = root.descendants().length;
	// set the size of the layout and SVG based on the total number of nodes
	const treeSize = totalNodes * 20; // adjust the factor as needed
	const svgSize = treeSize + 400; // add some padding
	const treeLayout = d3.tree().size([treeSize, treeSize]);

	treeLayout(root);

	// create a new JSDOM instance
	const dom = new JSDOM();
	const svg = d3.select(dom.window.document.body).append('svg').attr('width', svgSize).attr('height', svgSize);
	const g = svg.append('g').attr('transform', 'translate(50,50)');

	// create links
	const linkGenerator = d => `M${d.source.y},${d.source.x} L${d.target.y},${d.target.x}`;
	g.selectAll('path')
		.data(root.links())
		.enter()
		.append('path')
		.attr('d', linkGenerator)
		.attr('fill', 'none')
		.attr('stroke', 'black')
		.attr('stroke-width', 2);

	// create nodes
	const nodes = g.selectAll('rect')
		.data(root.descendants())
		.enter()
		.append('g')
		.attr('transform', d => `translate(${d.y},${d.x})`)
		.style('cursor', 'pointer');

	nodes.append('rect')
		.attr('width', d => d.data.name.length * 7 + 10)
		.attr('height', 20)
		.attr('rx', 5)
		.attr('ry', 5)
		.attr('x', -5)
		.attr('y', -10)
		.attr('fill', d => d.data.fillColor || 'white')
		.attr('data-metadata', d => JSON.stringify(d.data)); // add metadata as a data-* attribute

	nodes.append('text')
		.attr('dy', 5)
		.attr('fill', 'black')
		.attr('data-metadata', d => JSON.stringify(d.data)) // add metadata as a data-* attribute
		.text(d => d.data.name);

	// add a badge to the top-right of the node
	nodes.append('circle')
		.attr('cx', d => d.data.name.length * 7 + 10)
		.attr('cy', -10)
		.attr('r', 5)
		.attr('fill', d => {
			if (!d.data.badge) {
				return 'rgba(0,0,0,0)';
			}
			const fileName = d.data.name.replace(/'/g, '').replace(/\.\//g, '').split(' ')[0];
			const fileStatus = repository?.state.workingTreeChanges.find(i => i.uri.path.includes(fileName));

			switch (fileStatus?.status) {
				case Status.ADDED_BY_THEM:
				case Status.ADDED_BY_US:
				case Status.BOTH_ADDED:
				case Status.UNTRACKED:
				case Status.INDEX_ADDED:
				case Status.INTENT_TO_ADD:
					return state.colors.git.added;
				case Status.DELETED_BY_THEM:
				case Status.DELETED_BY_US:
				case Status.BOTH_DELETED:
				case Status.DELETED:
				case Status.INDEX_DELETED:
					return state.colors.git.deleted;
				case Status.MODIFIED:
				case Status.BOTH_MODIFIED:
				case Status.INDEX_MODIFIED:
				case Status.INDEX_MODIFIED:
				case Status.INDEX_RENAMED:
				case Status.INDEX_COPIED:
					return state.colors.git.modified;
				case Status.IGNORED:
				default:
					return 'rgba(0,0,0,0)';
			}
		});

	// assign the HTML content of the body to state.graphHTML
	state.graphHTML = dom.window.document.body.innerHTML;
}

async function openDescriptionPanel(d: any) {
	// console.log(d);
	switch (d.category) {
		case SVGNodeCategory.class:
		case SVGNodeCategory.file:
		case SVGNodeCategory.root:
			const path = d.path || d.uri?.path;
			if (path) {
				const uri = vscode.Uri.file(path);

				const start = new vscode.Position(d.range?.[0]?.line ?? 0, d.range?.[0]?.character ?? 0);
				const end = new vscode.Position(d.range?.[1]?.line ?? 0, d.range?.[1]?.character ?? 0);
				const selection = new vscode.Selection(start, end);

				vscode.workspace.openTextDocument(uri).then(document => {
					vscode.window.showTextDocument(document, {
						selection
					});
				});
			}
			break;
		case SVGNodeCategory.function:
		case SVGNodeCategory.property:
		case SVGNodeCategory.reference:
		case SVGNodeCategory.category:
		default:
			break;
	}
	// // create a new webview panel
	// const panel = vscode.window.createWebviewPanel(
	// 	'nodeDescription', // viewType
	// 	`Description of ${d.name}`, // title
	// 	vscode.ViewColumn.Beside, // show in new column
	// 	{} // options
	// );

	// // set the HTML content of the webview panel
	// panel.webview.html = `
	// 	<html>
	// 	<body>
	// 		<h1>${d.name}</h1>
	// 	</body>
	// 	</html>
	// `;
}

async function addExportReferences(file: vscode.Uri, contentString: string) {
	for (const item of state.exports) {
		const lines = contentString.split(/\r?\n/);
		const lineIndex = item.name ? lines.findIndex(i => i.includes(item.name) && i.includes('export')) : -1;
		const start = new vscode.Position(lineIndex, lines[lineIndex].indexOf(item.name));
		const end = new vscode.Position(lineIndex, lines[lineIndex].indexOf(item.name) + item.name.length);
		// const selection = new vscode.Selection(start, end);
		// editor.selection = selection;
		// console.log(`Start position: Line ${start.line + 1}, Character ${start.character + 1}`);
		// console.log(`End position: Line ${end.line + 1}, Character ${end.character + 1}`);

		const uri = vscode.Uri.file(file.path);
		const position = new vscode.Position(start.line, start.character);
		item.references = await findReferences(uri, position);
	}
}

async function findReferences(uri: vscode.Uri, position: vscode.Position) {
    const document = await vscode.workspace.openTextDocument(uri);
    const references = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        document.uri,
        position
    );

    const groupedReferences = new Map<string, vscode.Location[]>();
    for (const reference of references) {
        const fileUri = reference.uri.fsPath.toString();
        const fileReferences = groupedReferences.get(fileUri) || [];
        fileReferences.push(reference);
        groupedReferences.set(fileUri, fileReferences);
    }

    // console.log('groupedReferences', groupedReferences);
    return groupedReferences;
}
