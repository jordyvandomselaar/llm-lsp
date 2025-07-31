import {
  createConnection,
  type InitializeResult,
  TextDocumentSyncKind,
  TextDocuments,
  ProposedFeatures,
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
        model: 'google/gemini-2.5-flash',
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

// Cache for recent completions to avoid duplicate API calls
const completionCache = new Map<string, { text: string; timestamp: number }>();
const CACHE_DURATION = 2000; // 2 seconds

// Handle inline completion requests
connection.onRequest('textDocument/inlineCompletion', async (params: { textDocument: { uri: string }, position: { line: number, character: number } }) => {
  connection.console.log('LSP Server: Inline completion requested for ' + params.textDocument.uri);
  
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    connection.console.log('LSP Server: Document not found');
    return { text: '' };
  }
  
  // Check cache first
  const cacheKey = `${params.textDocument.uri}:${params.position.line}:${params.position.character}`;
  const cached = completionCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return { text: cached.text };
  }
  
  // Parse the document to find incomplete lines
  const parseResult = await parser.parse(document);
  
  // Find the incomplete line at the cursor position
  const incompleteLine = parseResult.incompleteSuggestions.find(line => line.line === params.position.line);
  
  if (!incompleteLine) {
    return { text: '' };
  }
  
  const prompt = generatePromptForIncompleteLine(incompleteLine, document);
  
  connection.console.log(`LSP Server: Fetching suggestion for line ${incompleteLine.line} (${incompleteLine.type})`);
  
  const suggestion = await fetchOpenRouterCompletion(prompt);
  
  if (suggestion && !suggestion.startsWith('Error:')) {
    // Cache the result
    completionCache.set(cacheKey, { text: suggestion, timestamp: Date.now() });
    
    // Clean old cache entries
    for (const [key, value] of completionCache.entries()) {
      if (Date.now() - value.timestamp > CACHE_DURATION * 2) {
        completionCache.delete(key);
      }
    }
    
    connection.console.log(`LSP Server: Returning completion: ${suggestion}`);
    return { text: suggestion };
  }
  
  return { text: '' };
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


// Listen for text document changes to clear cache
documents.onDidChangeContent(async (change) => {
  connection.console.log('LSP Server: Document changed, clearing completion cache');
  // Clear cache entries for this document
  for (const key of completionCache.keys()) {
    if (key.startsWith(change.document.uri)) {
      completionCache.delete(key);
    }
  }
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();