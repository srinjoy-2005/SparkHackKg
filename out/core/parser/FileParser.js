"use strict";
/**
 * FileParser — uses web-tree-sitter (WASM) to extract symbols from source files.
 *
 * Supported languages: TypeScript, JavaScript, Python, Java, Go, Rust, C/C++
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileParser = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const glob_1 = require("glob");
const Logger_1 = require("../../utils/Logger");
// Language → WASM grammar file mapping
const LANGUAGE_MAP = {
    typescript: { exts: ['.ts', '.tsx'], grammar: 'tree-sitter-typescript.wasm' },
    javascript: { exts: ['.js', '.jsx', '.mjs'], grammar: 'tree-sitter-javascript.wasm' },
    python: { exts: ['.py'], grammar: 'tree-sitter-python.wasm' },
    java: { exts: ['.java'], grammar: 'tree-sitter-java.wasm' },
    go: { exts: ['.go'], grammar: 'tree-sitter-go.wasm' },
    rust: { exts: ['.rs'], grammar: 'tree-sitter-rust.wasm' },
    cpp: { exts: ['.cpp', '.cc', '.cxx', '.h', '.hpp', '.c'], grammar: 'tree-sitter-cpp.wasm' },
};
class FileParser {
    constructor(workspaceRoot, extensionRoot) {
        this.Parser = null;
        this.languages = new Map();
        this.initialized = false;
        this.workspaceRoot = workspaceRoot;
        this.extensionRoot = extensionRoot;
    }
    async ensureInitialized() {
        if (this.initialized)
            return;
        const TreeSitter = await Promise.resolve().then(() => __importStar(require('web-tree-sitter')));
        const wasmPath = path.join(this.extensionRoot, 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm');
        await TreeSitter.default.init({
            locateFile: () => wasmPath
        });
        this.Parser = TreeSitter.default;
        this.initialized = true;
        Logger_1.Logger.info('Tree-sitter initialized');
    }
    async parseWorkspace() {
        await this.ensureInitialized();
        const config = await Promise.resolve().then(() => __importStar(require('vscode'))).then(v => v.workspace.getConfiguration('semanticKG'));
        const excludePatterns = config.get('excludePatterns', [
            '**/node_modules/**', '**/.git/**', '**/dist/**', '**/out/**',
        ]);
        const allExtensions = Object.values(LANGUAGE_MAP).flatMap(l => l.exts);
        const pattern = `**/*{${allExtensions.join(',')}}`;
        const files = await (0, glob_1.glob)(pattern, {
            cwd: this.workspaceRoot,
            ignore: excludePatterns,
            absolute: true,
        });
        Logger_1.Logger.info(`Parsing ${files.length} files...`);
        const allNodes = [];
        const allEdges = [];
        for (const filePath of files) {
            try {
                const { nodes, edges } = await this.parseFile(filePath);
                allNodes.push(...nodes);
                allEdges.push(...edges);
            }
            catch (err) {
                Logger_1.Logger.warn(`Skip ${filePath}: ${err}`);
            }
        }
        return { nodes: allNodes, edges: allEdges };
    }
    async parseFile(filePath) {
        await this.ensureInitialized();
        const ext = path.extname(filePath).toLowerCase();
        const langEntry = Object.entries(LANGUAGE_MAP).find(([, v]) => v.exts.includes(ext));
        if (!langEntry)
            return { nodes: [], edges: [] };
        const [langName] = langEntry;
        const code = fs.readFileSync(filePath, 'utf-8');
        const checksum = crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);
        const relPath = path.relative(this.workspaceRoot, filePath);
        const nodes = [];
        const edges = [];
        // File node (The root parent for CONTAINS edges)
        const fileNodeId = relPath;
        nodes.push({
            id: fileNodeId,
            type: 'file',
            name: relPath,
            filePath,
            signature: '',
            docstring: '',
            communityId: 0,
            checksum,
            isAutoGenerated: false,
            startLine: 0,
            endLine: code.split('\n').length,
        });
        try {
            const language = await this.loadLanguage(langName, langEntry[1].grammar);
            const parser = new this.Parser();
            parser.setLanguage(language);
            const tree = parser.parse(code);
            this.extractSymbols(tree.rootNode, code, filePath, relPath, nodes, edges);
            tree.delete();
        }
        catch (err) {
            Logger_1.Logger.warn(`Tree-sitter parse failed for ${filePath}, using regex fallback: ${err}`);
            this.regexFallbackExtract(code, filePath, relPath, nodes, edges);
        }
        return { nodes, edges };
    }
    async loadLanguage(langName, grammarFile) {
        if (this.languages.has(langName))
            return this.languages.get(langName);
        const grammarPath = path.join(this.extensionRoot, 'grammars', grammarFile);
        if (!fs.existsSync(grammarPath)) {
            throw new Error(`Grammar not found: ${grammarPath}`);
        }
        const lang = await this.Parser.Language.load(grammarPath);
        this.languages.set(langName, lang);
        return lang;
    }
    extractSymbols(rootNode, code, filePath, relPath, nodes, edges) {
        const lines = code.split('\n');
        const fileNodeId = relPath;
        const walk = (node, parentId, parentClass) => {
            const type = node.type;
            if (type === 'function_declaration' || type === 'function_definition' ||
                type === 'method_definition' || type === 'function_item') {
                const nameNode = node.childForFieldName?.('name') ?? node.children?.find((c) => c.type === 'identifier');
                if (!nameNode) {
                    node.children?.forEach((c) => walk(c, parentId, parentClass));
                    return;
                }
                const name = nameNode.text;
                const fullId = parentClass ? `${relPath}:${parentClass}.${name}` : `${relPath}:${name}`;
                const docstring = extractDocstring(node, lines);
                const signature = extractSignature(node, code);
                nodes.push({
                    id: fullId,
                    type: parentClass ? 'method' : 'function',
                    name,
                    filePath,
                    signature,
                    docstring,
                    communityId: 0,
                    checksum: crypto.createHash('sha256').update(node.text).digest('hex').slice(0, 16),
                    isAutoGenerated: false,
                    startLine: node.startPosition.row,
                    endLine: node.endPosition.row,
                });
                edges.push({ sourceId: parentId, targetId: fullId, relationType: 'CONTAINS' });
                node.children?.forEach((c) => walk(c, fullId, parentClass));
            }
            else if (type === 'class_declaration' || type === 'class_definition') {
                const nameNode = node.childForFieldName?.('name') ?? node.children?.find((c) => c.type === 'identifier' || c.type === 'type_identifier');
                if (!nameNode) {
                    node.children?.forEach((c) => walk(c, parentId));
                    return;
                }
                const name = nameNode.text;
                const fullId = `${relPath}:${name}`;
                const docstring = extractDocstring(node, lines);
                nodes.push({
                    id: fullId,
                    type: 'class',
                    name,
                    filePath,
                    signature: `class ${name}`,
                    docstring,
                    communityId: 0,
                    checksum: crypto.createHash('sha256').update(node.text.slice(0, 200)).digest('hex').slice(0, 16),
                    isAutoGenerated: false,
                    startLine: node.startPosition.row,
                    endLine: node.endPosition.row,
                });
                edges.push({ sourceId: parentId, targetId: fullId, relationType: 'CONTAINS' });
                // === EXTENDS & IMPLEMENTS LOGIC FOR CLASSES ===
                // Look for AST nodes that signify inheritance or interfaces
                const heritageNodes = node.children?.filter((c) => ['class_heritage', 'superclass', 'base_classes', 'interfaces'].includes(c.type)) || [];
                heritageNodes.forEach((heritage) => {
                    // Recursive scanner to find all type identifiers inside the heritage clause
                    const findTypes = (n, currentRelation) => {
                        // Switch relation context if we enter an implements/extends block
                        if (n.type === 'extends_clause' || n.type === 'superclass' || n.type === 'base_classes') {
                            currentRelation = 'EXTENDS';
                        }
                        else if (n.type === 'implements_clause' || n.type === 'interfaces') {
                            currentRelation = 'IMPLEMENTS';
                        }
                        if (n.type === 'type_identifier' || n.type === 'identifier') {
                            edges.push({
                                sourceId: fullId,
                                targetId: `${relPath}:${n.text}`, // Naive local resolution
                                relationType: currentRelation
                            });
                        }
                        else {
                            n.children?.forEach((child) => findTypes(child, currentRelation));
                        }
                    };
                    const defaultRelation = heritage.type === 'interfaces' ? 'IMPLEMENTS' : 'EXTENDS';
                    findTypes(heritage, defaultRelation);
                });
                // ==============================================
                node.children?.forEach((c) => walk(c, fullId, name));
            }
            else if (type === 'interface_declaration') {
                const nameNode = node.children?.find((c) => c.type === 'type_identifier');
                if (!nameNode) {
                    node.children?.forEach((c) => walk(c, parentId));
                    return;
                }
                const name = nameNode.text;
                const fullId = `${relPath}:${name}`;
                nodes.push({
                    id: fullId,
                    type: 'interface',
                    name,
                    filePath,
                    signature: `interface ${name}`,
                    docstring: extractDocstring(node, lines),
                    communityId: 0,
                    checksum: '',
                    isAutoGenerated: false,
                    startLine: node.startPosition.row,
                    endLine: node.endPosition.row,
                });
                edges.push({ sourceId: parentId, targetId: fullId, relationType: 'CONTAINS' });
                // === EXTENDS LOGIC FOR INTERFACES ===
                // Interfaces can extend other interfaces!
                const heritageNodes = node.children?.filter((c) => ['extends_clause'].includes(c.type)) || [];
                heritageNodes.forEach((heritage) => {
                    const findTypes = (n) => {
                        if (n.type === 'type_identifier' || n.type === 'identifier') {
                            edges.push({ sourceId: fullId, targetId: `${relPath}:${n.text}`, relationType: 'EXTENDS' });
                        }
                        else {
                            n.children?.forEach((child) => findTypes(child));
                        }
                    };
                    findTypes(heritage);
                });
                // ====================================
                node.children?.forEach((c) => walk(c, fullId, name));
            }
            else {
                node.children?.forEach((c) => walk(c, parentId, parentClass));
            }
        };
        walk(rootNode, fileNodeId);
    }
    regexFallbackExtract(code, filePath, relPath, nodes, edges) {
        const lines = code.split('\n');
        const fnRegex = /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|def\s+(\w+))/gm;
        const classRegex = /^(?:export\s+)?class\s+(\w+)/gm;
        let match;
        while ((match = fnRegex.exec(code)) !== null) {
            const name = match[1] ?? match[2] ?? match[3];
            if (!name)
                continue;
            const lineNo = code.slice(0, match.index).split('\n').length - 1;
            const fullId = `${relPath}:${name}`;
            nodes.push({
                id: `${relPath}:${name}`,
                type: 'function',
                name,
                filePath,
                signature: match[0].trim(),
                docstring: '',
                communityId: 0,
                checksum: '',
                isAutoGenerated: false,
                startLine: lineNo,
                endLine: lineNo,
            });
            edges.push({ sourceId: relPath, targetId: fullId, relationType: 'CONTAINS' });
        }
        while ((match = classRegex.exec(code)) !== null) {
            const name = match[1];
            const lineNo = code.slice(0, match.index).split('\n').length - 1;
            const fullId = `${relPath}:${name}`;
            nodes.push({
                id: `${relPath}:${name}`,
                type: 'class',
                name,
                filePath,
                signature: `class ${name}`,
                docstring: '',
                communityId: 0,
                checksum: '',
                isAutoGenerated: false,
                startLine: lineNo,
                endLine: lineNo,
            });
            edges.push({ sourceId: relPath, targetId: fullId, relationType: 'CONTAINS' });
        }
    }
}
exports.FileParser = FileParser;
// ── Helpers ──────────────────────────────────────────────────────────────────
function extractDocstring(node, lines) {
    const startLine = node.startPosition?.row ?? 0;
    if (startLine === 0)
        return '';
    const prevLine = lines[startLine - 1]?.trim() ?? '';
    if (prevLine.startsWith('//') || prevLine.startsWith('#')) {
        return prevLine.replace(/^[/#\s*]+/, '').trim();
    }
    if (prevLine.startsWith('*/')) {
        const commentLines = [];
        for (let i = startLine - 2; i >= 0; i--) {
            const l = lines[i].trim();
            if (l.startsWith('/*') || l.startsWith('/**'))
                break;
            commentLines.unshift(l.replace(/^\*\s?/, ''));
        }
        return commentLines.join(' ').trim();
    }
    const bodyNode = node.childForFieldName?.('body');
    if (bodyNode) {
        const first = bodyNode.children?.[0];
        if (first?.type === 'expression_statement') {
            const str = first.children?.[0];
            if (str?.type === 'string') {
                return str.text.replace(/^['"`]{1,3}|['"`]{1,3}$/g, '').trim();
            }
        }
    }
    return '';
}
function extractSignature(node, code) {
    const bodyNode = node.childForFieldName?.('body');
    if (bodyNode) {
        return code.slice(node.startIndex, bodyNode.startIndex).replace(/\s+/g, ' ').trim();
    }
    return node.text?.split('\n')[0]?.trim() ?? '';
}
//# sourceMappingURL=FileParser.js.map