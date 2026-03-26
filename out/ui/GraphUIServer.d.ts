import { GraphStore } from '../core/graph/GraphStore';
export declare class GraphUIServer {
    private readonly store;
    private readonly port;
    private server;
    constructor(store: GraphStore, port?: number);
    start(): void;
    stop(): void;
    private buildHtml;
}
