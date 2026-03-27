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
import { GraphStore } from '../graph/GraphStore';
export declare class CommunityDetector {
    private readonly store;
    constructor(store: GraphStore);
    detect(): Promise<Map<string, number>>;
}
