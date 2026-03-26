"use strict";
/**
 * CommunityDetector — Louvain method for graph clustering.
 *
 * Assigns community_id to each node based on the graph structure.
 * Uses CALL and CONTAINS edges (structural + behavioral).
 *
 * Louvain algorithm (simplified, single-level):
 *   1. Each node starts in its own community.
 *   2. For each node, compute modularity gain of moving it to each neighbour's community.
 *   3. Move node to community with max gain.
 *   4. Repeat until no moves improve modularity.
 *
 * Time complexity: O(n log n) in practice for sparse graphs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommunityDetector = void 0;
const Logger_1 = require("../../utils/Logger");
class CommunityDetector {
    constructor(store) {
        this.store = store;
    }
    async detect() {
        const nodes = this.store.getAllNodes().filter(n => n.type !== 'file');
        const edges = [
            ...this.store.getEdgesByType('CALLS'),
            ...this.store.getEdgesByType('CONTAINS'),
        ];
        if (nodes.length === 0)
            return new Map();
        Logger_1.Logger.info(`CommunityDetector: running on ${nodes.length} nodes, ${edges.length} edges`);
        const nodeIds = nodes.map(n => n.id);
        const nodeIndex = new Map(nodeIds.map((id, i) => [id, i]));
        const n = nodeIds.length;
        // Adjacency list (undirected for Louvain)
        const adj = new Map();
        let totalEdges = 0;
        for (let i = 0; i < n; i++)
            adj.set(i, new Set());
        for (const edge of edges) {
            const s = nodeIndex.get(edge.sourceId);
            const t = nodeIndex.get(edge.targetId);
            if (s === undefined || t === undefined || s === t)
                continue;
            adj.get(s).add(t);
            adj.get(t).add(s);
            totalEdges++;
        }
        // Degree of each node
        const degree = nodeIds.map((_, i) => adj.get(i).size);
        const m = Math.max(totalEdges, 1); // total edge count (avoid div/0)
        // Community assignment: each node starts in its own community
        const community = nodeIds.map((_, i) => i);
        let improved = true;
        let iterations = 0;
        const MAX_ITER = 20;
        while (improved && iterations < MAX_ITER) {
            improved = false;
            iterations++;
            for (let i = 0; i < n; i++) {
                const currentCom = community[i];
                const neighbours = adj.get(i);
                // Count connections to each neighbouring community
                const comWeights = new Map();
                for (const j of neighbours) {
                    const c = community[j];
                    comWeights.set(c, (comWeights.get(c) ?? 0) + 1);
                }
                // Modularity gain of removing i from its current community
                // ΔQ = [k_i,in / m] - [k_i * k_c / (2m²)]
                let bestGain = 0;
                let bestCom = currentCom;
                for (const [candidateCom, kIn] of comWeights) {
                    if (candidateCom === currentCom)
                        continue;
                    // Size of candidate community (sum of degrees)
                    let sumDeg = 0;
                    for (let j = 0; j < n; j++) {
                        if (community[j] === candidateCom)
                            sumDeg += degree[j];
                    }
                    const gain = kIn / m - (degree[i] * sumDeg) / (2 * m * m);
                    if (gain > bestGain) {
                        bestGain = gain;
                        bestCom = candidateCom;
                    }
                }
                if (bestCom !== currentCom) {
                    community[i] = bestCom;
                    improved = true;
                }
            }
        }
        // Normalize community IDs to be contiguous integers starting at 0
        const rawIds = [...new Set(community)];
        const normalized = new Map(rawIds.map((id, i) => [id, i]));
        const result = new Map();
        nodeIds.forEach((nodeId, i) => {
            result.set(nodeId, normalized.get(community[i]));
        });
        const numCommunities = normalized.size;
        Logger_1.Logger.info(`CommunityDetector: ${numCommunities} communities detected after ${iterations} iterations`);
        // Persist to DB
        for (const [nodeId, comId] of result) {
            this.store.updateCommunityId(nodeId, comId);
        }
        this.store.persist();
        return result;
    }
}
exports.CommunityDetector = CommunityDetector;
//# sourceMappingURL=CommunityDetector.js.map