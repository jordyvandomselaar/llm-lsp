import {
    createConnection,
    type InitializeResult,
    TextDocumentSyncKind,
    TextDocuments,
    type CompletionItem,
    CompletionItemKind,
    type CompletionParams,
  } from "vscode-languageserver/node";
  import { TextDocument } from "vscode-languageserver-textdocument";
  import fetch from "node-fetch";
  
  const connection = createConnection();
  
  const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
  
  // Get API key from environment variable
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  
  connection.onInitialize(() => {
    connection.console.log('LSP Server: Initialized');
    
    if (!OPENROUTER_API_KEY) {
      connection.console.warn('LSP Server: OPENROUTER_API_KEY not set. Completions will not work.');
    }
    
    const result: InitializeResult = {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        // Tell the client that the server supports code completion
        completionProvider: {
          // We want to listen for the "#" character to trigger our completions
          triggerCharacters: ["#"],
        },
      },
    };
  
    return result;
  });
  
  connection.onInitialized(() => {
    connection.console.log('LSP Server: Connection initialized');
  });
  
  async function fetchOpenRouterCompletion(prompt: string): Promise<string[]> {
    if (!OPENROUTER_API_KEY) {
      return ["Please set OPENROUTER_API_KEY environment variable"];
    }
    
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/llm-lsp', // Optional but recommended
          'X-Title': 'LLM LSP', // Optional
        },
        body: JSON.stringify({
          model: 'openai/gpt-3.5-turbo', // Fast model for completions
          messages: [
            {
              role: 'system',
              content: 'You are a code completion assistant. Provide only code completions, no explanations. Return up to 5 relevant completions separated by newlines.'
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
        return [`Error: ${response.status}`];
      }
      
      const data = await response.json() as any;
      const completionText = data.choices?.[0]?.message?.content || '';
      
      // Split by newlines and filter empty lines
      return completionText
        .split('\n')
        .filter((line: string) => line.trim())
        .slice(0, 5); // Limit to 5 completions
        
    } catch (error) {
      connection.console.error(`LSP Server: Error fetching completion: ${error}`);
      return [`Error: ${error instanceof Error ? error.message : 'Unknown error'}`];
    }
  }

  connection.onCompletion(async (params: CompletionParams): Promise<CompletionItem[]> => {
    connection.console.log('LSP Server: Completion requested');
    
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return [];
    }
    
    // Get the text before the cursor
    const text = document.getText();
    const offset = document.offsetAt(params.position);
    const textBeforeCursor = text.substring(0, offset);
    
    // Find the last # character
    const lastHashIndex = textBeforeCursor.lastIndexOf('#');
    if (lastHashIndex === -1) {
      return [];
    }
    
    // Get context: last 500 chars before # and the text after #
    const contextStart = Math.max(0, lastHashIndex - 500);
    const context = text.substring(contextStart, lastHashIndex);
    const query = textBeforeCursor.substring(lastHashIndex + 1);
    
    const prompt = `Given this code context:
\`\`\`
${context}
\`\`\`

Complete the following code after "#${query}"`;
    
    connection.console.log(`LSP Server: Fetching completions for query: "${query}"`);
    
    const completions = await fetchOpenRouterCompletion(prompt);
    
    return completions.map((completion, index) => ({
      label: completion,
      kind: CompletionItemKind.Text,
      detail: 'AI suggestion',
      sortText: String(index).padStart(2, '0'),
    }));
  });
  
  // Make the text document manager listen on the connection
  // for open, change and close text document events
  documents.listen(connection);
  
  // Listen on the connection
  connection.listen();