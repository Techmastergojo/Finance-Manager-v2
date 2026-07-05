import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Account } from '../db';
import { NaryTree, NaryTreeNode } from '../dsa/NaryTree';
import { PlusIcon, TrashIcon, AlertIcon } from '../icons';
import type { HistoryAction } from '../dsa/UndoStack';

interface DashboardProps {
  onPushAction: (action: HistoryAction) => void;
  addDsaLog: (log: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onPushAction, addDsaLog }) => {
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];
  const bills = useLiveQuery(() => db.bills.where('isPaid').equals(0).toArray()) || [];
  const goals = useLiveQuery(() => db.goals.toArray()) || [];

  const [budgetTree, setBudgetTree] = useState<NaryTree>(new NaryTree("Monthly Budget", 0));
  const [collapsedNodes, setCollapsedNodes] = useState<{ [name: string]: boolean }>({});
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryBudget, setNewCategoryBudget] = useState('');
  const [selectedParentNode, setSelectedParentNode] = useState('Monthly Budget');

  // Account Form State
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<'Cash' | 'Card' | 'Investment' | 'Savings'>('Cash');
  const [accBalance, setAccBalance] = useState('');

  const [nextPayday, setNextPayday] = useState(() => {
    return localStorage.getItem('paycheck_next_date') || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  });
  const [paycheckCycle, setPaycheckCycle] = useState(() => {
    return localStorage.getItem('paycheck_cycle') || 'bi-weekly';
  });
  
  // Load budget tree from local storage on mount
  useEffect(() => {
    const saved = localStorage.getItem('budget_hierarchy');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setBudgetTree(NaryTree.fromJSON(parsed));
      } catch (e) {
        console.error('Failed to parse budget tree', e);
        initializeDefaultBudget();
      }
    } else {
      initializeDefaultBudget();
    }
  }, []);

  const initializeDefaultBudget = () => {
    const tree = new NaryTree("Monthly Budget", 0);
    tree.addChild("Monthly Budget", "Housing", 0);
    tree.addChild("Housing", "Rent", 1200);
    tree.addChild("Housing", "Utilities", 150);
    tree.addChild("Monthly Budget", "Food", 0);
    tree.addChild("Food", "Groceries", 450);
    tree.addChild("Food", "Dining Out", 150);
    tree.addChild("Monthly Budget", "Transport", 250);
    tree.addChild("Monthly Budget", "Entertainment", 200);
    setBudgetTree(tree);
    saveBudgetTree(tree);
    addDsaLog("N-ary Tree: Initialized default budget tree structure.");
  };

  const saveBudgetTree = (tree: NaryTree) => {
    const json = tree.toJSON();
    localStorage.setItem('budget_hierarchy', JSON.stringify(json));
    setBudgetTree(NaryTree.fromJSON(json));
  };

  const handleRenameCategory = (oldName: string) => {
    const newName = prompt(`Enter new name for category "${oldName}":`, oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;

    const treeCopy = NaryTree.fromJSON(budgetTree.toJSON());
    const node = treeCopy.find(oldName);
    if (node) {
      node.name = newName.trim();
      saveBudgetTree(treeCopy);
      
      db.transaction('rw', db.transactions, async () => {
        const matchingTx = await db.transactions.where('category').equals(oldName).toArray();
        for (const tx of matchingTx) {
          if (tx.id) {
            await db.transactions.update(tx.id, { category: newName.trim() });
          }
        }
      });
      addDsaLog(`Budget: Renamed '${oldName}' to '${newName.trim()}'.`);
    }
  };

  // Add New Account
  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accName.trim()) return;
    const balanceVal = parseFloat(accBalance) || 0;

    const newAcc: Account = {
      name: accName.trim(),
      type: accType,
      balance: balanceVal,
      currency: 'USD'
    };

    await db.transaction('rw', [db.accounts, db.transactions], async () => {
      const addedId = await db.accounts.add(newAcc);
      
      // Log opening balance transaction
      let txId: number | undefined;
      if (balanceVal !== 0) {
        txId = await db.transactions.add({
          amount: Math.abs(balanceVal),
          type: balanceVal > 0 ? 'Income' : 'Expense',
          category: 'System/Opening Balance',
          destAccountId: balanceVal > 0 ? addedId : undefined,
          sourceAccountId: balanceVal < 0 ? addedId : undefined,
          date: new Date().toISOString().split('T')[0],
          description: `Opening balance for ${newAcc.name}`,
          tags: ['initial-balance'],
          currency: 'USD'
        });
      }

      const undoAction: HistoryAction = {
        type: 'create_account',
        description: `Create Account: ${newAcc.name}`,
        undo: async () => {
          await db.transaction('rw', [db.accounts, db.transactions], async () => {
            await db.accounts.delete(addedId);
            if (txId) await db.transactions.delete(txId);
          });
          addDsaLog(`Undo Stack: Removed account '${newAcc.name}' and opening transaction.`);
        },
        redo: async () => {
          await db.transaction('rw', [db.accounts, db.transactions], async () => {
            await db.accounts.put({ ...newAcc, id: addedId });
            if (txId && balanceVal !== 0) {
              await db.transactions.put({
                id: txId,
                amount: Math.abs(balanceVal),
                type: balanceVal > 0 ? 'Income' : 'Expense',
                category: 'System/Opening Balance',
                destAccountId: balanceVal > 0 ? addedId : undefined,
                sourceAccountId: balanceVal < 0 ? addedId : undefined,
                date: new Date().toISOString().split('T')[0],
                description: `Opening balance for ${newAcc.name}`,
                tags: ['initial-balance'],
                currency: 'USD'
              });
            }
          });
          addDsaLog(`Undo Stack: Restored account '${newAcc.name}'.`);
        }
      };

      onPushAction(undoAction);
      addDsaLog(`System: Created account '${newAcc.name}' with balance $${balanceVal}.`);
    });

    setAccName('');
    setAccBalance('');
  };

  // Aggregates
  const netWorth = accounts.reduce((sum, acc) => sum + acc.balance, 0);
  
  const totalIncome = transactions
    .filter(t => t.type === 'Income')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpenses = transactions
    .filter(t => t.type === 'Expense' || t.type === 'Debt Payoff')
    .reduce((sum, t) => sum + t.amount, 0);

  const billsDueBeforePayday = bills
    .filter(b => b.dueDate <= nextPayday)
    .reduce((sum, b) => sum + b.amount, 0);

  const totalSavingsGoalTargetForMonth = goals.reduce((sum, goal) => {
    const remaining = goal.targetAmount - goal.currentAmount;
    if (remaining <= 0) return sum;
    const diffMs = new Date(goal.targetDate).getTime() - Date.now();
    const diffMonths = Math.max(1, Math.ceil(diffMs / (30 * 24 * 60 * 60 * 1000)));
    return sum + (remaining / diffMonths);
  }, 0);

  const availableCash = accounts
    .filter(a => a.type === 'Cash')
    .reduce((sum, a) => sum + a.balance, 0);

  const creditCardDebt = accounts
    .filter(a => a.type === 'Card')
    .reduce((sum, a) => sum + Math.abs(a.balance), 0);

  const safeToSpend = Math.max(0, availableCash - creditCardDebt - billsDueBeforePayday - totalSavingsGoalTargetForMonth);

  // Add Category to Budget Tree
  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    const budgetVal = parseFloat(newCategoryBudget) || 0;
    if (budgetVal < 0) {
      alert("Budget cannot be negative");
      return;
    }

    const treeCopy = NaryTree.fromJSON(budgetTree.toJSON());
    const parentName = selectedParentNode;
    const childName = newCategoryName.trim();
    
    // Add child to N-ary tree
    const success = treeCopy.addChild(parentName, childName, budgetVal);
    
    if (success) {
      const prevTreeJSON = budgetTree.toJSON();
      
      // Setup Undo action
      const undoAction: HistoryAction = {
        type: 'add_budget_node',
        description: `Add sub-budget '${childName}' under '${parentName}'`,
        undo: () => {
          const revertedTree = NaryTree.fromJSON(prevTreeJSON);
          saveBudgetTree(revertedTree);
          addDsaLog(`N-ary Tree [Undo]: Removed sub-budget '${childName}'.`);
        },
        redo: () => {
          const redoneTree = NaryTree.fromJSON(prevTreeJSON);
          redoneTree.addChild(parentName, childName, budgetVal);
          saveBudgetTree(redoneTree);
          addDsaLog(`N-ary Tree [Redo]: Re-added sub-budget '${childName}' under '${parentName}'.`);
        }
      };

      saveBudgetTree(treeCopy);
      onPushAction(undoAction);
      
      const rollupVal = treeCopy.getRollupBudget(parentName);
      addDsaLog(`N-ary Tree: Added '${childName}' ($${budgetVal}) under '${parentName}'. Rollup budget for '${parentName}' is now $${rollupVal}.`);
      
      setNewCategoryName('');
      setNewCategoryBudget('');
    } else {
      alert("Could not find parent category or category name already exists.");
    }
  };

  // Delete Category
  const handleDeleteCategory = (name: string) => {
    if (name === "Monthly Budget") return;
    const treeCopy = NaryTree.fromJSON(budgetTree.toJSON());
    
    const node = treeCopy.find(name);
    if (!node || !node.parent) return;

    const parentName = node.parent.name;
    const budgetVal = node.budget;
    const prevTreeJSON = budgetTree.toJSON();

    const success = treeCopy.remove(name);
    if (success) {
      const undoAction: HistoryAction = {
        type: 'delete_budget_node',
        description: `Delete sub-budget '${name}'`,
        undo: () => {
          const revertedTree = NaryTree.fromJSON(prevTreeJSON);
          saveBudgetTree(revertedTree);
          addDsaLog(`N-ary Tree [Undo]: Restored budget node '${name}'.`);
        },
        redo: () => {
          const redoneTree = NaryTree.fromJSON(prevTreeJSON);
          redoneTree.remove(name);
          saveBudgetTree(redoneTree);
          addDsaLog(`N-ary Tree [Redo]: Re-deleted budget node '${name}'.`);
        }
      };

      saveBudgetTree(treeCopy);
      onPushAction(undoAction);
      
      const rollupVal = treeCopy.getRollupBudget(parentName);
      addDsaLog(`N-ary Tree: Removed '${name}' (budget: $${budgetVal}). Rollup budget for parent '${parentName}' recalculated to $${rollupVal}.`);
    }
  };

  const toggleCollapse = (name: string) => {
    setCollapsedNodes(prev => ({
      ...prev,
      [name]: !prev[name]
    }));
  };

  // Render budget tree recursively with collapsible lists
  const renderBudgetNodes = (node: NaryTreeNode) => {
    const isCollapsed = collapsedNodes[node.name] || false;
    const hasChildren = node.children.length > 0;
    const rollup = budgetTree.getRollupBudget(node.name);

    return (
      <div key={node.name} className="tree-node">
        <div className="tree-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {hasChildren && (
              <span onClick={() => toggleCollapse(node.name)} style={{ cursor: 'pointer', userSelect: 'none', fontSize: '0.8rem' }}>
                {isCollapsed ? '▶' : '▼'}
              </span>
            )}
            <span style={{ fontWeight: hasChildren ? 600 : 400 }}>{node.name}</span>
            {hasChildren && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                (Self: <span className="amount-value" style={{ fontSize: '0.75rem' }}>${node.budget}</span>)
              </span>
            )}
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span className="amount-value" style={{ fontWeight: 600 }}>
              ${rollup}
            </span>
            {node.name !== "Monthly Budget" && (
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                <button 
                  onClick={() => handleRenameCategory(node.name)}
                  className="btn btn-secondary"
                  style={{ padding: '2px 6px', borderColor: 'transparent' }}
                  title="Rename category"
                >
                  ✏️
                </button>
                <button 
                  onClick={() => handleDeleteCategory(node.name)}
                  className="btn btn-secondary"
                  style={{ padding: '2px 6px', color: 'var(--accent-negative-10)', borderColor: 'transparent' }}
                  title="Remove budget category"
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            )}
          </div>
        </div>

        {hasChildren && !isCollapsed && (
          <div style={{ marginTop: '0.25rem' }}>
            {node.children.map(child => renderBudgetNodes(child))}
          </div>
        )}
      </div>
    );
  };

  // Flatten tree to list parents available for new categories
  const getFlattenedNodeNames = (node: NaryTreeNode): string[] => {
    const list = [node.name];
    for (const child of node.children) {
      list.push(...getFlattenedNodeNames(child));
    }
    return list;
  };

  const parentOptions = getFlattenedNodeNames(budgetTree.root);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Cards Grid */}
      <div className="dashboard-grid" style={{ padding: '2rem 2rem 0 2rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
        <div className="card" style={{ borderLeft: '4px solid var(--accent-positive-10)' }}>
          <div className="card-title">
            <span>Safe-To-Spend</span>
            <span style={{ color: 'var(--accent-positive-10)', fontSize: '0.75rem' }}>Until {nextPayday}</span>
          </div>
          <div className="card-value" style={{ color: 'var(--accent-positive-10)' }}>
            Rs. {safeToSpend.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Available checking cash minus bills & monthly goal targets.
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <span>Net Worth</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>All Accounts</span>
          </div>
          <div className="card-value" style={{ color: netWorth >= 0 ? 'var(--text-primary)' : 'var(--accent-negative-10)' }}>
            Rs. {netWorth.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <span>Monthly Income</span>
            <span style={{ color: 'var(--accent-positive-10)', fontSize: '0.75rem' }}>Total Cash Inflow</span>
          </div>
          <div className="card-value amount-positive">
            +Rs. {totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <span>Monthly Outflow</span>
            <span style={{ color: 'var(--accent-negative-10)', fontSize: '0.75rem' }}>Total Spending</span>
          </div>
          <div className="card-value amount-negative">
            -Rs. {totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* Main Budget Section */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '2rem', padding: '0 2rem' }}>
        {/* Hierarchical N-ary tree budget list */}
        <div className="card" style={{ gap: '1.25rem' }}>
          <h3 className="header-title" style={{ fontSize: '1.125rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            Hierarchical Budget Tree (N-ary Tree)
          </h3>
          
          <div style={{ border: '1px solid var(--border-color)', borderRadius: '6px', padding: '1rem', backgroundColor: 'var(--bg-color-60)', maxHeight: '420px', overflowY: 'auto' }}>
            {renderBudgetNodes(budgetTree.root)}
          </div>
        </div>

        {/* Action console for editing budget */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Add Budget Form */}
          <div className="card">
            <h3 className="header-title" style={{ fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
              Add Sub-Budget Node
            </h3>
            <form onSubmit={handleAddCategory}>
              <div className="form-group">
                <label className="form-label">Parent Category</label>
                <input 
                  list="parent-categories"
                  className="form-input"
                  value={selectedParentNode}
                  onChange={(e) => setSelectedParentNode(e.target.value)}
                  placeholder="Select or type parent category"
                  required
                />
                <datalist id="parent-categories">
                  {parentOptions.map(name => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>

              <div className="form-group">
                <label className="form-label">Category Name</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="e.g. Electricity, Dining"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Self Budget Allocation (Rs.)</label>
                <input 
                  type="number" 
                  className="form-input form-input-mono" 
                  value={newCategoryBudget}
                  onChange={(e) => setNewCategoryBudget(e.target.value)}
                  placeholder="e.g. 15000"
                />
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                <PlusIcon size={16} /> Add Node
              </button>
            </form>
          </div>

          {/* Create Bank / Credit Account Form */}
          <div className="card">
            <h3 className="header-title" style={{ fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
              Create Account
            </h3>
            <form onSubmit={handleCreateAccount}>
              <div className="form-group">
                <label className="form-label">Account Name</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={accName}
                  onChange={(e) => setAccName(e.target.value)}
                  placeholder="e.g. Checking Account, Visa"
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">Account Type</label>
                  <input 
                    list="account-types"
                    className="form-input"
                    value={accType}
                    onChange={(e) => setAccType(e.target.value as any)}
                    placeholder="e.g. Cash, Card"
                    required
                  />
                  <datalist id="account-types">
                    <option value="Cash" />
                    <option value="Card" />
                    <option value="Savings" />
                    <option value="Investment" />
                  </datalist>
                </div>

                <div className="form-group">
                  <label className="form-label">Initial Balance (Rs.)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    className="form-input form-input-mono" 
                    value={accBalance}
                    onChange={(e) => setAccBalance(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                <PlusIcon size={16} /> Create Account
              </button>
            </form>
          </div>

          {/* Urgent Alerts from Heap and Database */}
          <div className="card">
            <h3 className="header-title" style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: bills.length > 0 ? 'var(--accent-warning-10)' : 'var(--text-primary)' }}>
              <AlertIcon size={18} /> Active Alerts
            </h3>
            {bills.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  You have <span className="amount-value" style={{ fontSize: '0.875rem' }}>{bills.length}</span> unpaid bill(s) in your priority heap.
                </span>
                <div style={{ padding: '0.5rem', border: '1px solid var(--accent-warning-10)', borderRadius: '4px', backgroundColor: 'rgba(245, 158, 11, 0.05)', fontSize: '0.75rem' }}>
                  <strong>Most Urgent:</strong> {bills[0].name} (Due {bills[0].dueDate}) - ${bills[0].amount}
                </div>
              </div>
            ) : (
              <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                All systems green. No pending bills or credit limit overruns.
              </span>
            )}
          </div>

          {/* Paycheck Cycle Config Card */}
          <div className="card">
            <h3 className="header-title" style={{ fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
              Paycheck Cycle Config
            </h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              localStorage.setItem('paycheck_next_date', nextPayday);
              localStorage.setItem('paycheck_cycle', paycheckCycle);
              addDsaLog(`Paycheck: Saved cycle (${paycheckCycle}) next payday: ${nextPayday}`);
              alert("Paycheck settings saved!");
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">Next Payday</label>
                  <input 
                    type="date" 
                    className="form-input form-input-mono"
                    value={nextPayday}
                    onChange={(e) => setNextPayday(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Cycle Length</label>
                  <select 
                    className="form-input"
                    value={paycheckCycle}
                    onChange={(e) => setPaycheckCycle(e.target.value)}
                  >
                    <option value="weekly">Weekly</option>
                    <option value="bi-weekly">Bi-weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>
              <button type="submit" className="btn btn-secondary" style={{ width: '100%', marginTop: '0.5rem' }}>
                Save Payday Config
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
