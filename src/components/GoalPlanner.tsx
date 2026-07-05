import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Goal } from '../db';
import { allocateSavings } from '../dsa/SavingsAllocator';
import { PlusIcon } from '../icons';
import type { HistoryAction } from '../dsa/UndoStack';

interface GoalPlannerProps {
  onPushAction: (action: HistoryAction) => void;
  addDsaLog: (log: string) => void;
}

export const GoalPlanner: React.FC<GoalPlannerProps> = ({ onPushAction, addDsaLog }) => {
  const goals = useLiveQuery(() => db.goals.toArray()) || [];
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];

  // Goal Form State
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [priority, setPriority] = useState<'High' | 'Medium' | 'Low'>('Medium');

  // Allocation State
  const [monthlySurplus, setMonthlySurplus] = useState('500');

  // Manual Deposit State
  const [selectedGoalId, setSelectedGoalId] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [fundingAccountId, setFundingAccountId] = useState('');

  // Calculate allocations using custom algorithm
  const allocationReport = useMemo(() => {
    const surplusVal = parseFloat(monthlySurplus) || 0;
    const startTime = performance.now();
    const result = allocateSavings(goals, surplusVal);
    const endTime = performance.now();

    if (goals.length > 0 && surplusVal > 0) {
      addDsaLog(`Savings Allocator: Sorted and distributed $${surplusVal} across ${goals.length} goals in ${(endTime - startTime).toFixed(4)}ms.`);
    }

    return result;
  }, [goals, monthlySurplus]);

  // Add savings goal
  const handleAddGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetAmt = parseFloat(targetAmount);
    if (!name.trim() || isNaN(targetAmt) || targetAmt <= 0 || !targetDate) {
      alert("Please fill out all fields with valid details.");
      return;
    }

    const goalData: Goal = {
      name: name.trim(),
      targetAmount: targetAmt,
      currentAmount: 0,
      targetDate,
      priority
    };

    const addedId = await db.goals.add(goalData);

    const undoAction: HistoryAction = {
      type: 'add_goal',
      description: `Create Goal: ${goalData.name}`,
      undo: async () => {
        await db.goals.delete(addedId);
        addDsaLog(`Undo Stack: Removed savings goal '${goalData.name}'.`);
      },
      redo: async () => {
        await db.goals.put({ ...goalData, id: addedId });
        addDsaLog(`Undo Stack: Restored savings goal '${goalData.name}'.`);
      }
    };

    onPushAction(undoAction);
    addDsaLog(`Savings Allocator: Added new savings goal '${goalData.name}' with target $${targetAmt} due ${targetDate}.`);

    setName('');
    setTargetAmount('');
    setTargetDate('');
  };

  // Delete savings goal
  const handleDeleteGoal = async (id: number) => {
    const goal = await db.goals.get(id);
    if (!goal) return;

    await db.goals.delete(id);

    const undoAction: HistoryAction = {
      type: 'delete_goal',
      description: `Delete Goal: ${goal.name}`,
      undo: async () => {
        await db.goals.put({ ...goal, id });
        addDsaLog(`Undo Stack: Restored savings goal '${goal.name}'.`);
      },
      redo: async () => {
        await db.goals.delete(id);
        addDsaLog(`Undo Stack: Re-deleted savings goal '${goal.name}'.`);
      }
    };

    onPushAction(undoAction);
    addDsaLog(`Savings Allocator: Deleted goal '${goal.name}'.`);
  };

  // Deposit funds to Goal manually from checking/savings account
  const handleDepositToGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    const goalIdVal = parseInt(selectedGoalId);
    const amountVal = parseFloat(depositAmount);
    const accIdVal = parseInt(fundingAccountId);

    if (isNaN(goalIdVal) || isNaN(amountVal) || amountVal <= 0 || isNaN(accIdVal)) {
      alert("Please select a valid goal, account, and enter a deposit amount.");
      return;
    }

    const goal = await db.goals.get(goalIdVal);
    const acc = await db.accounts.get(accIdVal);

    if (!goal || !acc) return;

    if (acc.balance < amountVal) {
      alert("Insufficient funds in the selected funding account.");
      return;
    }

    await db.transaction('rw', [db.goals, db.accounts, db.transactions], async () => {
      // 1. Update goal balance
      await db.goals.update(goalIdVal, { currentAmount: goal.currentAmount + amountVal });

      // 2. Adjust account balance
      await db.accounts.update(accIdVal, { balance: acc.balance - amountVal });

      // 3. Log transfer
      const txId = await db.transactions.add({
        amount: amountVal,
        type: 'Transfer',
        category: 'Savings/Goal Deposit',
        sourceAccountId: accIdVal,
        date: new Date().toISOString().split('T')[0],
        description: `Funded Goal: ${goal.name}`,
        tags: ['savings', 'goal', goal.name.toLowerCase().replace(/\s+/g, '-')],
        currency: 'USD'
      });

      const undoAction: HistoryAction = {
        type: 'fund_goal',
        description: `Fund Goal '${goal.name}' with $${amountVal}`,
        undo: async () => {
          await db.transaction('rw', [db.goals, db.accounts, db.transactions], async () => {
            await db.goals.update(goalIdVal, { currentAmount: goal.currentAmount });
            await db.accounts.update(accIdVal, { balance: acc.balance });
            await db.transactions.delete(txId);
          });
          addDsaLog(`Undo Stack: Reverted $${amountVal} deposit to '${goal.name}' and restored checking account.`);
        },
        redo: async () => {
          await db.transaction('rw', [db.goals, db.accounts, db.transactions], async () => {
            await db.goals.update(goalIdVal, { currentAmount: goal.currentAmount + amountVal });
            await db.accounts.update(accIdVal, { balance: acc.balance - amountVal });
            await db.transactions.put({
              id: txId,
              amount: amountVal,
              type: 'Transfer',
              category: 'Savings/Goal Deposit',
              sourceAccountId: accIdVal,
              date: new Date().toISOString().split('T')[0],
              description: `Funded Goal: ${goal.name}`,
              tags: ['savings', 'goal', goal.name.toLowerCase().replace(/\s+/g, '-')],
              currency: 'USD'
            });
          });
          addDsaLog(`Undo Stack: Re-funded goal '${goal.name}' with $${amountVal}.`);
        }
      };

      onPushAction(undoAction);
      addDsaLog(`Savings Allocator: Deposited $${amountVal} from '${acc.name}' into goal '${goal.name}'.`);
    });

    setDepositAmount('');
  };

  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 2fr', gap: '2rem' }}>
        {/* Create Savings Goal */}
        <div className="card">
          <h3 className="header-title" style={{ fontSize: '1.125rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            Create Savings Goal
          </h3>
          <form onSubmit={handleAddGoal}>
            <div className="form-group">
              <label className="form-label">Goal Target Name</label>
              <input 
                type="text" 
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Down Payment, Europe Trip"
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="form-group">
                <label className="form-label">Target Goal ($)</label>
                <input 
                  type="number" 
                  className="form-input form-input-mono"
                  value={targetAmount}
                  onChange={(e) => setTargetAmount(e.target.value)}
                  placeholder="0.00"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Target Date</label>
                <input 
                  type="date" 
                  className="form-input"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Goal Weight / Priority</label>
              <select 
                className="form-input"
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
              >
                <option value="High">High Priority</option>
                <option value="Medium">Medium Priority</option>
                <option value="Low">Low Priority</option>
              </select>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
              <PlusIcon size={16} /> Save Goal
            </button>
          </form>
        </div>

        {/* Allocate Surplus Tool */}
        <div className="card" style={{ gap: '1.5rem' }}>
          <h3 className="header-title" style={{ fontSize: '1.125rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            Monthly Surplus Budget Allocator
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Enter your monthly net savings surplus. Our optimization algorithm sorts your goals by priority level and date deadlines, allocating funds to make sure High Priority items meet their deadlines first.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1rem', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Available Monthly Surplus (Rs.)</label>
              <input 
                type="number" 
                className="form-input form-input-mono"
                value={monthlySurplus}
                onChange={(e) => setMonthlySurplus(e.target.value)}
                placeholder="50000"
              />
            </div>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', paddingBottom: '0.5rem' }}>
              Allocating: <strong>Rs. {monthlySurplus} / mo</strong>
            </span>
          </div>

          {/* Allocation outputs */}
          {allocationReport.allocations.length > 0 && (
            <div style={{ border: '1px solid var(--border-color)', borderRadius: '6px', backgroundColor: 'var(--bg-color-60)', padding: '1rem' }}>
              <span className="form-label" style={{ fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>Optimized Distribution Summary</span>
              <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                    <th style={{ textAlign: 'left', paddingBottom: '0.25rem' }}>Goal</th>
                    <th style={{ textAlign: 'right', paddingBottom: '0.25rem' }}>Required</th>
                    <th style={{ textAlign: 'right', paddingBottom: '0.25rem' }}>Allocated</th>
                    <th style={{ textAlign: 'center', paddingBottom: '0.25rem' }}>Timeline</th>
                  </tr>
                </thead>
                <tbody>
                  {allocationReport.allocations.map(alloc => (
                    <tr key={alloc.goalId} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
                      <td style={{ padding: '0.375rem 0', fontWeight: 600 }}>{alloc.goalName}</td>
                      <td style={{ textAlign: 'right', padding: '0.375rem 0', fontFamily: 'var(--font-mono)' }}>Rs. {Math.round(alloc.requiredMonthly)}/mo</td>
                      <td style={{ textAlign: 'right', padding: '0.375rem 0', fontFamily: 'var(--font-mono)', color: alloc.status === 'Underfunded' ? 'var(--accent-negative-10)' : 'var(--accent-positive-10)', fontWeight: 600 }}>
                        Rs. {Math.round(alloc.allocatedAmount)}/mo
                      </td>
                      <td style={{ textAlign: 'center', padding: '0.375rem 0' }}>
                        <span className={`badge badge-${alloc.status === 'On Track' ? 'low' : 'high'}`} style={{ fontSize: '0.65rem', padding: '2px 4px' }}>
                          {alloc.monthsToComplete} mos
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {allocationReport.unallocated > 0 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--accent-positive-10)', marginTop: '0.75rem', fontWeight: 600 }}>
                  Leftover Cash: +Rs. {allocationReport.unallocated} unallocated.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Manual Deposit and Goals Status */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.25fr', gap: '2rem' }}>
        {/* Goals Progress Listing */}
        <div className="card">
          <h3 className="header-title" style={{ fontSize: '1.125rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            Savings Progress Tracker
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '0.5rem' }}>
            {goals.length > 0 ? (
              goals.map(goal => {
                const percent = Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100)) || 0;
                return (
                  <div key={goal.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <strong style={{ fontSize: '0.9rem' }}>{goal.name}</strong>
                        <span className={`badge badge-${goal.priority.toLowerCase()}`} style={{ fontSize: '0.65rem' }}>
                          {goal.priority}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>Rs. {goal.currentAmount}</span> of <span style={{ fontFamily: 'var(--font-mono)' }}>Rs. {goal.targetAmount}</span> ({percent}%)
                      </div>
                    </div>
                    {/* Progress bar container */}
                    <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden', display: 'flex' }}>
                      <div style={{ width: `${percent}%`, height: '100%', backgroundColor: 'var(--accent-positive-10)', transition: 'width 0.3s ease' }}></div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      <span>Target Date: {goal.targetDate}</span>
                      <button 
                        onClick={() => goal.id && handleDeleteGoal(goal.id)}
                        className="btn btn-secondary" 
                        style={{ padding: '0px 4px', color: 'var(--accent-negative-10)', borderColor: 'transparent', height: 'auto', fontSize: '0.7rem' }}
                      >
                        Delete Goal
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)', border: '1px dashed var(--border-color)', borderRadius: '6px' }}>
                No active savings goals recorded.
              </div>
            )}
          </div>
        </div>

        {/* Deposit Ledger Action */}
        <div className="card">
          <h3 className="header-title" style={{ fontSize: '1.125rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            Fund Goal (Manual Transfer)
          </h3>
          <form onSubmit={handleDepositToGoal} style={{ marginTop: '0.5rem' }}>
            <div className="form-group">
              <label className="form-label">Select Goal Target</label>
              <select 
                className="form-input"
                value={selectedGoalId}
                onChange={(e) => setSelectedGoalId(e.target.value)}
                required
              >
                <option value="">-- Choose Goal --</option>
                {goals.map(g => (
                  <option key={g.id} value={g.id}>{g.name} (Rs. {g.currentAmount}/Rs. {g.targetAmount})</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Source Checking/Savings Account</label>
              <select 
                className="form-input"
                value={fundingAccountId}
                onChange={(e) => setFundingAccountId(e.target.value)}
                required
              >
                <option value="">-- Choose Funding --</option>
                {accounts.filter(a => a.balance > 0).map(acc => (
                  <option key={acc.id} value={acc.id}>{acc.name} (Rs. {acc.balance})</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Deposit Amount (Rs.)</label>
              <input 
                type="number" 
                step="0.01" 
                className="form-input form-input-mono"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
              Transfer Funds to Goal
            </button>
          </form>
        </div>
      </div>

    </div>
  );
};
