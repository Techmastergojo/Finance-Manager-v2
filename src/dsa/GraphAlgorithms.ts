// Dijkstra multi-currency rate optimization
export interface ExchangeRateEdge {
  to: string;
  rate: number;
}

export class CurrencyGraph {
  private adjacencyList: { [currency: string]: ExchangeRateEdge[] } = {};

  public addNode(currency: string): void {
    if (!this.adjacencyList[currency]) {
      this.adjacencyList[currency] = [];
    }
  }

  public addRate(from: string, to: string, rate: number): void {
    this.addNode(from);
    this.addNode(to);
    const edges = this.adjacencyList[from];
    const existing = edges.find(e => e.to.toLowerCase() === to.toLowerCase());
    if (existing) {
      existing.rate = rate;
    } else {
      edges.push({ to, rate });
    }
  }

  // Find the optimal conversion path from start to end maximizing the rate product
  public findOptimalPath(start: string, end: string): { path: string[]; rate: number } {
    const currencies = Object.keys(this.adjacencyList);
    if (!currencies.includes(start) || !currencies.includes(end)) {
      return { path: [], rate: 0 };
    }

    const maxRate: { [node: string]: number } = {};
    const parent: { [node: string]: string | null } = {};
    const visited = new Set<string>();

    for (const c of currencies) {
      maxRate[c] = 0;
      parent[c] = null;
    }
    maxRate[start] = 1.0;

    for (let i = 0; i < currencies.length; i++) {
      let u: string | null = null;
      let maxVal = -1;
      for (const c of currencies) {
        if (!visited.has(c) && maxRate[c] > maxVal) {
          maxVal = maxRate[c];
          u = c;
        }
      }

      if (u === null || u === end || maxRate[u] === 0) {
        break;
      }

      visited.add(u);

      for (const edge of this.adjacencyList[u] || []) {
        const v = edge.to;
        const newRate = maxRate[u] * edge.rate;
        if (newRate > maxRate[v]) {
          maxRate[v] = newRate;
          parent[v] = u;
        }
      }
    }

    if (maxRate[end] === 0) {
      return { path: [], rate: 0 };
    }

    const path: string[] = [];
    let curr: string | null = end;
    const pathSet = new Set<string>();
    while (curr !== null) {
      if (pathSet.has(curr)) break;
      pathSet.add(curr);
      path.push(curr);
      curr = parent[curr];
    }
    path.reverse();

    return { path, rate: maxRate[end] };
  }

  public getAdjacencyList() {
    return this.adjacencyList;
  }
}

// DFS Cycle Auditor for account transfers
export interface TransferEdge {
  toAccountId: string;
  amount: number;
  date: string;
}

export class TransactionAuditGraph {
  private adjList: { [accountId: string]: TransferEdge[] } = {};

  public addNode(accountId: string): void {
    if (!this.adjList[accountId]) {
      this.adjList[accountId] = [];
    }
  }

  public addTransfer(from: string, to: string, amount: number, date: string): void {
    this.addNode(from);
    this.addNode(to);
    this.adjList[from].push({ toAccountId: to, amount, date });
  }

  // Detect circular transfers (cycles) using DFS (three-color coloring algorithm)
  // Colors: 0 = unvisited (white), 1 = visiting (gray), 2 = fully visited (black)
  public findCircularTransfers(): string[][] {
    const states: { [node: string]: number } = {};
    const parent: { [node: string]: string | null } = {};
    const nodes = Object.keys(this.adjList);
    const cycles: string[][] = [];

    for (const node of nodes) {
      states[node] = 0;
      parent[node] = null;
    }

    const dfs = (u: string) => {
      states[u] = 1; // Visiting (gray)
      for (const edge of this.adjList[u] || []) {
        const v = edge.toAccountId;
        if (states[v] === 1) {
          const cycle: string[] = [v];
          let curr: string | null = u;
          const cycleSet = new Set<string>([v]);
          while (curr !== null && curr !== v) {
            if (cycleSet.has(curr)) break;
            cycleSet.add(curr);
            cycle.push(curr);
            curr = parent[curr];
          }
          cycle.push(v);
          cycle.reverse();
          
          // Verify if this cycle path is already added (in any rotation) to avoid duplicates
          const cycleKey = cycle.slice(0, -1).sort().join(",");
          const isDuplicate = cycles.some(existing => {
            const existingKey = existing.slice(0, -1).sort().join(",");
            return existingKey === cycleKey;
          });

          if (!isDuplicate) {
            cycles.push(cycle);
          }
        } else if (states[v] === 0) {
          parent[v] = u;
          dfs(v);
        }
      }
      states[u] = 2; // Visited (black)
    };

    for (const node of nodes) {
      if (states[node] === 0) {
        dfs(node);
      }
    }

    return cycles;
  }
}
