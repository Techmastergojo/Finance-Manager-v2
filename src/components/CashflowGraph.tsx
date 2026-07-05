import React, { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { CurrencyGraph, TransactionAuditGraph } from '../dsa/GraphAlgorithms';
import { GraphIcon, AlertIcon, CheckIcon } from '../icons';

interface CashflowGraphProps {
  addDsaLog: (log: string) => void;
}

export const CashflowGraph: React.FC<CashflowGraphProps> = ({ addDsaLog }) => {
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];

  // Dijkstra State
  const [fromCurrency, setFromCurrency] = useState('USD');
  const [toCurrency, setToCurrency] = useState('GBP');
  const [amountToConvert, setAmountToConvert] = useState('100');
  const [conversionResult, setConversionResult] = useState<{ path: string[]; rate: number; result: number } | null>(null);

  const [rates, setRates] = useState([
    { from: 'USD', to: 'EUR', rate: 0.92 },
    { from: 'EUR', to: 'USD', rate: 1.08 },
    { from: 'EUR', to: 'GBP', rate: 0.85 },
    { from: 'GBP', to: 'EUR', rate: 1.18 },
    { from: 'USD', to: 'GBP', rate: 0.76 },
    { from: 'GBP', to: 'USD', rate: 1.32 },
    { from: 'USD', to: 'PKR', rate: 278.0 },
    { from: 'GBP', to: 'PKR', rate: 355.0 },
    { from: 'EUR', to: 'PKR', rate: 302.0 }
  ]);

  useEffect(() => {
    const fetchLiveRates = async () => {
      try {
        const response = await fetch('https://open.er-api.com/v6/latest/USD');
        if (!response.ok) throw new Error('API failed');
        const data = await response.json();
        
        const usdToEur = data.rates.EUR || 0.92;
        const usdToGbp = data.rates.GBP || 0.76;
        const usdToPkr = data.rates.PKR || 278.0;

        const eurToUsd = 1 / usdToEur;
        const gbpToUsd = 1 / usdToGbp;

        const eurToGbp = usdToGbp / usdToEur;
        const gbpToEur = usdToEur / usdToGbp;

        const eurToPkr = usdToPkr / usdToEur;
        const gbpToPkr = usdToPkr / usdToGbp;

        setRates([
          { from: 'USD', to: 'EUR', rate: parseFloat(usdToEur.toFixed(4)) },
          { from: 'EUR', to: 'USD', rate: parseFloat(eurToUsd.toFixed(4)) },
          { from: 'EUR', to: 'GBP', rate: parseFloat(eurToGbp.toFixed(4)) },
          { from: 'GBP', to: 'EUR', rate: parseFloat(gbpToEur.toFixed(4)) },
          { from: 'USD', to: 'GBP', rate: parseFloat(usdToGbp.toFixed(4)) },
          { from: 'GBP', to: 'USD', rate: parseFloat(gbpToUsd.toFixed(4)) },
          { from: 'USD', to: 'PKR', rate: parseFloat(usdToPkr.toFixed(4)) },
          { from: 'GBP', to: 'PKR', rate: parseFloat(gbpToPkr.toFixed(4)) },
          { from: 'EUR', to: 'PKR', rate: parseFloat(eurToPkr.toFixed(4)) }
        ]);

        addDsaLog("Currency Router: Fetched live exchange rates from open exchange API.");
      } catch (e) {
        console.warn("Failed to fetch live rates, using fallback seeds", e);
        addDsaLog("Currency Router: Failed fetching live rates. Defaulting to local fallbacks.");
      }
    };
    fetchLiveRates();
  }, []);

  const handleDijkstraSolve = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amountToConvert);
    if (isNaN(amt) || amt <= 0) return;

    const graph = new CurrencyGraph();
    rates.forEach(edge => {
      graph.addRate(edge.from, edge.to, edge.rate);
    });

    const startTime = performance.now();
    const solved = graph.findOptimalPath(fromCurrency, toCurrency);
    const endTime = performance.now();

    if (solved.rate > 0) {
      setConversionResult({
        path: solved.path,
        rate: solved.rate,
        result: amt * solved.rate
      });
      addDsaLog(`Dijkstra's Algorithm: Computed conversion route ${solved.path.join(' ➡ ')} in ${(endTime - startTime).toFixed(4)}ms. Optimal rate: ${solved.rate.toFixed(4)}.`);
    } else {
      setConversionResult(null);
      alert("No conversion path found between selected currencies.");
    }
  };

  // Compile Account Transfer Graph & Run DFS Audit
  const auditResults = useMemo(() => {
    const auditGraph = new TransactionAuditGraph();

    const accountMap: { [id: number]: string } = {};
    accounts.forEach(a => {
      if (a.id) accountMap[a.id] = a.name;
      auditGraph.addNode(a.name);
    });

    const transferTx = transactions.filter(t => t.type === 'Transfer' && t.sourceAccountId && t.destAccountId);
    
    transferTx.forEach(tx => {
      const fromName = accountMap[tx.sourceAccountId!];
      const toName = accountMap[tx.destAccountId!];
      if (fromName && toName) {
        auditGraph.addTransfer(fromName, toName, tx.amount, tx.date);
      }
    });

    const cycles = auditGraph.findCircularTransfers();

    return {
      cycles,
      transferCount: transferTx.length
    };
  }, [transactions, accounts]);

  useEffect(() => {
    if (transactions.length > 0) {
      if (auditResults.cycles.length > 0) {
        addDsaLog(`DFS Cycle Audit: Checked ${auditResults.transferCount} transfers. Detected ${auditResults.cycles.length} circular transaction loops.`);
      } else {
        addDsaLog(`DFS Cycle Audit: Checked ${auditResults.transferCount} transfers. Ledger confirmed clean (0 cycles).`);
      }
    }
  }, [transactions.length, accounts.length, auditResults.cycles.length, auditResults.transferCount]);

  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* 2 Column Dijkstra and DFS Panel */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1.25fr', gap: '2rem' }}>
        
        {/* Dijkstra Converter */}
        <div className="card">
          <h3 className="header-title" style={{ fontSize: '1.125rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            Multi-Currency Dijkstra Routing
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Finds the absolute highest yield path between multiple currencies. It applies Dijkstra's algorithm to compute multiplicative rates across graph edges.
          </p>

          <form onSubmit={handleDijkstraSolve} style={{ marginTop: '0.5rem' }}>
            <div className="form-group">
              <label className="form-label">Conversion Amount</label>
              <input 
                type="number" 
                className="form-input form-input-mono"
                value={amountToConvert}
                onChange={(e) => setAmountToConvert(e.target.value)}
                placeholder="100.00"
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="form-group">
                <label className="form-label">Source Currency</label>
                <select 
                  className="form-input"
                  value={fromCurrency}
                  onChange={(e) => setFromCurrency(e.target.value)}
                >
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="PKR">PKR (Rs)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Target Currency</label>
                <select 
                  className="form-input"
                  value={toCurrency}
                  onChange={(e) => setToCurrency(e.target.value)}
                >
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="PKR">PKR (Rs)</option>
                </select>
              </div>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
              <GraphIcon size={16} /> Compute Conversion Path
            </button>
          </form>

          {conversionResult && (
            <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '6px', backgroundColor: 'var(--bg-color-60)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Best Conversion Path:</span>
                <strong style={{ color: 'var(--accent-positive-10)' }}>{conversionResult.path.join(' ➡ ')}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Effective Rate:</span>
                <span className="amount-value">{conversionResult.rate.toFixed(4)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem' }}>
                <span style={{ fontWeight: 600 }}>Calculated Return:</span>
                <span className="amount-value" style={{ fontWeight: 700 }}>
                  {conversionResult.result.toLocaleString('en-US', { minimumFractionDigits: 2 })} {toCurrency}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* DFS Auditor */}
        <div className="card" style={{ gap: '1rem' }}>
          <h3 className="header-title" style={{ fontSize: '1.125rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            DFS Circular Transfer Audit
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Performs cycle-detection audits. If transactions route transfers in a circle (e.g. Account A ➡ Account B ➡ Account A), DFS detects and raises a warning flag.
          </p>

          <div style={{ padding: '1rem', borderRadius: '6px', border: `1px solid ${auditResults.cycles.length > 0 ? 'var(--accent-negative-10)' : 'var(--border-color)'}`, backgroundColor: auditResults.cycles.length > 0 ? 'rgba(225, 29, 72, 0.02)' : 'rgba(5, 150, 105, 0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              {auditResults.cycles.length > 0 ? (
                <>
                  <AlertIcon size={20} style={{ color: 'var(--accent-negative-10)' }} />
                  <strong style={{ color: 'var(--accent-negative-10)' }}>Warning: Circular Paths Found!</strong>
                </>
              ) : (
                <>
                  <CheckIcon size={20} style={{ color: 'var(--accent-positive-10)' }} />
                  <strong style={{ color: 'var(--accent-positive-10)' }}>Audit Status: Secure</strong>
                </>
              )}
            </div>

            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Scanned <strong>{auditResults.transferCount}</strong> inter-account transfers.
            </span>

            {auditResults.cycles.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
                <span className="form-label" style={{ color: 'var(--accent-negative-10)' }}>Detected Cycles:</span>
                {auditResults.cycles.map((cycle, idx) => (
                  <div 
                    key={idx} 
                    style={{ 
                      padding: '0.5rem', 
                      backgroundColor: 'var(--bg-color-60)', 
                      border: '1px solid var(--border-color)', 
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontFamily: 'var(--font-mono)' 
                    }}
                  >
                    Cycle #{idx + 1}: {cycle.join(' ➡ ')}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Network Graph Schema Visualization */}
      <div className="card">
        <h3 className="header-title" style={{ fontSize: '1.125rem' }}>
          Interactive Cashflow Nodes & Edges
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Standard double-entry cashflow routes mapping out current account nodes. Hover or inspect elements to audit transfer volumes.
        </p>

        <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: 'var(--surface-color)', height: '280px', display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
          {/* Custom SVG node graph representing account mappings */}
          <svg width="600" height="240" style={{ pointerEvents: 'all' }}>
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="18" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-muted)" />
              </marker>
            </defs>
            
            {/* Draw Edges */}
            <line x1="80" y1="120" x2="220" y2="70" stroke="var(--border-color)" strokeWidth="2" markerEnd="url(#arrow)" />
            <line x1="80" y1="120" x2="220" y2="170" stroke="var(--border-color)" strokeWidth="2" markerEnd="url(#arrow)" />
            <line x1="220" y1="70" x2="380" y2="120" stroke="var(--border-color)" strokeWidth="2" markerEnd="url(#arrow)" />
            <line x1="220" y1="170" x2="380" y2="120" stroke="var(--border-color)" strokeWidth="2" markerEnd="url(#arrow)" />
            
            <line x1="380" y1="120" x2="520" y2="70" stroke="var(--border-color)" strokeWidth="2" markerEnd="url(#arrow)" />
            <line x1="380" y1="120" x2="520" y2="170" stroke="var(--border-color)" strokeWidth="2" markerEnd="url(#arrow)" strokeDasharray="4" />

            {/* Account Nodes */}
            <g transform="translate(80, 120)">
              <circle r="24" fill="var(--brand-color-30)" stroke="var(--border-color)" strokeWidth="2" />
              <text textAnchor="middle" dy="4" fill="white" fontSize="9" fontWeight="600">INCOME</text>
            </g>
            <g transform="translate(220, 70)">
              <circle r="26" fill="var(--surface-color)" stroke="var(--accent-positive-10)" strokeWidth="2" />
              <text textAnchor="middle" dy="4" fill="var(--text-primary)" fontSize="9" fontWeight="600">Checking</text>
            </g>
            <g transform="translate(220, 170)">
              <circle r="26" fill="var(--surface-color)" stroke="var(--accent-warning-10)" strokeWidth="2" />
              <text textAnchor="middle" dy="4" fill="var(--text-primary)" fontSize="9" fontWeight="600">Credit Card</text>
            </g>
            <g transform="translate(380, 120)">
              <circle r="24" fill="var(--brand-color-30)" stroke="var(--border-color)" strokeWidth="2" />
              <text textAnchor="middle" dy="4" fill="white" fontSize="9" fontWeight="600">LEDGER</text>
            </g>
            <g transform="translate(520, 70)">
              <circle r="26" fill="var(--surface-color)" stroke="var(--accent-negative-10)" strokeWidth="2" />
              <text textAnchor="middle" dy="4" fill="var(--text-primary)" fontSize="9" fontWeight="600">Expenses</text>
            </g>
            <g transform="translate(520, 170)">
              <circle r="26" fill="var(--surface-color)" stroke="var(--border-color)" strokeWidth="2" />
              <text textAnchor="middle" dy="4" fill="var(--text-primary)" fontSize="9" fontWeight="600">Liabilities</text>
            </g>
          </svg>
        </div>
      </div>

    </div>
  );
};
