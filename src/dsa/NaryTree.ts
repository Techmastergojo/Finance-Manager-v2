export class NaryTreeNode {
  public name: string;
  public budget: number; // Node's own budget
  public children: NaryTreeNode[];
  public parent: NaryTreeNode | null;

  constructor(name: string, budget: number = 0, parent: NaryTreeNode | null = null) {
    this.name = name;
    this.budget = budget;
    this.children = [];
    this.parent = parent;
  }
}

export class NaryTree {
  public root: NaryTreeNode;

  constructor(rootName: string = "Root", rootBudget: number = 0) {
    this.root = new NaryTreeNode(rootName, rootBudget);
  }

  // Find node by name recursively
  public find(name: string, node: NaryTreeNode = this.root): NaryTreeNode | null {
    if (!name || !node || !node.name) return null;
    if (String(node.name).toLowerCase() === String(name).toLowerCase()) {
      return node;
    }
    for (const child of node.children) {
      if (child) {
        const found = this.find(name, child);
        if (found) return found;
      }
    }
    return null;
  }

  // Add child under parentName
  public addChild(parentName: string, name: string, budget: number = 0): boolean {
    if (!parentName || !name) return false;
    const parentNode = this.find(parentName);
    if (!parentNode) return false;
    
    // Check if child already exists under this parent
    const existing = parentNode.children.find(child => 
      child && String(child.name).toLowerCase() === String(name).toLowerCase()
    );
    if (existing) {
      existing.budget = budget; // update budget
      return true;
    }

    const newChild = new NaryTreeNode(name, budget, parentNode);
    parentNode.children.push(newChild);
    return true;
  }

  // Remove node
  public remove(name: string): boolean {
    if (!name || !this.root || !this.root.name) return false;
    if (String(name).toLowerCase() === String(this.root.name).toLowerCase()) return false; // Cannot remove root
    const node = this.find(name);
    if (!node || !node.parent) return false;

    const index = node.parent.children.findIndex(child => 
      child && String(child.name).toLowerCase() === String(name).toLowerCase()
    );
    if (index !== -1) {
      node.parent.children.splice(index, 1);
      return true;
    }
    return false;
  }

  // Get rollup budget (sums up this node's budget + all children budgets recursively)
  public getRollupBudget(nodeName: string): number {
    const node = this.find(nodeName);
    if (!node) return 0;
    return this.calculateRollup(node);
  }

  private calculateRollup(node: NaryTreeNode): number {
    let sum = node.budget;
    for (const child of node.children) {
      sum += this.calculateRollup(child);
    }
    return sum;
  }

  // Export tree state as simple serializable object
  public toJSON(node: NaryTreeNode = this.root): any {
    return {
      name: node.name,
      budget: node.budget,
      rollup: this.calculateRollup(node),
      children: node.children.map(c => this.toJSON(c))
    };
  }

  // Static builder from serialized JSON
  public static fromJSON(json: any): NaryTree {
    const tree = new NaryTree(json.name, json.budget);
    const rebuild = (nodeData: any, parentName: string) => {
      for (const childData of nodeData.children || []) {
        tree.addChild(parentName, childData.name, childData.budget);
        rebuild(childData, childData.name);
      }
    };
    rebuild(json, json.name);
    return tree;
  }
}
