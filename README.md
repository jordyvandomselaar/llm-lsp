# LLM LSP

A Language Server Protocol implementation for integrating Large Language Model capabilities into VS Code.

## Setup and Testing

1. Install dependencies:
   ```bash
   bun install
   ```

2. Build both packages:
   ```bash
   # Build LSP server
   cd packages/lsp
   bun run build
   
   # Build VS Code extension
   cd ../vscode-extension
   bun run build
   ```

3. Open VS Code in the extension directory:
   ```bash
   code packages/vscode-extension
   ```

4. Press F5 to launch a new VS Code window with the extension loaded.

5. Open a TypeScript/JavaScript file and type `#` to trigger the completion suggestions.

## Features

- Triggers on `#` character in TypeScript, JavaScript, TypeScript React, and JavaScript React files
- Currently provides placeholder completions (GitHub issues/PRs)
- Full LSP server-client communication via IPC

## Architecture

- **packages/lsp**: The Language Server implementation
- **packages/vscode-extension**: VS Code client extension
- Uses Bun for building and package management
- Turbo for monorepo orchestration