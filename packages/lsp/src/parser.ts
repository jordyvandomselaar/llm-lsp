import { TextDocument } from 'vscode-languageserver-textdocument';
import Parser from 'tree-sitter';

// Language configurations
const LANGUAGE_CONFIGS: Record<string, { wasmFile: string; queries?: string }> = {
  typescript: { wasmFile: 'tree-sitter-typescript.wasm' },
  javascript: { wasmFile: 'tree-sitter-javascript.wasm' },
  python: { wasmFile: 'tree-sitter-python.wasm' },
  go: { wasmFile: 'tree-sitter-go.wasm' },
  rust: { wasmFile: 'tree-sitter-rust.wasm' },
  java: { wasmFile: 'tree-sitter-java.wasm' },
  cpp: { wasmFile: 'tree-sitter-cpp.wasm' },
  c: { wasmFile: 'tree-sitter-c.wasm' },
};

export class TreeSitterParser {
  private parser: Parser | null = null;
  private languages: Map<string, any> = new Map();
  private initialized = false;

  async initialize() {
    if (this.initialized) return;
    
    this.parser = new Parser();
    // For now, we'll use regex-based parsing
    // Language parsers will be loaded dynamically when needed
    this.initialized = true;
  }

  async parse(document: TextDocument): Promise<ParseResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const text = document.getText();
    const languageId = document.languageId;
    
    // For now, use regex-based parsing as fallback
    return this.regexParse(text, languageId);
  }

  private regexParse(text: string, languageId: string): ParseResult {
    const lines = text.split('\n');
    const incompleteSuggestions: IncompleteLine[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      if (trimmed.length === 0) continue;

      // Check for various incomplete patterns
      const suggestion = this.checkIncompleteLine(line, trimmed, lines, i, languageId);
      if (suggestion) {
        incompleteSuggestions.push(suggestion);
      }
    }

    return { incompleteSuggestions };
  }

  private checkIncompleteLine(
    line: string, 
    trimmed: string, 
    lines: string[], 
    lineIndex: number,
    languageId: string
  ): IncompleteLine | null {
    // Comments that need implementation
    if (/\/\/\s*(TODO|FIXME|IMPLEMENT|todo|fixme|implement)/.test(line) ||
        /#\s*(TODO|FIXME|IMPLEMENT|todo|fixme|implement)/.test(line)) {
      return {
        line: lineIndex,
        type: 'todo_comment',
        content: line,
        context: this.getContext(lines, lineIndex)
      };
    }

    // Natural language prompts with #
    if (line.includes('#') && !line.trim().startsWith('#')) {
      const hashIndex = line.indexOf('#');
      const afterHash = line.substring(hashIndex + 1).trim();
      if (afterHash.length > 0) {
        return {
          line: lineIndex,
          type: 'prompt',
          content: line,
          prompt: afterHash,
          context: this.getContext(lines, lineIndex)
        };
      }
    }

    // Function/method declarations without body
    const functionPatterns = this.getFunctionPatterns(languageId);
    for (const pattern of functionPatterns) {
      if (pattern.test(line) && !line.includes('{')) {
        const nextLine = lines[lineIndex + 1]?.trim() || '';
        if (!nextLine.startsWith('{')) {
          return {
            line: lineIndex,
            type: 'function_declaration',
            content: line,
            context: this.getContext(lines, lineIndex)
          };
        }
      }
    }

    // Control flow without body
    if (/^\s*(if|for|while|switch|try|catch|else)\s*\(/.test(line) && !line.includes('{')) {
      const nextLine = lines[lineIndex + 1]?.trim() || '';
      if (!nextLine.startsWith('{')) {
        return {
          line: lineIndex,
          type: 'control_flow',
          content: line,
          context: this.getContext(lines, lineIndex)
        };
      }
    }

    // Assignment without value
    if (/=\s*$/.test(trimmed)) {
      return {
        line: lineIndex,
        type: 'assignment',
        content: line,
        context: this.getContext(lines, lineIndex)
      };
    }

    // Line ending with opening brace/paren
    if (/[({]\s*$/.test(trimmed)) {
      return {
        line: lineIndex,
        type: 'block_start',
        content: line,
        context: this.getContext(lines, lineIndex)
      };
    }

    // Empty class/interface body
    if (/^\s*(class|interface|struct|enum)\s+\w+.*{\s*$/.test(line)) {
      const nextLine = lines[lineIndex + 1]?.trim() || '';
      if (nextLine === '}' || nextLine === '') {
        return {
          line: lineIndex,
          type: 'empty_body',
          content: line,
          context: this.getContext(lines, lineIndex)
        };
      }
    }

    return null;
  }

  private getFunctionPatterns(languageId: string): RegExp[] {
    switch (languageId) {
      case 'typescript':
      case 'javascript':
      case 'typescriptreact':
      case 'javascriptreact':
        return [
          /^\s*(async\s+)?function\s+\w+/,
          /^\s*(const|let|var)\s+\w+\s*=\s*(async\s*)?\(/,
          /^\s*(private|public|protected|static)?\s*(async\s+)?\w+\s*\(/,
          /^\s*\w+\s*:\s*(async\s*)?\(/
        ];
      case 'python':
        return [
          /^\s*def\s+\w+/,
          /^\s*async\s+def\s+\w+/,
          /^\s*class\s+\w+/
        ];
      case 'go':
        return [
          /^\s*func\s+(\(\w+\s+\*?\w+\)\s+)?\w+/
        ];
      case 'rust':
        return [
          /^\s*(pub\s+)?(async\s+)?fn\s+\w+/,
          /^\s*impl\s+/
        ];
      case 'java':
        return [
          /^\s*(public|private|protected|static)?\s*\w+\s+\w+\s*\(/
        ];
      default:
        return [
          /^\s*(function|def|func|fn)\s+\w+/
        ];
    }
  }

  private getContext(lines: string[], lineIndex: number): string {
    const start = Math.max(0, lineIndex - 10);
    const end = Math.min(lines.length, lineIndex + 3);
    return lines.slice(start, end).join('\n');
  }
}

export interface ParseResult {
  incompleteSuggestions: IncompleteLine[];
}

export interface IncompleteLine {
  line: number;
  type: 'function_declaration' | 'control_flow' | 'assignment' | 'block_start' | 
        'empty_body' | 'todo_comment' | 'prompt';
  content: string;
  context: string;
  prompt?: string;
}