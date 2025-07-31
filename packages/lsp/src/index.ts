import {
  createConnection,
  type InitializeResult,
  TextDocumentSyncKind,
  TextDocuments,
  ProposedFeatures,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import fetch from "node-fetch";
import { TreeSitterParser } from "./parser";

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
        model: 'moonshotai/kimi-k2',
        provider: {
          sort: 'latency',
        },
        messages: [
          {
            role: 'system',
            content: 'You are a code completion assistant. The user will provide code context with the current line marked as >>> line <<<. Complete the code at that position. Output only the code that should be inserted, no explanations or markdown. Match the indentation and coding style of the surrounding code.'
          },
          // Few-shot examples to guide the model
          {
            role: 'user',
            content: 'Given this python code context (current line marked with >>><<<):\n```python\ndef greet(name):\n    >>> print(f"Hello, {") <<<\n```\nComplete the code at the line marked with >>><<<. Provide only the code to insert, matching the existing style and indentation.'
          },
          {
            role: 'assistant',
            content: 'name}")'
          },
          {
            role: 'user',
            content: 'Given this javascript code context (current line marked with >>><<<):\n```javascript\nfunction sum(a, b) {\n    >>> return a +  <<<\n}\n```\nComplete the code at the line marked with >>><<<. Provide only the code to insert, matching the existing style and indentation.'
          },
          {
            role: 'assistant',
            content: 'b;'
          },
          {
            role: 'user',
            content: 'Given this python code context (current line marked with >>><<<):\n```python\n>>> #  <<<\ndef add(a, b):\n    return a + b\n```\nComplete the code at the line marked with >>><<<. Provide only the code to insert, matching the existing style and indentation.'
          },
          {
            role: 'assistant',
            content: 'Adds two numbers'
          },
          {
            role: 'user',
            content: 'Given this python code context (current line marked with >>><<<):\n```python\n# This function checks if a number is even\n>>>  <<<\n```\nComplete the code at the line marked with >>><<<. Provide only the code to insert, matching the existing style and indentation.'
          },
          {
            role: 'assistant',
            content: 'def is_even(n):\n    return n % 2 == 0'
          },
          {
            role: 'user',
            content: 'Given this javascript code context (current line marked with >>><<<):\n```javascript\nfunction bubbleSort() {\n    >>>      <<<\n}\n```\nComplete the code at the line marked with >>><<<. Provide only the code to insert, matching the existing style and indentation.'
          },
          {
            role: 'assistant',
            content: '// Implementation of bubble sort algorithm\n    for (let i = 0; i < arr.length - 1; i++) {\n        for (let j = 0; j < arr.length - i - 1; j++) {\n            if (arr[j] > arr[j + 1]) {\n                // Swap elements\n                let temp = arr[j];\n                arr[j] = arr[j + 1];\n                arr[j + 1] = temp;\n            }\n        }\n    }\n    return arr;'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7
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
    connection.console.log('LSP Server: Returning cached completion');
    return { text: cached.text };
  }
  
  // Use Tree-sitter to check if we should provide a completion
  const parseResult = await parser.parseForCompletion(document, params.position);
  
  if (!parseResult.shouldSuggest) {
    connection.console.log('LSP Server: Skipping completion - code appears complete');
    connection.console.log(`LSP Server: Position ${params.position.line}:${params.position.character}`);
    return { text: '' };
  }
  
  connection.console.log('LSP Server: Code is incomplete, generating completion');
  
  // Generate prompt with extended context
  const prompt = generatePromptForPosition(document, params.position);
  
  connection.console.log(`LSP Server: Sending ${prompt.length} characters of context to LLM`);
  
  const suggestion = await fetchOpenRouterCompletion(prompt);
  
  if (suggestion && !suggestion.startsWith('Error:')) {
    // Process the suggestion to ensure proper formatting and alignment
    const processedSuggestion = await processCompletion(suggestion, document, params.position);
    
    // Cache the result
    completionCache.set(cacheKey, { text: processedSuggestion, timestamp: Date.now() });
    
    // Clean old cache entries
    for (const [key, value] of completionCache.entries()) {
      if (Date.now() - value.timestamp > CACHE_DURATION * 2) {
        completionCache.delete(key);
      }
    }
    
    connection.console.log(`LSP Server: Returning completion: ${processedSuggestion}`);
    return { text: processedSuggestion };
  }
  
  return { text: '' };
});

function generatePromptForPosition(document: TextDocument, position: { line: number, character: number }): string {
  const languageId = document.languageId;
  
  // Get extended context - 250 lines before and after (total ~500 lines)
  const totalLines = document.lineCount;
  const currentLine = position.line;
  
  // Calculate range for context
  const startLine = Math.max(0, currentLine - 250);
  const endLine = Math.min(totalLines - 1, currentLine + 250);
  
  // Get the extended context
  const extendedContext = document.getText({
    start: { line: startLine, character: 0 },
    end: { line: endLine + 1, character: 0 }
  });
  
  // Mark the current line in the context
  const lines = extendedContext.split('\n');
  const relativeCurrentLine = currentLine - startLine;
  
  // Add a marker for the current line
  if (relativeCurrentLine >= 0 && relativeCurrentLine < lines.length) {
    lines[relativeCurrentLine] = `>>> ${lines[relativeCurrentLine]} <<<`;
  }
  
  const context = lines.join('\n');
  
  // Get the current line content
  const currentLineText = lines[relativeCurrentLine] || '';
  
  // Check for specific patterns in the current line
  if (currentLineText.includes('#') && !currentLineText.trim().startsWith('#')) {
    const hashIndex = currentLineText.indexOf('#');
    const prompt = currentLineText.substring(hashIndex + 1).trim();
    return `Given this ${languageId} code context (current line marked with >>><<<):
\`\`\`${languageId}
${context}
\`\`\`

The line marked with >>><<< contains a prompt. Provide a code suggestion for: "${prompt}"`;
  }
  
  if (/TODO|FIXME|IMPLEMENT/i.test(currentLineText)) {
    return `Given this ${languageId} code context (current line marked with >>><<<):
\`\`\`${languageId}
${context}
\`\`\`

Implement what the TODO/FIXME comment marked with >>><<< is asking for.`;
  }
  
  // Default prompt for any incomplete code
  return `Given this ${languageId} code context (current line marked with >>><<<):
\`\`\`${languageId}
${context}
\`\`\`

Complete the code at the line marked with >>><<<. Provide only the code to insert, matching the existing style and indentation.`;
}

async function processCompletion(suggestion: string, document: TextDocument, position: { line: number, character: number }): Promise<string> {
  const lines = document.getText().split('\n');
  const currentLine = lines[position.line] || '';
  const beforeCursor = currentLine.substring(0, position.character);
  const afterCursor = currentLine.substring(position.character);
  
  // Get context for the formatting LLM
  const contextStart = Math.max(0, position.line - 10);
  const contextEnd = Math.min(lines.length, position.line + 10);
  const contextLines = lines.slice(contextStart, contextEnd);
  const relativePosition = position.line - contextStart;
  
  // Create a merging prompt that matches the few-shot format
  const mergingPrompt = `Before cursor: "${beforeCursor}"
After cursor: "${afterCursor}"
AI completion: "${suggestion}"

What to insert at cursor:`;

  try {
    const mergedResult = await fetchFormattingCompletion(mergingPrompt);
    
    if (mergedResult && !mergedResult.startsWith('Error:')) {
      connection.console.log('LSP Server: Successfully merged completion');
      return mergedResult;
    }
  } catch (error) {
    connection.console.error(`LSP Server: Merging failed: ${error}`);
  }
  
  // Fallback - return the original suggestion
  connection.console.log('LSP Server: Using fallback - returning original suggestion');
  return suggestion;
}

async function fetchFormattingCompletion(prompt: string): Promise<string> {
  if (!OPENROUTER_API_KEY) {
    return "Error: No API key";
  }
  
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/llm-lsp',
        'X-Title': 'LLM LSP Formatter',
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-3.3-70b-instruct', // Fast, reliable model for merging
        provider: {
          sort: 'throughput',
        },
        messages: [
          {
            role: 'system',
            content: 'You merge AI code completions with existing text by removing overlaps. Output only the text to insert at the cursor position.'
          },
          // Few-shot examples
          {
            role: 'user',
            content: 'Before cursor: "function bubble"\nAfter cursor: ""\nAI completion: "function bubbleSort(arr) { return arr; }"\n\nWhat to insert at cursor:'
          },
          {
            role: 'assistant',
            content: 'Sort(arr) { return arr; }'
          },
          {
            role: 'user',
            content: 'Before cursor: "const fi"\nAfter cursor: ""\nAI completion: "const fibonacci = (n) => { return n <= 1 ? n : fibonacci(n-1) + fibonacci(n-2); }"\n\nWhat to insert at cursor:'
          },
          {
            role: 'assistant',
            content: 'bonacci = (n) => { return n <= 1 ? n : fibonacci(n-1) + fibonacci(n-2); }'
          },
          {
            role: 'user',
            content: 'Before cursor: "    "\nAfter cursor: ""\nAI completion: "for (let i = 0; i < arr.length; i++) { console.log(arr[i]); }"\n\nWhat to insert at cursor:'
          },
          {
            role: 'assistant',
            content: 'for (let i = 0; i < arr.length; i++) { console.log(arr[i]); }'
          },
          {
            role: 'user',
            content: 'Before cursor: "if (x > "\nAfter cursor: ") { doSomething(); }"\nAI completion: "if (x > 10) { return true; }"\n\nWhat to insert at cursor:'
          },
          {
            role: 'assistant',
            content: '10'
          },
          {
            role: 'user',
            content: 'Before cursor: "class "\nAfter cursor: ""\nAI completion: "class Person { constructor(name) { this.name = name; } }"\n\nWhat to insert at cursor:'
          },
          {
            role: 'assistant',
            content: 'Person { constructor(name) { this.name = name; } }'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1, // Low temperature for consistent merging
        max_tokens: 1000,
      }),
    });
    
    if (!response.ok) {
      return `Error: ${response.status}`;
    }
    
    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content?.trim() || '';
      
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
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