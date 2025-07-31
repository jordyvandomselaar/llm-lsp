import * as vscode from 'vscode';
import * as path from 'path';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext) {
    // Create output channel immediately
    const outputChannel = vscode.window.createOutputChannel('LLM LSP');
    outputChannel.appendLine('[Activate] LLM LSP Extension is starting...');
    outputChannel.show();
    
    // Path to the server module
    const serverModule = context.asAbsolutePath(
        path.join('..', 'lsp', 'dist', 'index.js')
    );
    
    // The debug options for the server
    const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };
    
    // Server options
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: debugOptions
        }
    };
    
    // Client options
    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: 'file', language: 'typescript' },
            { scheme: 'file', language: 'javascript' },
            { scheme: 'file', language: 'typescriptreact' },
            { scheme: 'file', language: 'javascriptreact' }
        ],
        synchronize: {
            // Automatically sync all workspace settings
            configurationSection: 'llmLsp',
            // Notify server about file changes to .ts and .js files in workspace
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{ts,js,tsx,jsx}')
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
    
    // Start the client. This will also launch the server
    const disposable = client.start();
    
    // Push the disposable to the context's subscriptions
    context.subscriptions.push(disposable);
    
    outputChannel.appendLine('[Activate] Language client started!');
    
    // Show popup to confirm activation
    vscode.window.showInformationMessage('LLM LSP Extension activated with language server!');
    
    return {};
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}