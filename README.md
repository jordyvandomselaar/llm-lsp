# LLM LSP

A Language Server Protocol implementation for integrating Large Language Model capabilities into VS Code.

## Setup and Testing

1. Install dependencies:
   ```bash
   bun install
   ```

2. Set up your OpenRouter API key:
   - Get an API key from [OpenRouter](https://openrouter.ai/keys)
   - Either:
     - Set it as an environment variable: `export OPENROUTER_API_KEY=your_key_here`
     - Or configure it in VS Code settings after installing the extension

3. Build both packages:
   ```bash
   bun run build
   ```

4. Open VS Code in the extension directory:
   ```bash
   code packages/vscode-extension
   ```

5. Press F5 to launch a new VS Code window with the extension loaded.

6. Open a TypeScript/JavaScript file and type `#` followed by a prompt (e.g., `# calculate fibonacci`) to see AI-powered suggestions as inlay hints.

7. To accept a suggestion:
   - Simply press `Tab` when your cursor is on a line with a suggestion
   - The `#prompt` will be replaced with the AI-generated code
   - Works just like GitHub Copilot!

## Features

- **Multi-Language Support**: Works with TypeScript, JavaScript, Python, Go, Rust, Java, C/C++, C#, Ruby, PHP, Swift, Kotlin, and more!
- **Smart Auto-suggestions**: Automatically suggests completions for:
  - Incomplete function/class declarations
  - Lines ending with `{`, `(`, or `=`
  - If/for/while statements without bodies
  - TODO/FIXME comments
  - Any line with `#` followed by a natural language prompt
- **Copilot-like Experience**: Just press Tab to accept suggestions
- **Language-Aware**: Provides context-specific suggestions based on the programming language
- Shows AI suggestions as inline hints (inlay hints)
- Automatically refreshes hints when you edit the document
- Fetches intelligent code suggestions from OpenRouter AI
- Configurable API key through VS Code settings or environment variables
- Full LSP server-client communication via IPC

## Configuration

In VS Code settings (Cmd/Ctrl + ,), search for "LLM LSP" to find:
- `llmLsp.enable`: Enable/disable the extension
- `llmLsp.openRouterApiKey`: Your OpenRouter API key
- `llmLsp.trace.server`: Debug tracing level

## Architecture

- **packages/lsp**: The Language Server implementation with OpenRouter integration
- **packages/vscode-extension**: VS Code client extension
- Uses Bun for building and package management
- Turbo for monorepo orchestration