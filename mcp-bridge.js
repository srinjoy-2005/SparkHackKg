// mcp-bridge.js - Native MCP stdio to HTTP proxy
const readline = require('readline');
const http = require('http');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on('line', (line) => {
    try {
        const req = JSON.parse(line);
        
        // 1. Handshake
        if (req.method === 'initialize') {
            sendResponse(req.id, {
                protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "semantic-kg", version: "1.0.0" }
            });
        } 
        // 2. Send Manifest to Cline
        else if (req.method === 'tools/list') {
            http.get('http://localhost:3579/mcp/manifest', (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    const manifest = JSON.parse(data);
                    sendResponse(req.id, {
                        tools: manifest.tools.map(t => ({
                            name: t.name, description: t.description, inputSchema: t.parameters
                        }))
                    });
                });
            }).on('error', () => sendError(req.id, "Extension HTTP server not running"));
        } 
        // 3. Execute Tool
        else if (req.method === 'tools/call') {
            const postData = JSON.stringify({ tool: req.params.name, params: req.params.arguments });
            const reqUrl = { hostname: 'localhost', port: 3579, path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } };
            
            const postReq = http.request(reqUrl, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    sendResponse(req.id, { content: [{ type: "text", text: data }] });
                });
            });
            postReq.on('error', (err) => sendResponse(req.id, { content: [{ type: "text", text: `Error: ${err.message}` }] }));
            postReq.write(postData);
            postReq.end();
        }
    } catch (e) {}
});

function sendResponse(id, result) {
    console.log(JSON.stringify({ jsonrpc: "2.0", id, result }));
}
function sendError(id, message) {
    console.log(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message } }));
}