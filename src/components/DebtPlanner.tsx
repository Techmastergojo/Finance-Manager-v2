import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Debt } from '../db';
import { MinHeap } from '../dsa/MinHeap';
import { PlusIcon, TrashIcon, AlertIcon } from '../icons';
import type { HistoryAction } from '../dsa/UndoStack';

interface DebtPlannerProps {
  onPushAction: (action: HistoryAction) => void;
  addDsaLog: (log: string) => void;
}

interface PayoffSummary {
  months: number;
  totalInterest: number;
  schedule: Array<{
    month: number;
    payments: { [name: string]: number };
    balances: { [name: string]: number };
    totalRemaining: number;
  }>;
}

export const DebtPlanner: React.FC<DebtPlannerProps> = ({ onPushAction, addDsaLog }) => {
  const debts = useLiveQuery(() => db.debts.toArray()) || [];

  const [name, setName] = useState('');
  const [principal, setPrincipal] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [minPayment, setMinPayment] = useState('');
  
  const [strategy, setStrategy] = useState<'avalanche' | 'snowball'>('avalanche');
  const [extraPayment, setExtraPayment] = useState('200');

  const handleAddDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    const pVal = parseFloat(principal);
    const rVal = parseFloat(interestRate);
    const mVal = parseFloat(minPayment);

    if (!name.trim() || isNaN(pVal) || pVal <= 0 || isNaN(rVal) || rVal < 0 || isNaN(mVal) || mVal <= 0) {
      alert("Please enter valid details.");
      return;
    }

    const newDebt: Debt = {
      name: name.trim(),
      principal: pVal,
      interestRate: rVal,
      minPayment: mVal,
      monthlyAllocation: 0
    };

    const addedId = await db.debts.add(newDebt);

    const undoAction: HistoryAction = {
      type: 'add_debt',
      description: `Add Debt: ${newDebt.name}`,
      undo: async () => {
        await db.debts.delete(addedId);
        addDsaLog(`Undo: Removed debt '${newDebt.name}'.`);
      },
      redo: async () => {
        await db.debts.put({ ...newDebt, id: addedId });
        addDsaLog(`Undo: Restored debt '${newDebt.name}'.`);
      }
    };

    onPushAction(undoAction);
    addDsaLog(`Debt Planner: Logged liability '${newDebt.name}' ($${pVal} at ${rVal}%).`);

    setName('');
    setPrincipal('');
    setInterestRate('');
    setMinPayment('');
  };

  const handleDeleteDebt = async (id: number) => {
    const debt = await db.debts.get(id);
    if (!debt) return;

    await db.debts.delete(id);

    const undoAction: HistoryAction = {
      type: 'delete_debt',
      description: `Delete Debt: ${debt.name}`,
      undo: async () => {
        await db.debts.put({ ...debt, id });
        addDsaLog(`Undo: Restored debt '${debt.name}'.`);
      },
      redo: async () => {
        await db.debts.delete(id);
        addDsaLog(`Undo: Re-deleted debt '${debt.name}'.`);
      }
    };

    onPushAction(undoAction);
    addDsaLog(`Debt Planner: Removed debt '${debt.name}'.`);
  };

  const totalMinPayment = useMemo(() => {
    return debts.reduce((sum, d) => sum + d.minPayment, 0);
  }, [debts]);

  const simulatePayoff = (debtsList: Debt[], strat: 'avalanche' | 'snowball', extraAmount: number): PayoffSummary => {
    if (debtsList.length === 0) {
      return { months: 0, totalInterest: 0, schedule: [] };
    }

    const workingDebts = debtsList.map(d => ({
      name: d.name,
      balance: d.principal,
      rate: d.interestRate,
      min: d.minPayment
    }));

    const schedule: PayoffSummary['schedule'] = [];
    let totalInterest = 0;
    let month = 0;

    while (workingDebts.some(d => d.balance > 0) && month < 360) {
      month++;
      
      const heap = new MinHeap<{ name: string; balance: number; rate: number; min: number }>((a, b) => {
        if (strat === 'avalanche') {
          return b.rate - a.rate;
        } else {
          return a.balance - b.balance;
        }
      });

      workingDebts.filter(d => d.balance > 0).forEach(d => heap.push(d));

      const monthlyPayments: { [name: string]: number } = {};
      const monthlyBalances: { [name: string]: number } = {};
      
      let allocatedExtra = extraAmount;
      const activePops: typeof workingDebts = [];
      while (heap.size() > 0) {
        const d = heap.pop();
        if (d) activePops.push(d);
      }

      for (const d of activePops) {
        const interest = d.balance * ((d.rate / 100) / 12);
        totalInterest += interest;
        d.balance += interest;
        
        const minToPay = Math.min(d.balance, d.min);
        d.balance -= minToPay;
        monthlyPayments[d.name] = minToPay;
      }

      for (const d of activePops) {
        if (d.balance > 0 && allocatedExtra > 0) {
          const extraToPay = Math.min(d.balance, allocatedExtra);
          d.balance -= extraToPay;
          allocatedExtra -= extraToPay;
          monthlyPayments[d.name] = (monthlyPayments[d.name] || 0) + extraToPay;
        }
        monthlyBalances[d.name] = d.balance;
      }

      const totalRemaining = workingDebts.reduce((sum, d) => sum + d.balance, 0);

      schedule.push({
        month,
        payments: monthlyPayments,
        balances: monthlyBalances,
        totalRemaining
      });
    }

    return {
      months: month,
      totalInterest,
      schedule
    };
  };

  const simulationResults = useMemo(() => {
    const extraVal = parseFloat(extraPayment) || 0;
    
    const startTime = performance.now();
    const current = simulatePayoff(debts, strategy, extraVal);
    const endTime = performance.now();

    const otherStrat = strategy === 'avalanche' ? 'snowball' : 'avalanche';
    const alt = simulatePayoff(debts, otherStrat, extraVal);

    if (debts.length > 0) {
      addDsaLog(`Priority Queue Solver: Simulated ${strategy} strategy in ${(endTime - startTime).toFixed(4)}ms.`);
    }

    return {
      current,
      alt,
      savedInterest: Math.max(0, alt.totalInterest - current.totalInterest),
      freedMonths: Math.max(0, alt.months - current.months)
    };
  }, [debts, strategy, extraPayment]);

  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 2fr', gap: '2rem' }}>
        
        <div className="card">
          <h3 className="header-title" style={{ fontSize: '1.125rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            Add Debt liability
          </h3>
          <form onSubmit={handleAddDebt}>
            <div className="form-group">
              <label className="form-label">Debt Name</label>
              <input 
                type="text" 
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Student Loan, Car Loan"
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="form-group">
                <label className="form-label">Principal Amount (Rs.)</label>
                <input 
                  type="number" 
                  className="form-input form-input-mono"
                  value={principal}
                  onChange={(e) => setPrincipal(e.target.value)}
                  placeholder="0.00"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Interest Rate (% APR)</label>
                <input 
                  type="number" 
                  step="0.01"
                  className="form-input form-input-mono"
                  value={interestRate}
                  onChange={(e) => setInterestRate(e.target.value)}
                  placeholder="e.g. 5.5"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Minimum Monthly Payment (Rs.)</label>
              <input 
                type="number" 
                className="form-input form-input-mono"
                value={minPayment}
                onChange={(e) => setMinPayment(e.target.value)}
                placeholder="e.g. 150"
                required
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
              <PlusIcon size={16} /> Save Liability
            </button>
          </form>
        </div>

        <div className="card" style={{ gap: '1.25rem' }}>
          <h3 className="header-title" style={{ fontSize: '1.125rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            Paydown Strategy Controls
          </h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1.5rem' }}>
            <div>
              <span className="form-label">Select Prioritization Strategy</span>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  onClick={() => setStrategy('avalanche')}
                  className={`btn ${strategy === 'avalanche' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flexGrow: 1 }}
                >
                  Avalanche (Rate Focus)
                </button>
                <button
                  onClick={() => setStrategy('snowball')}
                  className={`btn ${strategy === 'snowball' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flexGrow: 1 }}
                >
                  Snowball (Balance Focus)
                </button>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.75rem' }}>
                {strategy === 'avalanche' 
                  ? "Avalanche priority ranks debts from highest interest rate to lowest. It is mathematically optimized to minimize total interest paid."
                  : "Snowball priority ranks debts from lowest outstanding balance to highest. It provides rapid psychological wins as smaller accounts close."}
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">Extra Monthly Payment (Rs.)</label>
              <input 
                type="number" 
                className="form-input form-input-mono"
                value={extraPayment}
                onChange={(e) => setExtraPayment(e.target.value)}
                placeholder="e.g. 20000"
              />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.5rem', display: 'block' }}>
                Total Monthly Minimums: <strong>Rs. {totalMinPayment}</strong><br/>
                Total Outlay: <strong>Rs. {totalMinPayment + (parseFloat(extraPayment) || 0)}/mo</strong>
              </span>
            </div>
          </div>

          {debts.length > 0 && (
            <div style={{ border: '1px solid var(--border-color)', borderRadius: '6px', backgroundColor: 'var(--bg-color-60)', padding: '1rem', display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
              <AlertIcon size={28} style={{ color: 'var(--accent-positive-10)', flexShrink: 0 }} />
              <div style={{ fontSize: '0.85rem' }}>
                {strategy === 'avalanche' ? (
                  <span>
                    By choosing <strong>Avalanche</strong> instead of Snowball, you will save{' '}
                    <strong style={{ color: 'var(--accent-positive-10)' }}>
                      Rs. {Math.round(simulationResults.savedInterest).toLocaleString()}
                    </strong>{' '}
                    in interest and be debt-free{' '}
                    <strong>{simulationResults.freedMonths} months</strong> sooner!
                  </span>
                ) : (
                  <span>
                    By choosing <strong>Snowball</strong>, you pay{' '}
                    <strong style={{ color: 'var(--accent-negative-10)' }}>
                      Rs. {Math.round(Math.abs(simulationResults.savedInterest)).toLocaleString()}
                    </strong>{' '}
                    more in interest, but close small accounts{' '}
                    <strong>{Math.abs(simulationResults.freedMonths)} months</strong> faster/slower.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h3 className="header-title" style={{ fontSize: '1.125rem' }}>
          Outstanding Liabilities
        </h3>
        {debts.length > 0 ? (
          <div className="table-container">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Debt Name</th>
                  <th>Principal Balance</th>
                  <th>Interest Rate (APR)</th>
                  <th>Minimum Payment</th>
                  <th style={{ width: '50px' }}></th>
                </tr>
              </thead>
              <tbody>
                {debts.map(d => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 600 }}>{d.name}</td>
                    <td className="amount-value" style={{ textAlign: 'left' }}>
                      Rs. {d.principal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="amount-value" style={{ textAlign: 'left' }}>{d.interestRate}%</td>
                    <td className="amount-value" style={{ textAlign: 'left' }}>Rs. {d.minPayment}</td>
                    <td>
                      <button
                        onClick={() => d.id && handleDeleteDebt(d.id)}
                        className="btn btn-secondary"
                        style={{ padding: '4px 6px', color: 'var(--accent-negative-10)', borderColor: 'transparent' }}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)', border: '1px dashed var(--border-color)', borderRadius: '6px' }}>
            No liabilities logged. You are completely debt-free!
          </div>
        )}
      </div>

      {debts.length > 0 && simulationResults.current.schedule.length > 0 && (
        <div className="card">
          <h3 className="header-title" style={{ fontSize: '1.125rem' }}>
            Payoff Projection Timeline ({strategy === 'avalanche' ? 'Avalanche' : 'Snowball'} Mode)
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Estimated debt-free timeline: <strong>{simulationResults.current.months} months</strong>. Projected interest costs: <strong>Rs. {Math.round(simulationResults.current.totalInterest).toLocaleString()}</strong>.
          </p>
          <div className="table-container" style={{ maxHeight: '300px', overflowY: 'auto' }}>
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Month</th>
                  {debts.map(d => (
                    <th key={d.id} style={{ textAlign: 'right' }}>{d.name} Paid</th>
                  ))}
                  <th style={{ textAlign: 'right' }}>Remaining Total</th>
                </tr>
              </thead>
              <tbody>
                {simulationResults.current.schedule.filter((_, idx) => idx % 3 === 0 || idx === simulationResults.current.schedule.length - 1).map(row => (
                  <tr key={row.month}>
                    <td>Month {row.month}</td>
                    {debts.map(d => (
                      <td key={d.id} className="amount-value" style={{ color: (row.payments[d.name] || 0) > 0 ? 'var(--accent-positive-10)' : 'var(--text-muted)' }}>
                        Rs. {Math.round(row.payments[d.name] || 0).toLocaleString()}
                      </td>
                    ))}
                    <td className="amount-value" style={{ fontWeight: 700 }}>
                      Rs. {Math.round(row.totalRemaining).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
};
