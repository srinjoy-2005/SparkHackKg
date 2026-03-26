/**
 * FileParser — uses web-tree-sitter (WASM) to extract symbols from source files.
 *
 * Supported languages: TypeScript, JavaScript, Python, Java, Go, Rust, C/C++
 */
import { CodeNode, CodeEdge } from '../graph/GraphStore';
export declare class FileParser {
    private readonly workspaceRoot;
    private readonly extensionRoot;
    private Parser;
    private languages;
    private initialized;
    constructor(workspaceRoot: string, extensionRoot: string);
    private ensureInitialized;
    parseWorkspace(): Promise<{
        nodes: CodeNode[];
        edges: CodeEdge[];
    }>;
    parseFile(filePath: string): Promise<{
        nodes: CodeNode[];
        edges: CodeEdge[];
    }>;
    private loadLanguage;
    private extractSymbols;
    private regexFallbackExtract;
}
