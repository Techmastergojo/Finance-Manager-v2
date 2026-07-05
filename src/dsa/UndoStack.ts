export interface HistoryAction {
  type: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
  description: string;
}

export class UndoStack {
  private undoStack: HistoryAction[] = [];
  private redoStack: HistoryAction[] = [];
  private maxDepth: number;

  constructor(maxDepth: number = 50) {
    this.maxDepth = maxDepth;
  }

  public push(action: HistoryAction): void {
    this.undoStack.push(action);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift(); // Remove oldest
    }
    this.redoStack = []; // Clear redo stack on new action
  }

  public async undo(): Promise<string | null> {
    const action = this.undoStack.pop();
    if (!action) return null;
    await action.undo();
    this.redoStack.push(action);
    return action.description;
  }

  public async redo(): Promise<string | null> {
    const action = this.redoStack.pop();
    if (!action) return null;
    await action.redo();
    this.undoStack.push(action);
    return action.description;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public getUndoHistory(): string[] {
    return this.undoStack.map(a => a.description);
  }

  public getRedoHistory(): string[] {
    return this.redoStack.map(a => a.description);
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
