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
  type: 'prompt' | 'function_declaration' | 'control_flow' | 'assignment' | 'block_start' | 'empty_body' | 'todo_comment';
  content: string;
  prompt?: string;
  context: string;
}

export interface ParseResult {
  incompleteSuggestions: IncompleteLine[];
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

  async parse(document: TextDocument): Promise<ParseResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const text = document.getText();
    const languageId = document.languageId;
    const language = this.languages.get(languageId);
    
    if (!language || !this.parser) {
      // Fallback if language not supported
      return { incompleteSuggestions: [] };
    }

    // Set the language
    this.parser.setLanguage(language);
    
    // Parse the document
    const tree = this.parser.parse(text);
    
    // Find incomplete patterns using Tree-sitter
    const incompleteSuggestions = this.findIncompletePatterns(tree, text, languageId);
    
    return { incompleteSuggestions };
  }

  private findIncompletePatterns(tree: Parser.Tree, text: string, languageId: string): IncompleteLine[] {
    const suggestions: IncompleteLine[] = [];
    const lines = text.split('\n');
    
    // Walk the syntax tree
    this.walkTree(tree.rootNode, (node) => {
      const startLine = node.startPosition.row;
      const nodeText = text.substring(node.startIndex, node.endIndex);
      
      // Check for natural language prompts with #
      if (nodeText.includes('#') && !nodeText.trim().startsWith('#')) {
        const hashIndex = nodeText.indexOf('#');
        const afterHash = nodeText.substring(hashIndex + 1).trim();
        if (afterHash.length > 0) {
          suggestions.push({
            line: startLine,
            type: 'prompt',
            content: lines[startLine],
            prompt: afterHash,
            context: this.getContext(lines, startLine)
          });
        }
      }
      
      // Check for TODO/FIXME comments
      if (node.type === 'comment' && /TODO|FIXME|IMPLEMENT/i.test(nodeText)) {
        suggestions.push({
          line: startLine,
          type: 'todo_comment',
          content: lines[startLine],
          context: this.getContext(lines, startLine)
        });
      }
      
      // Check for empty function bodies
      if (this.isFunctionNode(node, languageId)) {
        const body = this.getFunctionBody(node, languageId);
        if (body && this.isEmptyBody(body, text)) {
          // Find the line inside the empty body
          const bodyStartLine = body.startPosition.row;
          const bodyEndLine = body.endPosition.row;
          
          // If there's an empty line between braces, use that
          for (let line = bodyStartLine; line <= bodyEndLine; line++) {
            if (lines[line]?.trim() === '') {
              suggestions.push({
                line: line,
                type: 'empty_body',
                content: lines[line],
                context: this.getContext(lines, line)
              });
              break;
            }
          }
        }
      }
      
      // Check for incomplete control flow
      if (this.isControlFlowNode(node, languageId)) {
        const hasBody = this.hasControlFlowBody(node, languageId);
        if (!hasBody) {
          suggestions.push({
            line: startLine,
            type: 'control_flow',
            content: lines[startLine],
            context: this.getContext(lines, startLine)
          });
        }
      }
      
      // Check for assignments without values
      if (this.isIncompleteAssignment(node, languageId, text)) {
        suggestions.push({
          line: startLine,
          type: 'assignment',
          content: lines[startLine],
          context: this.getContext(lines, startLine)
        });
      }
    });
    
    return suggestions;
  }
  
  private walkTree(node: Parser.SyntaxNode, callback: (node: Parser.SyntaxNode) => void) {
    callback(node);
    for (const child of node.children) {
      this.walkTree(child, callback);
    }
  }
  
  private isFunctionNode(node: Parser.SyntaxNode, languageId: string): boolean {
    switch (languageId) {
      case 'javascript':
      case 'javascriptreact':
      case 'typescript':
      case 'typescriptreact':
        return node.type === 'function_declaration' || 
               node.type === 'method_definition' ||
               node.type === 'arrow_function' ||
               node.type === 'function_expression';
      case 'python':
        return node.type === 'function_definition';
      case 'go':
        return node.type === 'function_declaration' || node.type === 'method_declaration';
      case 'rust':
        return node.type === 'function_item';
      case 'java':
        return node.type === 'method_declaration';
      case 'c':
      case 'cpp':
        return node.type === 'function_definition';
      default:
        return false;
    }
  }
  
  private getFunctionBody(node: Parser.SyntaxNode, languageId: string): Parser.SyntaxNode | null {
    switch (languageId) {
      case 'javascript':
      case 'javascriptreact':
      case 'typescript':
      case 'typescriptreact':
        return node.childForFieldName('body') || node.children.find(c => c.type === 'statement_block') || null;
      case 'python':
        return node.childForFieldName('body') || node.children.find(c => c.type === 'block') || null;
      case 'go':
        return node.childForFieldName('body') || node.children.find(c => c.type === 'block') || null;
      case 'rust':
        return node.childForFieldName('body') || node.children.find(c => c.type === 'block') || null;
      case 'java':
        return node.childForFieldName('body') || node.children.find(c => c.type === 'block') || null;
      case 'c':
      case 'cpp':
        return node.childForFieldName('body') || node.children.find(c => c.type === 'compound_statement') || null;
      default:
        return null;
    }
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
      !child.isNamed
    );
    
    return meaningfulChildren.length === 0;
  }
  
  private isControlFlowNode(node: Parser.SyntaxNode, _languageId: string): boolean {
    const controlFlowTypes = [
      'if_statement',
      'for_statement',
      'while_statement',
      'do_statement',
      'switch_statement',
      'for_in_statement',
      'for_of_statement',
      'try_statement',
    ];
    
    return controlFlowTypes.includes(node.type);
  }
  
  private hasControlFlowBody(node: Parser.SyntaxNode, _languageId: string): boolean {
    // Check if the control flow has a proper body
    const body = node.childForFieldName('body') || 
                 node.childForFieldName('consequence') ||
                 node.children.find(c => c.type === 'statement_block' || c.type === 'block');
    
    return body !== null && body !== undefined;
  }
  
  private isIncompleteAssignment(node: Parser.SyntaxNode, _languageId: string, text: string): boolean {
    if (node.type === 'variable_declarator' || node.type === 'assignment_expression') {
      const nodeText = text.substring(node.startIndex, node.endIndex);
      // Check if it ends with = but has no value
      return /=\s*$/.test(nodeText.trim());
    }
    return false;
  }

  private getContext(lines: string[], lineIndex: number): string {
    // Get 10 lines before and after for context
    const start = Math.max(0, lineIndex - 10);
    const end = Math.min(lines.length - 1, lineIndex + 10);
    return lines.slice(start, end + 1).join('\n');
  }
}