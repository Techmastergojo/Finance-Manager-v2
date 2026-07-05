import React, { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Transaction } from '../db';
import { Trie } from '../dsa/Trie';
import { mergeSort, quickSort } from '../dsa/SortAlgorithms';
import { binarySearchRange } from '../dsa/SearchAlgorithms';
import { PlusIcon, TrashIcon } from '../icons';
import type { HistoryAction } from '../dsa/UndoStack';

interface TransactionsProps {
  onPushAction: (action: HistoryAction) => void;
  addDsaLog: (log: string) => void;
}

export const Transactions: React.FC<TransactionsProps> = ({ onPushAction, addDsaLog }) => {
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];
  const goals = useLiveQuery(() => db.goals.toArray()) || [];

  const [enableRoundUp, setEnableRoundUp] = useState(false);

  // Form State
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'Income' | 'Expense' | 'Transfer' | 'Debt Payoff'>('Expense');
  const [category, setCategory] = useState('');
  const [sourceAccountId, setSourceAccountId] = useState('');
  const [destAccountId, setDestAccountId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  // Autocomplete State
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Sorting & Filtering State
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'category'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [minAmountFilter, setMinAmountFilter] = useState('');
  const [maxAmountFilter, setMaxAmountFilter] = useState('');
  const [isFilterActive, setIsFilterActive] = useState(false);

  // Initialize Trie
  const trie = useMemo(() => new Trie(), []);

  // Re-build Trie whenever transactions list changes
  useEffect(() => {
    trie.clear();
    transactions.forEach(t => {
      trie.insert(t.description);
      trie.insert(t.category);
    });
  }, [transactions, trie]);

  // Autocomplete change handler
  const handleDescriptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDescription(val);
    if (val.trim()) {
      const matches = trie.autocomplete(val);
      setSuggestions(matches);
      addDsaLog(`Trie Search: Prefix autocomplete lookup for '${val}' matched [${matches.join(', ')}] in O(L) time.`);
    } else {
      setSuggestions([]);
    }
  };

  const selectSuggestion = (word: string) => {
    setDescription(word);
    setSuggestions([]);
  };

  const adjustAccountBalance = async (accountId: number, val: number) => {
    const acc = await db.accounts.get(accountId);
    if (acc) {
      await db.accounts.update(accountId, { balance: Number(acc.balance || 0) + Number(val || 0) });
    }
  };

  // Add transaction
  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountVal = parseFloat(amount);
    if (isNaN(amountVal) || amountVal <= 0) {
      alert("Please enter a valid amount greater than 0");
      return;
    }

    if (!category.trim()) {
      alert("Please enter a category");
      return;
    }

    // Validation checks according to transaction type
    const sId = sourceAccountId ? parseInt(sourceAccountId) : undefined;
    const dId = destAccountId ? parseInt(destAccountId) : undefined;

    if ((type === 'Expense' || type === 'Debt Payoff' || type === 'Transfer') && !sId) {
      alert("Source Account is required");
      return;
    }
    if ((type === 'Income' || type === 'Transfer') && !dId) {
      alert("Destination Account is required");
      return;
    }
    if (type === 'Transfer' && sId === dId) {
      alert("Source and Destination accounts cannot be the same");
      return;
    }

    const txData: Transaction = {
      amount: amountVal,
      type,
      category: category.trim(),
      sourceAccountId: sId,
      destAccountId: dId,
      date,
      description: description.trim(),
      tags: tagsInput.split(',').map(t => t.trim()).filter(Boolean),
      currency: 'USD'
    };

    await db.transaction('rw', [db.transactions, db.accounts, db.goals], async () => {
      const addedId = await db.transactions.add(txData);
      
      if (type === 'Income' && dId) {
        await adjustAccountBalance(dId, amountVal);
      } else if (type === 'Expense' && sId) {
        await adjustAccountBalance(sId, -amountVal);
      } else if (type === 'Debt Payoff' && sId) {
        await adjustAccountBalance(sId, -amountVal);
      } else if (type === 'Transfer' && sId && dId) {
        await adjustAccountBalance(sId, -amountVal);
        await adjustAccountBalance(dId, amountVal);
      }

      let roundUpTxId: number | undefined;
      const roundUpVal = Math.round((Math.ceil(amountVal) - amountVal) * 100) / 100;
      const eligibleGoals = goals.filter(g => g.id && g.currentAmount < g.targetAmount);
      const targetGoal = eligibleGoals.sort((a,b) => b.priority.localeCompare(a.priority))[0];

      if (type === 'Expense' && enableRoundUp && sId && roundUpVal > 0 && targetGoal && targetGoal.id) {
        await adjustAccountBalance(sId, -roundUpVal);
        await db.goals.update(targetGoal.id, { currentAmount: targetGoal.currentAmount + roundUpVal });
        roundUpTxId = await db.transactions.add({
          amount: roundUpVal,
          type: 'Transfer',
          category: 'Savings/Round-Up Sweep',
          sourceAccountId: sId,
          date,
          description: `Round-Up Sweep: ${txData.description}`,
          tags: ['round-up', 'savings'],
          currency: 'USD'
        });
      }

      const undoAction: HistoryAction = {
        type: 'add_transaction',
        description: `Add Transaction: ${txData.description} (Rs. ${amountVal})`,
        undo: async () => {
          await db.transaction('rw', [db.transactions, db.accounts, db.goals], async () => {
            await db.transactions.delete(addedId);
            if (type === 'Income' && dId) {
              await adjustAccountBalance(dId, -amountVal);
            } else if (type === 'Expense' && sId) {
              await adjustAccountBalance(sId, amountVal);
            } else if (type === 'Debt Payoff' && sId) {
              await adjustAccountBalance(sId, amountVal);
            } else if (type === 'Transfer' && sId && dId) {
              await adjustAccountBalance(sId, amountVal);
              await adjustAccountBalance(dId, -amountVal);
            }

            if (roundUpTxId && sId && targetGoal && targetGoal.id) {
              await db.transactions.delete(roundUpTxId);
              await adjustAccountBalance(sId, roundUpVal);
              const curGoal = await db.goals.get(targetGoal.id);
              if (curGoal) {
                await db.goals.update(targetGoal.id, { currentAmount: Math.max(0, curGoal.currentAmount - roundUpVal) });
              }
            }
          });
          addDsaLog(`Undo Stack: Reverted transaction and round-up sweep.`);
        },
        redo: async () => {
          await db.transaction('rw', [db.transactions, db.accounts, db.goals], async () => {
            await db.transactions.put({ ...txData, id: addedId });
            if (type === 'Income' && dId) {
              await adjustAccountBalance(dId, amountVal);
            } else if (type === 'Expense' && sId) {
              await adjustAccountBalance(sId, -amountVal);
            } else if (type === 'Debt Payoff' && sId) {
              await adjustAccountBalance(sId, -amountVal);
            } else if (type === 'Transfer' && sId && dId) {
              await adjustAccountBalance(sId, -amountVal);
              await adjustAccountBalance(dId, amountVal);
            }

            if (roundUpTxId && sId && targetGoal && targetGoal.id) {
              await db.transactions.put({
                id: roundUpTxId,
                amount: roundUpVal,
                type: 'Transfer',
                category: 'Savings/Round-Up Sweep',
                sourceAccountId: sId,
                date,
                description: `Round-Up Sweep: ${txData.description}`,
                tags: ['round-up', 'savings'],
                currency: 'USD'
              });
              await adjustAccountBalance(sId, -roundUpVal);
              const curGoal = await db.goals.get(targetGoal.id);
              if (curGoal) {
                await db.goals.update(targetGoal.id, { currentAmount: curGoal.currentAmount + roundUpVal });
              }
            }
          });
          addDsaLog(`Undo Stack: Redone transaction and round-up sweep.`);
        }
      };

      onPushAction(undoAction);
      addDsaLog(`Double-Entry: Logged transaction ${txData.description} ($${amountVal}) ${roundUpVal > 0 && enableRoundUp && targetGoal ? `and swept $${roundUpVal} round-up` : ''}.`);
    });

    // Reset Form
    setAmount('');
    setCategory('');
    setDescription('');
    setTagsInput('');
    setSuggestions([]);
  };

  // Delete transaction
  const handleDeleteTransaction = async (id: number) => {
    const tx = await db.transactions.get(id);
    if (!tx) return;

    const sId = tx.sourceAccountId;
    const dId = tx.destAccountId;
    const amountVal = tx.amount;
    const typeVal = tx.type;

    await db.transaction('rw', [db.transactions, db.accounts], async () => {
      await db.transactions.delete(id);
      
      // Reverse balance updates
      if (typeVal === 'Income' && dId) {
        await adjustAccountBalance(dId, -amountVal);
      } else if (typeVal === 'Expense' && sId) {
        await adjustAccountBalance(sId, amountVal);
      } else if (typeVal === 'Debt Payoff' && sId) {
        await adjustAccountBalance(sId, amountVal);
      } else if (typeVal === 'Transfer' && sId && dId) {
        await adjustAccountBalance(sId, amountVal);
        await adjustAccountBalance(dId, -amountVal);
      }

      // Setup Undo
      const undoAction: HistoryAction = {
        type: 'delete_transaction',
        description: `Delete Transaction: ${tx.description} ($${amountVal})`,
        undo: async () => {
          await db.transaction('rw', [db.transactions, db.accounts], async () => {
            await db.transactions.put({ ...tx, id });
            if (typeVal === 'Income' && dId) {
              await adjustAccountBalance(dId, amountVal);
            } else if (typeVal === 'Expense' && sId) {
              await adjustAccountBalance(sId, -amountVal);
            } else if (typeVal === 'Debt Payoff' && sId) {
              await adjustAccountBalance(sId, -amountVal);
            } else if (typeVal === 'Transfer' && sId && dId) {
              await adjustAccountBalance(sId, -amountVal);
              await adjustAccountBalance(dId, amountVal);
            }
          });
          addDsaLog(`Undo Stack: Restored deleted transaction '${tx.description}' and updated balances.`);
        },
        redo: async () => {
          await db.transaction('rw', [db.transactions, db.accounts], async () => {
            await db.transactions.delete(id);
            if (typeVal === 'Income' && dId) {
              await adjustAccountBalance(dId, -amountVal);
            } else if (typeVal === 'Expense' && sId) {
              await adjustAccountBalance(sId, amountVal);
            } else if (typeVal === 'Debt Payoff' && sId) {
              await adjustAccountBalance(sId, amountVal);
            } else if (typeVal === 'Transfer' && sId && dId) {
              await adjustAccountBalance(sId, amountVal);
              await adjustAccountBalance(dId, -amountVal);
            }
          });
          addDsaLog(`Undo Stack: Re-deleted transaction '${tx.description}'.`);
        }
      };

      onPushAction(undoAction);
      addDsaLog(`Double-Entry [Delete]: Removed transaction '${tx.description}' (Rs. ${amountVal}). Reverted balances.`);
    });
  };

  // Compile Sorted list using Custom Sort Algorithms
  const sortedTransactions = useMemo(() => {
    let list = [...transactions];

    const compareFn = (a: Transaction, b: Transaction): number => {
      if (sortBy === 'amount') {
        return a.amount - b.amount;
      } else if (sortBy === 'category') {
        return a.category.localeCompare(b.category);
      } else { // default date
        return a.date.localeCompare(b.date);
      }
    };

    if (sortBy === 'amount') {
      list = quickSort(list, compareFn);
    } else {
      list = mergeSort(list, compareFn);
    }

    if (sortOrder === 'desc') {
      list.reverse();
    }

    return list;
  }, [transactions, sortBy, sortOrder]);

  useEffect(() => {
    if (transactions.length > 0) {
      addDsaLog(`Sort Update: Organized ${transactions.length} items using ${sortBy === 'amount' ? 'Quick' : 'Merge'} Sort by '${sortBy}'.`);
    }
  }, [transactions.length, sortBy, sortOrder]);

  // Apply Binary Search Filter on Range of amounts
  const processedTransactions = useMemo(() => {
    if (!isFilterActive) return sortedTransactions;

    const minAmount = parseFloat(minAmountFilter) || 0;
    const maxAmount = parseFloat(maxAmountFilter) || Infinity;

    if (minAmount > maxAmount) return [];

    const listSortedByAmountAsc = quickSort([...transactions], (a, b) => a.amount - b.amount);

    const result = binarySearchRange(
      listSortedByAmountAsc,
      minAmount,
      maxAmount,
      (tx) => tx.amount
    );

    if (sortBy === 'amount') {
      return sortOrder === 'desc' ? [...result].reverse() : result;
    } else {
      const compareFn = (a: Transaction, b: Transaction): number => {
        if (sortBy === 'category') return a.category.localeCompare(b.category);
        return a.date.localeCompare(b.date);
      };
      const resorted = mergeSort(result, compareFn);
      return sortOrder === 'desc' ? resorted.reverse() : resorted;
    }
  }, [sortedTransactions, transactions, isFilterActive, minAmountFilter, maxAmountFilter, sortBy, sortOrder]);

  useEffect(() => {
    if (isFilterActive) {
      addDsaLog(`Binary Search: Filtered range query, returning ${processedTransactions.length} matching transactions.`);
    }
  }, [isFilterActive, minAmountFilter, maxAmountFilter, processedTransactions.length]);

  // CSV/JSON Export Backup
  const exportBackup = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
      transactions,
      accounts
    }, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `finance_ledger_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    addDsaLog("Data Export: Downloaded JSON ledger backup securely.");
  };

  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 2fr', gap: '2rem' }}>
        {/* Ledger Add Transaction Form */}
        <div className="card">
          <h3 className="header-title" style={{ fontSize: '1.125rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            Record Transaction (Double-Entry)
          </h3>
          <form onSubmit={handleAddTransaction}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="form-group">
                <label className="form-label">Transaction Type</label>
                <select 
                  className="form-input" 
                  value={type} 
                  onChange={(e) => setType(e.target.value as any)}
                >
                  <option value="Expense">Expense (-)</option>
                  <option value="Income">Income (+)</option>
                  <option value="Transfer">Transfer (⇅)</option>
                  <option value="Debt Payoff">Debt Payoff (↘)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Amount (Rs.)</label>
                <input 
                  type="number" 
                  step="0.01" 
                  className="form-input form-input-mono"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  required
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              {/* Conditional Account Fields */}
              {(type === 'Expense' || type === 'Debt Payoff' || type === 'Transfer') && (
                <div className="form-group">
                  <label className="form-label">Source Account (Debit)</label>
                  <select 
                    className="form-input"
                    value={sourceAccountId}
                    onChange={(e) => setSourceAccountId(e.target.value)}
                    required
                  >
                    <option value="">-- Select --</option>
                    {accounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} (Rs. {acc.balance})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {(type === 'Income' || type === 'Transfer') && (
                <div className="form-group">
                  <label className="form-label">Dest Account (Credit)</label>
                  <select 
                    className="form-input"
                    value={destAccountId}
                    onChange={(e) => setDestAccountId(e.target.value)}
                    required
                  >
                    <option value="">-- Select --</option>
                    {accounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} (Rs. {acc.balance})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div style={{ position: 'relative' }} className="form-group">
              <label className="form-label">Payee / Description</label>
              <input 
                type="text" 
                className="form-input"
                value={description}
                onChange={handleDescriptionChange}
                placeholder="e.g. Walmart, landlord, ACME Corp"
                autoComplete="off"
                required
              />
              {/* Trie Autocomplete Suggestion Dropdown */}
              {suggestions.length > 0 && (
                <ul className="suggestions-box">
                  {suggestions.map((item, idx) => (
                    <li 
                      key={idx} 
                      onClick={() => selectSuggestion(item)}
                      className="suggestion-item"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="form-group">
                <label className="form-label">Category</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Food/Groceries, Housing/Rent"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Date</label>
                <input 
                  type="date" 
                  className="form-input"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Tags (comma-separated)</label>
              <input 
                type="text" 
                className="form-input"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="e.g. essential, weekly, utilities"
              />
            </div>

            {type === 'Expense' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', marginTop: '0.25rem' }}>
                <input 
                  type="checkbox" 
                  id="enableRoundUp"
                  checked={enableRoundUp}
                  onChange={(e) => setEnableRoundUp(e.target.checked)}
                  style={{ width: 'auto', cursor: 'pointer' }}
                />
                <label htmlFor="enableRoundUp" className="form-label" style={{ margin: 0, cursor: 'pointer', fontSize: '0.8rem', userSelect: 'none' }}>
                  Enable Spare Change Round-Up (Sweeps to Savings Goals)
                </label>
              </div>
            )}

            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
              <PlusIcon size={16} /> Save Record
            </button>
          </form>
        </div>

        {/* Ledger Control panel, Sorting, and Binary Search filters */}
        <div className="card" style={{ gap: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            <h3 className="header-title" style={{ fontSize: '1.125rem' }}>
              Search Filters & Tools
            </h3>
            <button onClick={exportBackup} className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem' }}>
              Export Backup
            </button>
          </div>

          {/* Sorting controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <span className="form-label">Sort Transactions By</span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {(['date', 'amount', 'category'] as const).map(column => (
                <button
                  key={column}
                  onClick={() => {
                    if (sortBy === column) {
                      setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
                    } else {
                      setSortBy(column);
                      setSortOrder('desc');
                    }
                  }}
                  className={`btn ${sortBy === column ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ textTransform: 'capitalize', flexGrow: 1 }}
                >
                  {column} {sortBy === column ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
                </button>
              ))}
            </div>
          </div>

          {/* Binary Search Filter form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '6px', backgroundColor: 'var(--bg-color-60)' }}>
            <span className="form-label" style={{ fontWeight: 600 }}>Amount Range Lookup (Binary Search)</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <input 
                  type="number" 
                  className="form-input form-input-mono" 
                  value={minAmountFilter}
                  onChange={(e) => setMinAmountFilter(e.target.value)}
                  placeholder="Min Amount"
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <input 
                  type="number" 
                  className="form-input form-input-mono" 
                  value={maxAmountFilter}
                  onChange={(e) => setMaxAmountFilter(e.target.value)}
                  placeholder="Max Amount"
                />
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button 
                onClick={() => setIsFilterActive(true)}
                className="btn btn-primary"
                style={{ flexGrow: 1 }}
                disabled={!minAmountFilter && !maxAmountFilter}
              >
                Apply Range Filter
              </button>
              <button 
                onClick={() => {
                  setIsFilterActive(false);
                  setMinAmountFilter('');
                  setMaxAmountFilter('');
                }}
                className="btn btn-secondary"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Transaction Log Table */}
      <div className="card">
        <h3 className="header-title" style={{ fontSize: '1.125rem' }}>
          Ledger Entry Log ({processedTransactions.length} records shown)
        </h3>
        
        {processedTransactions.length > 0 ? (
          <div className="table-container">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Type</th>
                  <th>Route</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th style={{ width: '50px' }}></th>
                </tr>
              </thead>
              <tbody>
                {processedTransactions.map(tx => {
                  const sourceName = accounts.find(a => a.id === tx.sourceAccountId)?.name || '';
                  const destName = accounts.find(a => a.id === tx.destAccountId)?.name || '';
                  
                  let routeStr = '';
                  if (tx.type === 'Income') routeStr = `➡ ${destName}`;
                  else if (tx.type === 'Expense') routeStr = `${sourceName} ➡`;
                  else if (tx.type === 'Transfer') routeStr = `${sourceName} ➡ ${destName}`;
                  else if (tx.type === 'Debt Payoff') routeStr = `${sourceName} ➡ Liability`;

                  return (
                    <tr key={tx.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{tx.date}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{tx.description}</div>
                        {tx.tags && tx.tags.length > 0 && (
                          <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem' }}>
                            {tx.tags.map(t => (
                              <span key={t} style={{ fontSize: '0.65rem', padding: '1px 4px', border: '1px solid var(--border-color)', borderRadius: '3px', color: 'var(--text-secondary)' }}>
                                #{t}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <span style={{ fontSize: '0.8rem', padding: '2px 6px', backgroundColor: 'var(--border-color)', borderRadius: '4px', color: 'var(--text-secondary)' }}>
                          {tx.category}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600, fontSize: '0.75rem' }}>{tx.type}</span>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{routeStr}</td>
                      <td className={`amount-value ${tx.type === 'Income' ? 'amount-positive' : 'amount-negative'}`}>
                        {tx.type === 'Income' ? '+' : '-'}Rs. {tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td>
                        <button
                          onClick={() => tx.id && handleDeleteTransaction(tx.id)}
                          className="btn btn-secondary"
                          style={{ padding: '4px 6px', color: 'var(--accent-negative-10)', borderColor: 'transparent' }}
                          title="Delete record"
                        >
                          <TrashIcon size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)', border: '1px dashed var(--border-color)', borderRadius: '6px' }}>
            No transaction records found matching your filter parameters.
          </div>
        )}
      </div>

    </div>
  );
};
