import { TextDocument } from 'vscode-languageserver-textdocument';
import Parser from 'tree-sitter';

// Import language bindings
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const TSX = require('tree-sitter-typescript').tsx;
const Python = require('tree-sitter-python');
const Go = require('tree-sitter-go');
const Rust = require('tree-sitter-rust');
const Java = require('tree-sitter-java');
const C = require('tree-sitter-c');
const Cpp = require('tree-sitter-cpp');

export interface IncompleteLine {
  line: number;
  type: 'incomplete';
  content: string;
  context: string;
}

export interface ParseResult {
  shouldSuggest: boolean;
  incompleteLine?: IncompleteLine;
}

export class TreeSitterParser {
  private parser: Parser | null = null;
  private languages: Map<string, any> = new Map();
  private initialized = false;

  async initialize() {
    if (this.initialized) return;
    
    this.parser = new Parser();
    
    // Set up language mappings
    this.languages.set('javascript', JavaScript);
    this.languages.set('typescript', TypeScript);
    this.languages.set('typescriptreact', TSX);
    this.languages.set('javascriptreact', JavaScript);
    this.languages.set('python', Python);
    this.languages.set('go', Go);
    this.languages.set('rust', Rust);
    this.languages.set('java', Java);
    this.languages.set('c', C);
    this.languages.set('cpp', Cpp);
    
    this.initialized = true;
  }

  async parseForCompletion(document: TextDocument, position: { line: number, character: number }): Promise<ParseResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const text = document.getText();
    const languageId = document.languageId;
    const language = this.languages.get(languageId);
    const lines = text.split('\n');
    
    // Default to suggesting if we don't have language support
    if (!language || !this.parser) {
      return { 
        shouldSuggest: true,
        incompleteLine: {
          line: position.line,
          type: 'incomplete',
          content: lines[position.line] || '',
          context: this.getContext(lines, position.line)
        }
      };
    }

    // Set the language
    this.parser.setLanguage(language);
    
    // Parse the document
    const tree = this.parser.parse(text);
    
    // Check if we should skip completion at this position
    if (this.shouldSkipCompletion(tree, text, position, lines)) {
      return { shouldSuggest: false };
    }
    
    // Return that we should suggest
    return { 
      shouldSuggest: true,
      incompleteLine: {
        line: position.line,
        type: 'incomplete',
        content: lines[position.line] || '',
        context: this.getContext(lines, position.line)
      }
    };
  }

  private shouldSkipCompletion(tree: Parser.Tree, text: string, position: { line: number, character: number }, lines: string[]): boolean {
    const line = lines[position.line] || '';
    const beforeCursor = line.substring(0, position.character);
    const trimmedBefore = beforeCursor.trim();
    
    // Skip if line is empty or only whitespace (unless it's inside a function body)
    if (trimmedBefore === '') {
      // Check if we're inside an empty function body
      const nodeAtPosition = this.getNodeAtPosition(tree.rootNode, position);
      if (nodeAtPosition && this.isInsideEmptyFunctionBody(nodeAtPosition, text)) {
        return false; // Don't skip - we want completions here
      }
      return true; // Skip empty lines outside function bodies
    }
    
    // Skip if we're in the middle of typing a word (unless after #)
    if (!beforeCursor.includes('#') && position.character > 0) {
      const charBefore = beforeCursor[position.character - 1];
      const charAfter = line[position.character] || '';
      if (/\w/.test(charBefore) && /\w/.test(charAfter)) {
        return true; // Skip - in middle of word
      }
    }
    
    // Skip if the line appears to be complete code
    const nodeAtLine = this.getNodeAtLine(tree.rootNode, position.line);
    if (nodeAtLine && this.isCompleteStatement(nodeAtLine, text, position)) {
      return true;
    }
    
    // Skip if we're inside a string or comment (unless it's a TODO comment)
    const nodeAtPosition = this.getNodeAtPosition(tree.rootNode, position);
    if (nodeAtPosition) {
      if (nodeAtPosition.type === 'string' || nodeAtPosition.type === 'string_literal') {
        return true;
      }
      if (nodeAtPosition.type === 'comment' && !/TODO|FIXME|IMPLEMENT/i.test(line)) {
        return true;
      }
    }
    
    // Don't skip - we should provide a completion
    return false;
  }
  
  private getNodeAtPosition(node: Parser.SyntaxNode, position: { line: number, character: number }): Parser.SyntaxNode | null {
    if (node.startPosition.row <= position.line && 
        node.endPosition.row >= position.line) {
      
      // Check children first for more specific match
      for (const child of node.children) {
        const childMatch = this.getNodeAtPosition(child, position);
        if (childMatch) return childMatch;
      }
      
      // Check if position is within this node's character range
      if (node.startPosition.row === position.line && node.startPosition.column > position.character) {
        return null;
      }
      if (node.endPosition.row === position.line && node.endPosition.column < position.character) {
        return null;
      }
      
      return node;
    }
    return null;
  }
  
  private getNodeAtLine(node: Parser.SyntaxNode, line: number): Parser.SyntaxNode | null {
    if (node.startPosition.row === line) {
      return node;
    }
    
    for (const child of node.children) {
      const match = this.getNodeAtLine(child, line);
      if (match) return match;
    }
    
    return null;
  }
  
  private isCompleteStatement(node: Parser.SyntaxNode, text: string, position: { line: number, character: number }): boolean {
    // Check if this is a complete statement that doesn't need completion
    const completeTypes = [
      'expression_statement',
      'return_statement',
      'throw_statement',
      'break_statement',
      'continue_statement',
      'debugger_statement',
    ];
    
    if (completeTypes.includes(node.type)) {
      // Check if cursor is at the end of the statement
      const nodeText = text.substring(node.startIndex, node.endIndex);
      const trimmedText = nodeText.trim();
      
      // If it ends with semicolon or the cursor is past the meaningful content, it's complete
      if (trimmedText.endsWith(';') || position.character >= trimmedText.length) {
        return true;
      }
    }
    
    // Check for complete function declarations with bodies
    if (this.isFunctionNode(node) && this.hasFunctionBody(node, text)) {
      return true;
    }
    
    // Check for complete variable declarations
    if ((node.type === 'variable_declaration' || node.type === 'lexical_declaration') && 
        !text.substring(node.startIndex, node.endIndex).trim().endsWith('=')) {
      return true;
    }
    
    return false;
  }
  
  private isInsideEmptyFunctionBody(node: Parser.SyntaxNode, text: string): boolean {
    // Walk up the tree to find a function
    let current: Parser.SyntaxNode | null = node;
    while (current) {
      if (this.isFunctionNode(current)) {
        const body = this.getFunctionBody(current);
        if (body && this.isEmptyBody(body, text)) {
          return true;
        }
      }
      current = current.parent;
    }
    return false;
  }
  
  private isFunctionNode(node: Parser.SyntaxNode): boolean {
    const functionTypes = [
      'function_declaration',
      'function_expression',
      'arrow_function',
      'method_definition',
      'function_definition',
      'function_item',
      'method_declaration',
    ];
    return functionTypes.includes(node.type);
  }
  
  private getFunctionBody(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    return node.childForFieldName('body') || 
           node.children.find(c => 
             c.type === 'statement_block' || 
             c.type === 'block' || 
             c.type === 'compound_statement'
           ) || null;
  }
  
  private hasFunctionBody(node: Parser.SyntaxNode, text: string): boolean {
    const body = this.getFunctionBody(node);
    return body !== null && !this.isEmptyBody(body, text);
  }
  
  private isEmptyBody(bodyNode: Parser.SyntaxNode, text: string): boolean {
    const bodyText = text.substring(bodyNode.startIndex, bodyNode.endIndex).trim();
    
    // Check if it's just braces with whitespace
    if (bodyText === '{}' || bodyText.match(/^{\s*}$/)) {
      return true;
    }
    
    // For Python, check if it's just 'pass' or empty
    if (bodyText === 'pass' || bodyText === ':') {
      return true;
    }
    
    // Check if body has no meaningful child nodes
    const meaningfulChildren = bodyNode.children.filter(child => 
      child.type !== '{' && 
      child.type !== '}' && 
      child.type !== 'comment' &&
      child.isNamed
    );
    
    return meaningfulChildren.length === 0;
  }

  private getContext(_lines: string[], _lineIndex: number): string {
    // Return empty context - the main module will handle getting extended context
    return '';
  }
}