import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    // Create output channel immediately
    const outputChannel = vscode.window.createOutputChannel('LLM LSP');
    outputChannel.appendLine('[Activate] LLM LSP Extension is starting...');
    outputChannel.show();
    
    // Show popup to confirm activation
    vscode.window.showInformationMessage('LLM LSP Extension activated!');
    
    // Register the output channel
    context.subscriptions.push(outputChannel);
    
    outputChannel.appendLine('[Activate] Extension activation complete!');
    
    // Return an API object (even if empty) to signal successful activation
    return {};
}

export function deactivate() {
    // Nothing to do for now
}