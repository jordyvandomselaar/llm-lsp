import * as vscode from 'vscode';
import * as path from 'path';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient;
let lastSuggestionLine: number | undefined;

export async function activate(context: vscode.ExtensionContext) {
    // Create output channel immediately
    const outputChannel = vscode.window.createOutputChannel('LLM LSP');
    outputChannel.appendLine('[Activate] LLM LSP Extension is starting...');
    outputChannel.show();
    
    // Path to the server module
    const serverModule = context.asAbsolutePath(
        path.join('..', 'lsp', 'dist', 'index.cjs')
    );
    
    // The debug options for the server
    const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };
    
    // Server options
    const serverOptions: ServerOptions = {
        run: { 
            module: serverModule, 
            transport: TransportKind.ipc,
            options: {
                env: {
                    ...process.env,
                    OPENROUTER_API_KEY: vscode.workspace.getConfiguration('llmLsp').get('openRouterApiKey') || process.env.OPENROUTER_API_KEY
                }
            }
        },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: {
                ...debugOptions,
                env: {
                    ...process.env,
                    OPENROUTER_API_KEY: vscode.workspace.getConfiguration('llmLsp').get('openRouterApiKey') || process.env.OPENROUTER_API_KEY
                }
            }
        }
    };
    
    // Client options
    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: 'file', language: 'typescript' },
            { scheme: 'file', language: 'javascript' },
            { scheme: 'file', language: 'typescriptreact' },
            { scheme: 'file', language: 'javascriptreact' },
            { scheme: 'file', language: 'python' },
            { scheme: 'file', language: 'go' },
            { scheme: 'file', language: 'rust' },
            { scheme: 'file', language: 'java' },
            { scheme: 'file', language: 'cpp' },
            { scheme: 'file', language: 'c' },
            { scheme: 'file', language: 'csharp' },
            { scheme: 'file', language: 'ruby' },
            { scheme: 'file', language: 'php' },
            { scheme: 'file', language: 'swift' },
            { scheme: 'file', language: 'kotlin' }
        ],
        synchronize: {
            // Automatically sync all workspace settings
            configurationSection: 'llmLsp',
            // Notify server about file changes to supported files in workspace
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{ts,js,tsx,jsx,py,go,rs,java,cpp,c,cs,rb,php,swift,kt}')
        },
        outputChannel: outputChannel
    };
    
    // Create the language client and start it
    client = new LanguageClient(
        'llmLsp',
        'LLM Language Server',
        serverOptions,
        clientOptions
    );
    
    // Register the accept suggestion command before starting the client
    const acceptCommand = vscode.commands.registerCommand('llm-lsp.acceptSuggestion', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        
        const position = editor.selection.active;
        const line = position.line;
        
        // Request code actions at the current position
        const codeActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
            'vscode.executeCodeActionProvider',
            editor.document.uri,
            new vscode.Range(position, position)
        );
        
        if (codeActions && codeActions.length > 0) {
            // Find our accept suggestion action
            const acceptAction = codeActions.find(action => 
                action.command?.command === 'llm-lsp.acceptSuggestionInternal'
            );
            
            if (acceptAction && acceptAction.command?.arguments) {
                // Execute the LSP command directly
                await client.sendRequest('workspace/executeCommand', {
                    command: acceptAction.command.command,
                    arguments: acceptAction.command.arguments
                });
            }
        }
    });
    
    // Register the command first
    context.subscriptions.push(acceptCommand);
    
    // Start the client. This will also launch the server
    await client.start();
    
    // Push the client to subscriptions
    context.subscriptions.push(client);
    
    outputChannel.appendLine('[Activate] Language client started!');
    
    // Show popup to confirm activation
    vscode.window.showInformationMessage('LLM LSP Extension activated with language server!');
    
    // Listen for inlay hints to track where suggestions are
    // This helps us know when Tab should accept a suggestion
    const languages = [
        'typescript', 'javascript', 'typescriptreact', 'javascriptreact',
        'python', 'go', 'rust', 'java', 'cpp', 'c', 'csharp', 
        'ruby', 'php', 'swift', 'kotlin'
    ];
    
    const inlayHintsProvider = vscode.languages.registerInlayHintsProvider(
        languages.map(lang => ({ language: lang })),
        {
            provideInlayHints: () => {
                // We don't provide hints here, just track them from the LSP
                return [];
            }
        }
    );
    
    context.subscriptions.push(inlayHintsProvider);
    
    return {};
}

export async function deactivate(): Promise<void> {
    if (client) {
        await client.stop();
    }
}