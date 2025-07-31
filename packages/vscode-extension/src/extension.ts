import * as vscode from 'vscode';
import * as path from 'path';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient;
let lastCompletionTime = Date.now();
let completionRequestCounter = 0;

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
    
    // Start the client. This will also launch the server
    await client.start();
    
    // Push the client to subscriptions
    context.subscriptions.push(client);
    
    outputChannel.appendLine('[Activate] Language client started!');
    
    // Show popup to confirm activation  
    vscode.window.showInformationMessage('LLM LSP Extension activated with inline completions!');
    
    // Check if inline suggestions are enabled
    const editorConfig = vscode.workspace.getConfiguration('editor');
    if (!editorConfig.get('inlineSuggest.enabled')) {
        vscode.window.showWarningMessage('Inline suggestions are disabled. Enable "editor.inlineSuggest.enabled" in settings to see completions.');
    }
    
    // Register inline completion provider
    const inlineCompletionProvider = vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**' },
        {
            provideInlineCompletionItems: async (document: vscode.TextDocument, position: vscode.Position, _context: vscode.InlineCompletionContext) => {
                const lineText = document.lineAt(position.line).text;
                const textBeforeCursor = lineText.substring(0, position.character);
                
                outputChannel.appendLine(`[Debug] Inline completion requested at ${position.line}:${position.character}, line text: "${lineText}", before cursor: "${textBeforeCursor}"`);
                
                // Skip if we're in the middle of a word (unless it's after #)
                if (!textBeforeCursor.includes('#') && position.character > 0) {
                    const charBefore = textBeforeCursor[position.character - 1];
                    if (/\w/.test(charBefore) && position.character < lineText.length && /\w/.test(lineText[position.character])) {
                        outputChannel.appendLine(`[Debug] Skipping - in middle of word`);
                        return [];
                    }
                }
                
                // Get max completions per second from config (default to 2)
                const maxCompletionsPerSecond = vscode.workspace.getConfiguration('llmLsp').get('maxCompletionsPerSecond', 2);
                
                // Debouncing logic
                completionRequestCounter += 1;
                const localCompletionRequestCounter = completionRequestCounter;
                
                const timeSinceLastCompletion = Date.now() - lastCompletionTime;
                const minTimeBetweenCompletions = 1000 / maxCompletionsPerSecond;
                
                if (timeSinceLastCompletion < minTimeBetweenCompletions) {
                    const waitTime = minTimeBetweenCompletions - timeSinceLastCompletion;
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    
                    // Check if a newer request has come in
                    if (completionRequestCounter !== localCompletionRequestCounter) {
                        return [];
                    }
                }
                
                lastCompletionTime = Date.now();
                
                try {
                    outputChannel.appendLine(`[Debug] Sending request to LSP server...`);
                    
                    // Request completion from LSP server
                    const result = await client.sendRequest('textDocument/inlineCompletion', {
                        textDocument: { uri: document.uri.toString() },
                        position: position
                    }) as any;
                    
                    outputChannel.appendLine(`[Debug] LSP response: ${JSON.stringify(result)}`);
                    
                    if (result && result.text && result.text.trim()) {
                        outputChannel.appendLine(`[Debug] Creating inline completion at ${position.line}:${position.character} with text: "${result.text}"`);
                        
                        // Get the current line up to cursor
                        const line = document.lineAt(position.line);
                        const lineText = line.text.substring(0, position.character);
                        
                        // If the line has a # prompt, we should replace from # onwards
                        let insertText = result.text;
                        let range = new vscode.Range(position, position);
                        
                        if (lineText.includes('#')) {
                            const hashIndex = lineText.indexOf('#');
                            range = new vscode.Range(
                                new vscode.Position(position.line, hashIndex),
                                position
                            );
                            insertText = result.text;
                        }
                        
                        // Create inline completion item
                        const item = new vscode.InlineCompletionItem(
                            insertText,
                            range
                        );
                        
                        outputChannel.appendLine(`[Debug] Returning inline completion item with range ${range.start.line}:${range.start.character} to ${range.end.line}:${range.end.character}`);
                        return [item];
                    } else {
                        outputChannel.appendLine(`[Debug] No text in result or text is empty`);
                    }
                } catch (error) {
                    outputChannel.appendLine(`[Error] Inline completion failed: ${error}`);
                }
                
                return [];
            }
        }
    );
    
    context.subscriptions.push(inlineCompletionProvider);
    
    // Register manual trigger command for testing
    const triggerCommand = vscode.commands.registerCommand('llm-lsp.triggerInlineCompletion', async () => {
        outputChannel.appendLine('[Command] Manual inline completion trigger');
        await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
    });
    context.subscriptions.push(triggerCommand);
    
    return {};
}

export async function deactivate(): Promise<void> {
    if (client) {
        await client.stop();
    }
}