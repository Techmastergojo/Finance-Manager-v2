import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { AIIcon } from '../icons';

interface TaxCenterProps {
  addDsaLog: (log: string) => void;
}

export const TaxCenter: React.FC<TaxCenterProps> = ({ addDsaLog }) => {
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];
  
  const [incomeTaxRate, setIncomeTaxRate] = useState(() => {
    return parseFloat(localStorage.getItem('tax_rate_income') || '20');
  });
  const [salesTaxRate, setSalesTaxRate] = useState(() => {
    return parseFloat(localStorage.getItem('tax_rate_sales') || '8');
  });

  const [salary, setSalary] = useState('75000');
  const [contribution, setContribution] = useState('4');
  const [matchLimit, setMatchLimit] = useState('6');
  const [matchRatio, setMatchRatio] = useState('100');

  const matchMetrics = useMemo(() => {
    const sal = parseFloat(salary) || 0;
    const cont = parseFloat(contribution) || 0;
    const limit = parseFloat(matchLimit) || 0;
    const ratio = parseFloat(matchRatio) || 0;

    const userContrib = sal * (cont / 100);
    const maxMatchable = sal * (limit / 100);

    const actualMatch = cont < limit
      ? sal * (cont / 100) * (ratio / 100)
      : sal * (limit / 100) * (ratio / 100);

    const maxPossibleMatch = maxMatchable * (ratio / 100);
    const leftOnTable = Math.max(0, maxPossibleMatch - actualMatch);

    return {
      userContrib,
      actualMatch,
      leftOnTable
    };
  }, [salary, contribution, matchLimit, matchRatio]);
  const [isFiling, setIsFiling] = useState(false);
  const [taxReport, setTaxReport] = useState<string | null>(null);

  const saveTaxRates = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('tax_rate_income', incomeTaxRate.toString());
    localStorage.setItem('tax_rate_sales', salesTaxRate.toString());
    addDsaLog(`Taxes: Saved Income Tax (${incomeTaxRate}%) and Sales Tax (${salesTaxRate}%).`);
    alert("Tax settings saved!");
  };

  const taxMetrics = useMemo(() => {
    const grossIncome = transactions
      .filter(t => t.type === 'Income' && !t.tags.includes('initial-balance') && t.category !== 'System/Opening Balance')
      .reduce((sum, t) => sum + t.amount, 0);

    const deductibleExpenses = transactions
      .filter(t => t.type === 'Expense' && (
        t.tags.includes('deductible') || 
        t.tags.includes('business') || 
        t.category.toLowerCase().includes('business')
      ))
      .reduce((sum, t) => sum + t.amount, 0);

    const netTaxableIncome = Math.max(0, grossIncome - deductibleExpenses);
    const estimatedTaxDue = netTaxableIncome * (incomeTaxRate / 100);

    const totalExpenses = transactions
      .filter(t => t.type === 'Expense')
      .reduce((sum, t) => sum + t.amount, 0);
    const estimatedSalesTaxPaid = totalExpenses * (salesTaxRate / (100 + salesTaxRate));

    return {
      grossIncome,
      deductibleExpenses,
      netTaxableIncome,
      estimatedTaxDue,
      estimatedSalesTaxPaid
    };
  }, [transactions, incomeTaxRate, salesTaxRate]);

  const handlePrepareTaxChecklist = async () => {
    const key = localStorage.getItem('gemini_api_key');
    if (!key) {
      alert("Please enter a Gemini API Key in the AI Advisor or Onboarding first.");
      return;
    }

    setIsFiling(true);
    setTaxReport(null);

    const promptText = `You are a professional CPA and tax assistant. The user has the following local financial parameters:
    Gross Income: $${taxMetrics.grossIncome}
    Deductible Expenses: $${taxMetrics.deductibleExpenses}
    Net Taxable Income: $${taxMetrics.netTaxableIncome}
    Effective Income Tax Rate: ${incomeTaxRate}%
    Estimated Tax Liability: $${taxMetrics.estimatedTaxDue}
    Estimated Sales Tax Paid: $${taxMetrics.estimatedSalesTaxPaid}
    
    Provide a concise (under 200 words) tax filing checklist and advice for this user. Cover:
    1. Which forms to use (e.g. Schedule C / 1040).
    2. Verification checklist for deductions.
    3. Actionable advice to reduce liability.
    Do not add HTML tags, use basic markdown.`;

    try {
      const models = ['gemini-2.5-flash', 'gemini-1.5-flash'];
      let succeeded = false;
      let reply = '';

      for (const model of models) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
          });
          if (response.ok) {
            const data = await response.json();
            reply = data.candidates[0].content.parts[0].text;
            succeeded = true;
            break;
          }
        } catch (e) {
          console.warn(e);
        }
      }

      if (succeeded) {
        setTaxReport(reply);
        addDsaLog("Gemini AI: Compiled customized tax filing advisor report.");
      } else {
        throw new Error("Unable to contact Gemini models.");
      }
    } catch (err: any) {
      alert(`Filing assistance failed: ${err.message}`);
    } finally {
      setIsFiling(false);
    }
  };

  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '2rem' }}>
        
        <div className="card">
          <h3 className="header-title" style={{ fontSize: '1.125rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            Tax Configuration
          </h3>
          <form onSubmit={saveTaxRates}>
            <div className="form-group">
              <label className="form-label">Income Tax Rate (%)</label>
              <input 
                type="number" 
                className="form-input form-input-mono"
                value={incomeTaxRate}
                onChange={(e) => setIncomeTaxRate(parseFloat(e.target.value) || 0)}
                placeholder="20"
                min="0"
                max="100"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Sales Tax Rate (%)</label>
              <input 
                type="number" 
                className="form-input form-input-mono"
                value={salesTaxRate}
                onChange={(e) => setSalesTaxRate(parseFloat(e.target.value) || 0)}
                placeholder="8"
                min="0"
                max="100"
                required
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
              Save Tax Settings
            </button>
          </form>
        </div>

        <div className="card">
          <h3 className="header-title" style={{ fontSize: '1.125rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            Tax Summary Dashboard
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
            <div style={{ padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Gross Income</div>
              <div className="amount-value" style={{ fontSize: '1.25rem', textAlign: 'left', color: 'var(--accent-positive-10)' }}>
                Rs. {taxMetrics.grossIncome.toLocaleString()}
              </div>
            </div>

            <div style={{ padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Deductible Expenses</div>
              <div className="amount-value" style={{ fontSize: '1.25rem', textAlign: 'left', color: 'var(--text-primary)' }}>
                Rs. {taxMetrics.deductibleExpenses.toLocaleString()}
              </div>
            </div>

            <div style={{ padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Net Taxable Amount</div>
              <div className="amount-value" style={{ fontSize: '1.25rem', textAlign: 'left', color: 'var(--text-primary)' }}>
                Rs. {taxMetrics.netTaxableIncome.toLocaleString()}
              </div>
            </div>

            <div style={{ padding: '0.75rem', border: '1px solid var(--accent-negative-10)', borderRadius: '6px', backgroundColor: 'rgba(225,29,72,0.02)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--accent-negative-10)' }}>Estimated Income Tax Due</div>
              <div className="amount-value" style={{ fontSize: '1.25rem', textAlign: 'left', color: 'var(--accent-negative-10)' }}>
                Rs. {taxMetrics.estimatedTaxDue.toLocaleString()}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem', padding: '0.5rem', backgroundColor: 'var(--bg-color-60)', borderRadius: '4px' }}>
            <span>Estimated Sales Tax Paid:</span>
            <strong className="amount-value">Rs. {taxMetrics.estimatedSalesTaxPaid.toFixed(2)}</strong>
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
          <h3 className="header-title" style={{ fontSize: '1.125rem' }}>
            AI Tax Filing Assistant
          </h3>
          <button 
            onClick={handlePrepareTaxChecklist} 
            className="btn btn-primary"
            disabled={isFiling}
          >
            <AIIcon size={16} /> {isFiling ? 'Auditing Ledger...' : 'Prepare Filing Checklist'}
          </button>
        </div>

        {taxReport ? (
          <div style={{ padding: '1.5rem', border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: 'var(--surface-color)', fontSize: '0.875rem', whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>
            {taxReport}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-secondary)', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
            No tax filing checklist pre-compiled. Setup your API key and click the button to generate customized instructions.
          </div>
        )}
      </div>

      {/* Employer 401(k) Match Maximizer Card */}
      <div className="card" style={{ marginTop: '2rem' }}>
        <h3 className="header-title" style={{ fontSize: '1.125rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
          401(k) / Pension Employer Match Maximizer
        </h3>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 2fr', gap: '2rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label">Annual Salary (Rs.)</label>
              <input 
                type="number"
                className="form-input form-input-mono"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                placeholder="75000"
              />
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div className="form-group">
                <label className="form-label">Your Contribution (%)</label>
                <input 
                  type="number"
                  className="form-input form-input-mono"
                  value={contribution}
                  onChange={(e) => setContribution(e.target.value)}
                  placeholder="4"
                  min="0"
                  max="100"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Match Limit (%)</label>
                <input 
                  type="number"
                  className="form-input form-input-mono"
                  value={matchLimit}
                  onChange={(e) => setMatchLimit(e.target.value)}
                  placeholder="6"
                  min="0"
                  max="100"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Match Ratio (%)</label>
              <input 
                type="number"
                className="form-input form-input-mono"
                value={matchRatio}
                onChange={(e) => setMatchRatio(e.target.value)}
                placeholder="100"
                min="0"
                max="100"
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Your Annual Contribution</div>
                <div className="amount-value" style={{ fontSize: '1.25rem', textAlign: 'left', color: 'var(--text-primary)' }}>
                  Rs. {Math.round(matchMetrics.userContrib).toLocaleString()}
                </div>
              </div>

              <div style={{ padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Employer Matching Funds</div>
                <div className="amount-value" style={{ fontSize: '1.25rem', textAlign: 'left', color: 'var(--accent-positive-10)' }}>
                  +Rs. {Math.round(matchMetrics.actualMatch).toLocaleString()}
                </div>
              </div>
            </div>

            {matchMetrics.leftOnTable > 0 ? (
              <div style={{ border: '1px solid var(--accent-warning-10)', borderRadius: '6px', backgroundColor: 'rgba(245, 158, 11, 0.05)', padding: '1rem' }}>
                <h4 style={{ margin: '0 0 0.25rem 0', fontSize: '0.85rem', color: 'var(--accent-warning-10)' }}>
                  ⚠️ Matching Money Left On Table
                </h4>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                  You are leaving <strong style={{ color: 'var(--accent-warning-10)' }}>Rs. {Math.round(matchMetrics.leftOnTable).toLocaleString()}</strong> of free employer funds on the table annually! Reaching a contribution rate of <strong>{matchLimit}%</strong> will capture 100% of the matching capital.
                </p>
              </div>
            ) : (
              <div style={{ border: '1px solid var(--accent-positive-10)', borderRadius: '6px', backgroundColor: 'rgba(16, 185, 129, 0.05)', padding: '1rem' }}>
                <h4 style={{ margin: '0 0 0.25rem 0', fontSize: '0.85rem', color: 'var(--accent-positive-10)' }}>
                  🎉 Match Maximized
                </h4>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                  Outstanding! You are fully capturing all available employer matching retirement benefits.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
};
