import React, { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Bill } from '../db';
import { MinHeap } from '../dsa/MinHeap';
import { PlusIcon, CheckIcon } from '../icons';
import type { HistoryAction } from '../dsa/UndoStack';

interface BillTrackerProps {
  onPushAction: (action: HistoryAction) => void;
  addDsaLog: (log: string) => void;
}

export const BillTracker: React.FC<BillTrackerProps> = ({ onPushAction, addDsaLog }) => {
  const bills = useLiveQuery(() => db.bills.toArray()) || [];
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];

  // Form State
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<'High' | 'Medium' | 'Low'>('Medium');
  const [payFromAccountId, setPayFromAccountId] = useState('');
  const [heapArray, setHeapArray] = useState<string[]>([]);

  // Instantiate heap
  const billHeap = useMemo(() => {
    // Heap comparator: Sort primary by due date, secondary by priority weight
    return new MinHeap<Bill>((a, b) => {
      const dateA = new Date(a.dueDate).getTime();
      const dateB = new Date(b.dueDate).getTime();
      if (dateA !== dateB) return dateA - dateB;

      const weight = { High: 1, Medium: 2, Low: 3 };
      return weight[a.priority] - weight[b.priority];
    });
  }, []);

  useEffect(() => {
    billHeap.clear();
    const pending = bills.filter(b => b.isPaid === 0);
    pending.forEach(b => billHeap.push(b));
    setHeapArray(billHeap.toArray().map(b => `${b.name} (${b.priority})`));
  }, [bills, billHeap]);

  // Extract bills in heap order for display (Heap Sort)
  const sortedBills = useMemo(() => {
    const list: Bill[] = [];
    const tempHeap = new MinHeap<Bill>((a, b) => {
      const dateA = new Date(a.dueDate).getTime();
      const dateB = new Date(b.dueDate).getTime();
      if (dateA !== dateB) return dateA - dateB;
      const weight = { High: 1, Medium: 2, Low: 3 };
      return weight[a.priority] - weight[b.priority];
    });
    
    const currentArray = billHeap.toArray();
    currentArray.forEach(item => tempHeap.push(item));

    while (tempHeap.size() > 0) {
      const item = tempHeap.pop();
      if (item) list.push(item);
    }
    return list;
  }, [bills, billHeap]);

  useEffect(() => {
    if (sortedBills.length > 0) {
      addDsaLog(`Heap Sort: Extracted ${sortedBills.length} pending bills in priority order.`);
    }
  }, [sortedBills.length]);

  // Add bill
  const handleAddBill = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountVal = parseFloat(amount);
    if (!name.trim() || isNaN(amountVal) || amountVal <= 0 || !dueDate) {
      alert("Please fill out all fields with valid details.");
      return;
    }

    const billData: Bill = {
      name: name.trim(),
      amount: amountVal,
      dueDate,
      isPaid: 0,
      priority
    };

    const addedId = await db.bills.add(billData);
    
    const undoAction: HistoryAction = {
      type: 'add_bill',
      description: `Create Bill Alert: ${billData.name}`,
      undo: async () => {
        await db.bills.delete(addedId);
        addDsaLog(`Undo Stack: Removed bill alert '${billData.name}'.`);
      },
      redo: async () => {
        await db.bills.put({ ...billData, id: addedId });
        addDsaLog(`Undo Stack: Restored bill alert '${billData.name}'.`);
      }
    };

    onPushAction(undoAction);
    addDsaLog(`Min-Heap: Pushed new bill '${billData.name}' due ${dueDate} into Priority Queue.`);

    // Reset fields
    setName('');
    setAmount('');
    setDueDate('');
  };

  // Pay bill: Marks bill as paid and records double-entry expense transaction
  const handlePayBill = async (billId: number) => {
    const accId = parseInt(payFromAccountId);
    if (isNaN(accId)) {
      alert("Please select a checking or savings account to pay this bill from.");
      return;
    }

    const bill = await db.bills.get(billId);
    const acc = await db.accounts.get(accId);

    if (!bill || !acc) return;

    if (acc.balance < bill.amount) {
      const confirmPay = window.confirm(`Warning: Paying this bill (Rs. ${bill.amount}) will overdraft your ${acc.name} (Balance: Rs. ${acc.balance}). Proceed?`);
      if (!confirmPay) return;
    }

    // Execute payment inside DB transaction
    await db.transaction('rw', [db.bills, db.transactions, db.accounts], async () => {
      // 1. Mark bill as paid
      await db.bills.update(billId, { isPaid: 1 });
      
      // 2. Adjust account balance
      await db.accounts.update(accId, { balance: acc.balance - bill.amount });

      // 3. Add to transaction log
      const txData = {
        amount: bill.amount,
        type: 'Expense' as const,
        category: `Bills/${bill.priority} Priority`,
        sourceAccountId: accId,
        date: new Date().toISOString().split('T')[0],
        description: `Payment for bill: ${bill.name}`,
        tags: ['bills', 'paid', bill.priority.toLowerCase()],
        currency: 'USD'
      };
      const txId = await db.transactions.add(txData);

      // Setup Undo
      const undoAction: HistoryAction = {
        type: 'pay_bill',
        description: `Pay Bill: ${bill.name} ($${bill.amount})`,
        undo: async () => {
          await db.transaction('rw', [db.bills, db.transactions, db.accounts], async () => {
            await db.bills.update(billId, { isPaid: 0 });
            await db.accounts.update(accId, { balance: acc.balance }); // Restore account
            await db.transactions.delete(txId); // Delete log entry
          });
          addDsaLog(`Undo Stack: Unpaid bill '${bill.name}', restored account balance, and deleted transaction log.`);
        },
        redo: async () => {
          await db.transaction('rw', [db.bills, db.transactions, db.accounts], async () => {
            await db.bills.update(billId, { isPaid: 1 });
            await db.accounts.update(accId, { balance: acc.balance - bill.amount });
            await db.transactions.put({ ...txData, id: txId });
          });
          addDsaLog(`Undo Stack: Re-paid bill '${bill.name}' and deducted account.`);
        }
      };

      onPushAction(undoAction);
      addDsaLog(`Priority Queue: Paid '${bill.name}' ($${bill.amount}). Popped from Min-Heap. Recorded double-entry expense.`);
    });
  };

  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 2fr', gap: '2rem' }}>
        {/* Bill Registration */}
        <div className="card">
          <h3 className="header-title" style={{ fontSize: '1.125rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            Register Pending Bill
          </h3>
          <form onSubmit={handleAddBill}>
            <div className="form-group">
              <label className="form-label">Bill Name</label>
              <input 
                type="text" 
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Electricity, Water, Rent"
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="form-group">
                <label className="form-label">Amount ($)</label>
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

              <div className="form-group">
                <label className="form-label">Due Date</label>
                <input 
                  type="date" 
                  className="form-input"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Urgency Priority</label>
              <select 
                className="form-input"
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
              >
                <option value="High">High Priority (Urgent)</option>
                <option value="Medium">Medium Priority</option>
                <option value="Low">Low Priority (Flexible)</option>
              </select>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
              <PlusIcon size={16} /> Register Alert
            </button>
          </form>
        </div>

        {/* Binary Heap Visualizer */}
        <div className="card" style={{ gap: '1rem' }}>
          <h3 className="header-title" style={{ fontSize: '1.125rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            Min-Heap Priority Queue Visualizer
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            This panel shows the physical memory representation of the binary min-heap array. Due dates closest to today sit near index 0. Children of index <code>i</code> are located at <code>2i + 1</code> and <code>2i + 2</code>.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
            <span className="form-label" style={{ fontWeight: 600 }}>Internal Binary Heap Array</span>
            {heapArray.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {heapArray.map((item, idx) => (
                  <div 
                    key={idx} 
                    style={{ 
                      padding: '0.375rem 0.75rem', 
                      backgroundColor: idx === 0 ? 'rgba(225, 29, 72, 0.1)' : 'var(--bg-color-60)', 
                      border: `1px solid ${idx === 0 ? 'var(--accent-negative-10)' : 'var(--border-color)'}`,
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontFamily: 'var(--font-mono)'
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)', marginRight: '0.25rem' }}>[{idx}]</span>
                    {item}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-secondary)', border: '1px dashed var(--border-color)', borderRadius: '6px' }}>
                Priority heap is currently empty.
              </div>
            )}

            {/* Pay Account Select */}
            <div className="form-group" style={{ marginTop: '0.5rem' }}>
              <label className="form-label" style={{ fontWeight: 600 }}>Pay From Account (Deduction Source)</label>
              <select 
                className="form-input"
                value={payFromAccountId}
                onChange={(e) => setPayFromAccountId(e.target.value)}
              >
                <option value="">-- Choose Account --</option>
                {accounts.filter(a => a.balance > 0).map(acc => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} (Rs. {acc.balance})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Bill Priority List */}
      <div className="card">
        <h3 className="header-title" style={{ fontSize: '1.125rem' }}>
          Payment Queue (Sorted by Urgency)
        </h3>

        {sortedBills.length > 0 ? (
          <div className="table-container">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Bill Name</th>
                  <th>Due Date</th>
                  <th>Priority</th>
                  <th style={{ textAlign: 'right' }}>Amount (Rs.)</th>
                  <th style={{ width: '120px' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedBills.map((bill, index) => {
                  const isTopUrgent = index === 0;
                  return (
                    <tr key={bill.id} style={{ backgroundColor: isTopUrgent ? 'rgba(245, 158, 11, 0.02)' : 'transparent' }}>
                      <td style={{ fontWeight: 600, color: isTopUrgent ? 'var(--accent-warning-10)' : 'var(--text-muted)' }}>
                        #{index + 1} {isTopUrgent ? '⏳' : ''}
                      </td>
                      <td style={{ fontWeight: 600 }}>{bill.name}</td>
                      <td>{bill.dueDate}</td>
                      <td>
                        <span className={`badge badge-${bill.priority.toLowerCase()}`}>
                          {bill.priority}
                        </span>
                      </td>
                      <td className="amount-value" style={{ fontWeight: 700 }}>
                        Rs. {bill.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td>
                        <button
                          onClick={() => bill.id && handlePayBill(bill.id)}
                          className="btn btn-primary"
                          style={{ 
                            padding: '3px 10px', 
                            fontSize: '0.75rem', 
                            backgroundColor: isTopUrgent ? 'var(--accent-negative-10)' : 'var(--brand-color-30)'
                          }}
                          disabled={!payFromAccountId}
                        >
                          <CheckIcon size={12} /> Pay
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
            No pending bills. You are fully debt-free and clear!
          </div>
        )}
      </div>

    </div>
  );
};
