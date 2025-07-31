import {
    createConnection,
    type InitializeResult,
    TextDocumentSyncKind,
    TextDocuments,
  } from "vscode-languageserver/node";
  import { TextDocument } from "vscode-languageserver-textdocument";
  
  const connection = createConnection();
  
  const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
  
  connection.onInitialize(() => {
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

  connection.onCompletion(() => {
    return [
      {
        label: "Cannot set properties of undefined (setting 'minItems')",
        data: "https://github.com/facebook/docusaurus/issues/9271",
      },
      {
        label: "docs: fix typo in docs-introduction",
        data: "https://github.com/facebook/docusaurus/pull/9267",
      },
      {
        label: "Upgrade notification command does not copy properly",
        data: "https://github.com/facebook/docusaurus/issues/9239",
      },
    ];
  });
  
  // Make the text document manager listen on the connection
  // for open, change and close text document events
  documents.listen(connection);
  
  // Listen on the connection
  connection.listen();