import * as http from 'http';
import { GraphStore } from '../core/graph/GraphStore';
import { Logger } from '../utils/Logger';

export class GraphUIServer {
  private server: http.Server | null = null;

  constructor(private readonly store: GraphStore, private readonly port: number = 3580) {}

  start(): void {
    this.server = http.createServer((req, res) => {
      // CORS headers just in case
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(this.buildHtml());
      } else if (req.url === '/api/data') {
        // FIX 1: Removed .slice() limits so no nodes are left "orphaned"
        const nodes = this.store.getAllNodes();
        const edges = this.store.getAllEdges();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ nodes, edges }));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    this.server.listen(this.port, '127.0.0.1', () => {
      Logger.info(`Graph UI Server listening on http://localhost:${this.port}`);
    });
  }

  stop(): void {
    this.server?.close();
  }

  private buildHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Semantic Knowledge Graph</title>
  <style>
    :root {
      --bg: #0d1117; --surface: #161b22; --border: #30363d;
      --accent: #58a6ff; --text: #c9d1d9; --muted: #8b949e;
    }
    body { background: var(--bg); color: var(--text); font-family: monospace; margin: 0; padding: 0; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
    #toolbar { padding: 12px; background: var(--surface); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
    #graph-container { flex: 1; position: relative; cursor: grab; }
    #graph-container:active { cursor: grabbing; }
    svg { width: 100%; height: 100%; }
    #tooltip { position: absolute; background: var(--surface); border: 1px solid var(--border); padding: 8px; border-radius: 4px; pointer-events: none; opacity: 0; font-size: 12px; transition: opacity 0.2s; z-index: 10; }
  </style>
</head>
<body>

<div id="toolbar">
  <h2>Semantic Code Graph</h2>
  <div id="stats">Loading data...</div>
</div>

<div id="graph-container">
  <svg id="svg"></svg>
  <div id="tooltip"></div>
</div>

<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
  const svg = d3.select('#svg');
  const tooltip = document.getElementById('tooltip');
  const g = svg.append('g');

  svg.call(d3.zoom().scaleExtent([0.1, 4]).on('zoom', e => g.attr('transform', e.transform)));

  const colorMap = { file: '#f0883e', class: '#3fb950', function: '#58a6ff', method: '#79c0ff', interface: '#bc8cff' };

  fetch('/api/data')
    .then(res => res.json())
    .then(data => {
      // Look at this top bar in the UI! It will tell you if the DB actually has edges.
      document.getElementById('stats').textContent = data.nodes.length + ' nodes | ' + data.edges.length + ' edges';
      renderGraph(data.nodes, data.edges);
    })
    .catch(err => {
      document.getElementById('stats').textContent = 'Error loading data: ' + err;
      console.error(err);
    });

  function renderGraph(nodes, edges) {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const validEdges = edges.filter(e => nodeMap.has(e.sourceId) && nodeMap.has(e.targetId));

    const d3nodes = nodes.map(n => ({ ...n }));
    
    // FIX 2: Pass raw string IDs to D3. forceLink handles the object mapping internally.
    const d3links = validEdges.map(e => ({
      source: e.sourceId,
      target: e.targetId,
      type: e.relationType,
    }));

    const width = window.innerWidth;
    const height = window.innerHeight - 50;

    // Define arrows for the edges so you can see "A Contains B"
    svg.append("defs").selectAll("marker")
      .data(["CONTAINS", "CALLS", "IMPORTS", "EXTENDS", "IMPLEMENTS"])
      .join("marker")
      .attr("id", d => "arrow-" + d)
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 18) // Push arrow slightly away from the center of the node
      .attr("refY", 0)
      .attr("markerWidth", 5)
      .attr("markerHeight", 5)
      .attr("orient", "auto")
      .append("path")
      .attr("fill", "#8b949e")
      .attr("d", "M0,-5L10,0L0,5");

    const simulation = d3.forceSimulation(d3nodes)
      .force('link', d3.forceLink(d3links).id(d => d.id).distance(80))
      .force('charge', d3.forceManyBody().strength(-150))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => d.type === 'class' ? 12 : 8));

    // FIX 3: Make line color lighter (#8b949e) so it shows up on dark mode!
    const link = g.append('g').selectAll('line')
      .data(d3links).join('line')
      .attr('stroke', '#8b949e')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', 1.5)
      .attr("marker-end", d => "url(#arrow-" + d.type + ")");

    const node = g.append('g').selectAll('circle')
      .data(d3nodes).join('circle')
      .attr('r', d => d.type === 'class' || d.type === 'file' ? 8 : 5)
      .attr('fill', d => colorMap[d.type] || '#8b949e')
      .attr('stroke', '#161b22')
      .attr('stroke-width', 1.5)
      .call(d3.drag()
        .on('start', d => { if (!d.active) simulation.alphaTarget(0.3).restart(); d.subject.fx = d.subject.x; d.subject.fy = d.subject.y; })
        .on('drag', d => { d.subject.fx = d.x; d.subject.fy = d.y; })
        .on('end', d => { if (!d.active) simulation.alphaTarget(0); d.subject.fx = null; d.subject.fy = null; })
      )
      .on('mouseover', (event, d) => {
        tooltip.style.opacity = 1;
        tooltip.innerHTML = '<strong>' + d.name + '</strong><br>' + d.type;
      })
      .on('mousemove', event => {
        tooltip.style.left = (event.pageX + 15) + 'px';
        tooltip.style.top = (event.pageY + 15) + 'px';
      })
      .on('mouseout', () => tooltip.style.opacity = 0);

    node.append('title').text(d => d.name);

    simulation.on('tick', () => {
      link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      node.attr('cx', d => d.x).attr('cy', d => d.y);
    });
  }
</script>
</body>
</html>`;
  }
}