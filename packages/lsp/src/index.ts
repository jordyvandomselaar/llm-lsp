import {
  createConnection,
  type InitializeResult,
  TextDocumentSyncKind,
  TextDocuments,
  type InlayHint,
  InlayHintKind,
  type InlayHintParams,
  ProposedFeatures,
  type CodeAction,
  type CodeActionParams,
  CodeActionKind,
  type ExecuteCommandParams,
  type WorkspaceEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import fetch from "node-fetch";
import { TreeSitterParser, type IncompleteLine } from "./parser";

// Create connection with all proposed features
const connection = createConnection(ProposedFeatures.all);

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Get API key from environment variable
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Initialize parser
const parser = new TreeSitterParser();

connection.onInitialize(async () => {
  connection.console.log('LSP Server: Initialized');
  
  if (!OPENROUTER_API_KEY) {
    connection.console.warn('LSP Server: OPENROUTER_API_KEY not set. Completions will not work.');
  }
  
  // Initialize parser
  await parser.initialize();
  
  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that the server supports inlay hints
      inlayHintProvider: {
        resolveProvider: false,
      },
      // Support code actions
      codeActionProvider: true,
      // Support execute command
      executeCommandProvider: {
        commands: ['llm-lsp.acceptSuggestionInternal']
      },
    },
  };

  return result;
});

connection.onInitialized(() => {
  connection.console.log('LSP Server: Connection initialized');
});

async function fetchOpenRouterCompletion(prompt: string): Promise<string> {
  if (!OPENROUTER_API_KEY) {
    return "Please set OPENROUTER_API_KEY environment variable";
  }
  
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/llm-lsp',
        'X-Title': 'LLM LSP',
      },
      body: JSON.stringify({
        model: 'openai/gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a code completion assistant. Provide a single, concise code completion or suggestion. Output only the code that should be inserted, no explanations or markdown. Be contextually aware and provide completions that fit naturally with the existing code style.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 150,
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      connection.console.error(`LSP Server: OpenRouter API error: ${response.status} - ${error}`);
      return `Error: ${response.status}`;
    }
    
    const data = await response.json() as any;
    const completionText = data.choices?.[0]?.message?.content || '';
    return completionText.trim();
      
  } catch (error) {
    connection.console.error(`LSP Server: Error fetching completion: ${error}`);
    return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

// Store inlay hints by document URI
const inlayHintsCache = new Map<string, InlayHint[]>();

// Store suggestions by document URI and line number
const suggestionsCache = new Map<string, Map<number, string>>();

// Register inlay hint provider
connection.languages.inlayHint.on(async (params: InlayHintParams): Promise<InlayHint[]> => {
  connection.console.log('LSP Server: Inlay hints requested for ' + params.textDocument.uri);
  
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    connection.console.log('LSP Server: Document not found');
    return [];
  }
  
  // Parse the document to find incomplete lines
  const parseResult = await parser.parse(document);
  const hints: InlayHint[] = [];
  
  // Process each incomplete line
  for (const incompleteLine of parseResult.incompleteSuggestions) {
    const prompt = generatePromptForIncompleteLine(incompleteLine, document);
    
    connection.console.log(`LSP Server: Fetching suggestion for line ${incompleteLine.line} (${incompleteLine.type})`);
    
    const suggestion = await fetchOpenRouterCompletion(prompt);
    
    if (suggestion && !suggestion.startsWith('Error:')) {
      // Store the suggestion for code actions
      if (!suggestionsCache.has(params.textDocument.uri)) {
        suggestionsCache.set(params.textDocument.uri, new Map());
      }
      suggestionsCache.get(params.textDocument.uri)!.set(incompleteLine.line, suggestion);
      
      // Get the actual line text to find the correct end position
      const lineText = document.getText({
        start: { line: incompleteLine.line, character: 0 },
        end: { line: incompleteLine.line + 1, character: 0 }
      }).trimEnd();
      
      // Place the inlay hint at the end of the line
      const position = {
        line: incompleteLine.line,
        character: lineText.length
      };
      
      const hint: InlayHint = {
        position: position,
        label: ` → ${suggestion}`,
        kind: InlayHintKind.Type,
        paddingLeft: true,
      };
      
      hints.push(hint);
      connection.console.log(`LSP Server: Added hint at line ${incompleteLine.line}: ${suggestion}`);
    }
  }
  
  connection.console.log(`LSP Server: Returning ${hints.length} hints`);
  
  // Cache the hints
  inlayHintsCache.set(params.textDocument.uri, hints);
  
  return hints;
});

function generatePromptForIncompleteLine(incompleteLine: IncompleteLine, document: TextDocument): string {
  const languageId = document.languageId;
  const context = incompleteLine.context;
  
  switch (incompleteLine.type) {
    case 'prompt':
      return `Given this ${languageId} code context:
\`\`\`${languageId}
${context}
\`\`\`

Provide a code suggestion for: "${incompleteLine.prompt}"`;

    case 'function_declaration':
      return `Given this ${languageId} code context:
\`\`\`${languageId}
${context}
\`\`\`

Complete this function declaration with an appropriate implementation. Current line: "${incompleteLine.content.trim()}"`;

    case 'control_flow':
      return `Given this ${languageId} code context:
\`\`\`${languageId}
${context}
\`\`\`

Complete this control flow statement. Current line: "${incompleteLine.content.trim()}"`;

    case 'assignment':
      return `Given this ${languageId} code context:
\`\`\`${languageId}
${context}
\`\`\`

Complete this assignment with an appropriate value. Current line: "${incompleteLine.content.trim()}"`;

    case 'block_start':
      return `Given this ${languageId} code context:
\`\`\`${languageId}
${context}
\`\`\`

Provide the appropriate content for this block. Current line: "${incompleteLine.content.trim()}"`;

    case 'empty_body':
      return `Given this ${languageId} code context:
\`\`\`${languageId}
${context}
\`\`\`

Provide appropriate content for this empty class/interface body. Current line: "${incompleteLine.content.trim()}"`;

    case 'todo_comment':
      return `Given this ${languageId} code context:
\`\`\`${languageId}
${context}
\`\`\`

Implement what this TODO comment is asking for: "${incompleteLine.content.trim()}"`;

    default:
      return `Given this ${languageId} code context:
\`\`\`${languageId}
${context}
\`\`\`

Complete the following line of code: "${incompleteLine.content.trim()}"`;
  }
}

// Code action provider
connection.onCodeAction((params: CodeActionParams): CodeAction[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }
  
  const actions: CodeAction[] = [];
  const suggestions = suggestionsCache.get(params.textDocument.uri);
  
  if (suggestions) {
    // Check if the cursor is on a line with a suggestion
    for (const lineNumber of suggestions.keys()) {
      if (lineNumber >= params.range.start.line && lineNumber <= params.range.end.line) {
        const suggestion = suggestions.get(lineNumber)!;
        
        const action: CodeAction = {
          title: `Accept AI suggestion: ${suggestion.substring(0, 50)}...`,
          kind: CodeActionKind.QuickFix,
          command: {
            title: 'Accept Suggestion',
            command: 'llm-lsp.acceptSuggestionInternal',
            arguments: [params.textDocument.uri, lineNumber, suggestion]
          }
        };
        
        actions.push(action);
      }
    }
  }
  
  return actions;
});

// Execute command handler
connection.onExecuteCommand(async (params: ExecuteCommandParams) => {
  if (params.command === 'llm-lsp.acceptSuggestionInternal' && params.arguments) {
    const [uri, lineNumber, suggestion] = params.arguments as [string, number, string];
    const document = documents.get(uri);
    
    if (document) {
      // Get the current line
      const line = document.getText({
        start: { line: lineNumber, character: 0 },
        end: { line: lineNumber + 1, character: 0 }
      });
      
      // Determine where to insert the suggestion
      let replaceRange: { start: number, end: number };
      
      if (line.includes('#')) {
        // For # prompts, replace from # to end of line
        const hashIndex = line.indexOf('#');
        replaceRange = { start: hashIndex, end: line.trimEnd().length };
      } else {
        // For regular lines, append at the end of meaningful content
        const trimmedLength = line.trimEnd().length;
        replaceRange = { start: trimmedLength, end: trimmedLength };
      }
      
      const edit: WorkspaceEdit = {
        changes: {
          [uri]: [{
            range: {
              start: { line: lineNumber, character: replaceRange.start },
              end: { line: lineNumber, character: replaceRange.end }
            },
            newText: line.includes('#') ? suggestion : ' ' + suggestion
          }]
        }
      };
        
      await connection.workspace.applyEdit(edit);
      connection.console.log('LSP Server: Applied suggestion');
      
      // Remove the suggestion from cache
      const suggestions = suggestionsCache.get(uri);
      if (suggestions) {
        suggestions.delete(lineNumber);
      }
    }
  }
});

// Listen for text document changes to refresh inlay hints
documents.onDidChangeContent(async (change) => {
  connection.console.log('LSP Server: Document changed, refreshing inlay hints');
  // Clear caches for this document
  inlayHintsCache.delete(change.document.uri);
  suggestionsCache.delete(change.document.uri);
  
  // Request the client to refresh inlay hints
  try {
    await connection.languages.inlayHint.refresh();
  } catch (error) {
    connection.console.error(`LSP Server: Error refreshing inlay hints: ${error}`);
  }
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();