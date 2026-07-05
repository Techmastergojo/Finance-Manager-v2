class TrieNode {
  public children: { [key: string]: TrieNode } = {};
  public isEndOfWord: boolean = false;
  public word: string = "";
}

export class Trie {
  private root: TrieNode;

  constructor() {
    this.root = new TrieNode();
  }

  // Insert a word into the Trie
  public insert(word: string): void {
    if (!word || !word.trim()) return;
    let node = this.root;
    for (const char of word.toLowerCase()) {
      if (!node.children[char]) {
        node.children[char] = new TrieNode();
      }
      node = node.children[char];
    }
    node.isEndOfWord = true;
    node.word = word.trim(); // Keep original casing
  }

  // Find node matching a prefix
  private searchPrefix(prefix: string): TrieNode | null {
    let node = this.root;
    for (const char of prefix.toLowerCase()) {
      if (!node.children[char]) {
        return null;
      }
      node = node.children[char];
    }
    return node;
  }

  // Return all words starting with prefix
  public autocomplete(prefix: string): string[] {
    const trimmed = prefix.trim();
    if (!trimmed) return [];
    const results: string[] = [];
    const startNode = this.searchPrefix(trimmed);
    
    if (startNode) {
      this.collectWords(startNode, results);
    }
    
    // Limit autocomplete results to top 8 suggestions for clean UI spacing
    return results.slice(0, 8);
  }

  private collectWords(node: TrieNode, results: string[]): void {
    if (node.isEndOfWord) {
      results.push(node.word);
    }
    for (const char in node.children) {
      this.collectWords(node.children[char], results);
    }
  }

  public clear(): void {
    this.root = new TrieNode();
  }
}
