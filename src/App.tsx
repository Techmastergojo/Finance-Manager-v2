import { useState, useMemo, useEffect } from 'react';
import { Dashboard } from './components/Dashboard';
import { Transactions } from './components/Transactions';
import { BillTracker } from './components/BillTracker';
import { CashflowGraph } from './components/CashflowGraph';
import { GoalPlanner } from './components/GoalPlanner';
import { AIAdvisor } from './components/AIAdvisor';
import { TaxCenter } from './components/TaxCenter';
import { DebtPlanner } from './components/DebtPlanner';
import { UndoStack } from './dsa/UndoStack';
import type { HistoryAction } from './dsa/UndoStack';
import { db } from './db';
import { 
  DashboardIcon, 
  TransactionIcon, 
  BillIcon, 
  GraphIcon, 
  GoalIcon, 
  AIIcon, 
  UndoIcon, 
  RedoIcon,
  SunIcon,
  MoonIcon
} from './icons';

function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'transactions' | 'bills' | 'graph' | 'goals' | 'ai' | 'taxes' | 'debts'>('dashboard');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [dsaLogs, setDsaLogs] = useState<string[]>(["System initialized."]);

  const undoStack = useMemo(() => new UndoStack(), []);
  
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const [isOnboardingOpen, setIsOnboardingOpen] = useState(() => {
    return localStorage.getItem('onboarding_done') !== 'true';
  });
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [obApiKey, setObApiKey] = useState('');
  const [obProvider, setObProvider] = useState<'gemini' | 'openai' | 'openrouter' | 'groq'>('gemini');
  const [obAccName, setObAccName] = useState('Checking Account');
  const [obAccBalance, setObAccBalance] = useState('2500');
  const [obIncomeTax, setObIncomeTax] = useState('20');
  const [obSalesTax, setObSalesTax] = useState('8');

  const updateStackStates = () => {
    setCanUndo(undoStack.canUndo());
    setCanRedo(undoStack.canRedo());
  };

  const pushHistoryAction = (action: HistoryAction) => {
    undoStack.push(action);
    updateStackStates();
  };

  const handleUndo = async () => {
    try {
      const desc = await undoStack.undo();
      if (desc) {
        addDsaLog(`Undo: Reverted - "${desc}"`);
      }
      updateStackStates();
    } catch (e: any) {
      console.error(e);
      addDsaLog(`Undo Error: ${e.message}`);
    }
  };

  const handleRedo = async () => {
    try {
      const desc = await undoStack.redo();
      if (desc) {
        addDsaLog(`Redo: Applied - "${desc}"`);
      }
      updateStackStates();
    } catch (e: any) {
      console.error(e);
      addDsaLog(`Redo Error: ${e.message}`);
    }
  };

  const addDsaLog = (log: string) => {
    const time = new Date().toLocaleTimeString();
    setDsaLogs(prev => [`[${time}] ${log}`, ...prev.slice(0, 49)]);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      } else if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(t => t === 'light' ? 'dark' : 'light');
  };

  const handleCompleteOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('tax_rate_income', obIncomeTax);
    localStorage.setItem('tax_rate_sales', obSalesTax);
    localStorage.setItem('ai_provider', obProvider);
    if (obApiKey.trim()) {
      localStorage.setItem('ai_api_key', obApiKey.trim());
    }

    const balanceVal = parseFloat(obAccBalance) || 0;
    const newAcc = {
      name: obAccName.trim() || 'Primary Checking',
      type: 'Cash' as const,
      balance: balanceVal,
      currency: 'USD'
    };

    await db.transaction('rw', [db.accounts, db.transactions], async () => {
      const addedId = await db.accounts.add(newAcc);
      if (balanceVal !== 0) {
        await db.transactions.add({
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

    localStorage.setItem('onboarding_done', 'true');
    setIsOnboardingOpen(false);
    addDsaLog("System: Onboarding completed. Default accounts & taxes loaded.");
  };

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="sidebar-title">
          <AIIcon size={24} style={{ color: 'var(--accent-positive-10)' }} />
          <span>Finance Manager</span>
        </div>
        
        <nav>
          <ul className="nav-links">
            <li className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}>
              <button onClick={() => setActiveTab('dashboard')}>
                <DashboardIcon /> Dashboard
              </button>
            </li>
            <li className={`nav-item ${activeTab === 'transactions' ? 'active' : ''}`}>
              <button onClick={() => setActiveTab('transactions')}>
                <TransactionIcon /> Transaction Ledger
              </button>
            </li>
            <li className={`nav-item ${activeTab === 'bills' ? 'active' : ''}`}>
              <button onClick={() => setActiveTab('bills')}>
                <BillIcon /> Priority Bills
              </button>
            </li>
            <li className={`nav-item ${activeTab === 'graph' ? 'active' : ''}`}>
              <button onClick={() => setActiveTab('graph')}>
                <GraphIcon /> Cashflow Nodes
              </button>
            </li>
            <li className={`nav-item ${activeTab === 'goals' ? 'active' : ''}`}>
              <button onClick={() => setActiveTab('goals')}>
                <GoalIcon /> Savings Goals
              </button>
            </li>
            <li className={`nav-item ${activeTab === 'debts' ? 'active' : ''}`}>
              <button onClick={() => setActiveTab('debts')}>
                <BillIcon /> Debt Planner
              </button>
            </li>
            <li className={`nav-item ${activeTab === 'taxes' ? 'active' : ''}`}>
              <button onClick={() => setActiveTab('taxes')}>
                <TransactionIcon /> Tax Center
              </button>
            </li>
            <li className={`nav-item ${activeTab === 'ai' ? 'active' : ''}`}>
              <button onClick={() => setActiveTab('ai')}>
                <AIIcon /> AI Advisor
              </button>
            </li>
          </ul>
        </nav>
      </aside>

      <main className="main-content">
        <header className="header">
          <h2 className="header-title" style={{ textTransform: 'capitalize' }}>
            {activeTab === 'bills' ? 'Priority Queue Bill Alerts' : activeTab === 'graph' ? 'Weighted Graph Analysis' : activeTab === 'taxes' ? 'Estimated Tax Tracker' : activeTab === 'debts' ? 'Debt Paydown Planner' : activeTab + ' Workspace'}
          </h2>
          
          <div className="header-actions">
            <div style={{ display: 'flex', gap: '0.25rem', marginRight: '1rem' }}>
              <button 
                onClick={handleUndo} 
                className="btn btn-secondary" 
                disabled={!canUndo} 
                style={{ padding: '6px 12px' }}
                title="Undo Action (Ctrl+Z)"
              >
                <UndoIcon size={14} /> Undo
              </button>
              <button 
                onClick={handleRedo} 
                className="btn btn-secondary" 
                disabled={!canRedo} 
                style={{ padding: '6px 12px' }}
                title="Redo Action (Ctrl+Y)"
              >
                <RedoIcon size={14} /> Redo
              </button>
            </div>

            <button onClick={toggleTheme} className="btn btn-secondary" style={{ borderRadius: '50%', width: '38px', height: '38px', padding: 0 }}>
              {theme === 'light' ? <MoonIcon size={18} /> : <SunIcon size={18} />}
            </button>
          </div>
        </header>

        <div style={{ flexGrow: 1, overflowY: 'auto' }}>
          {activeTab === 'dashboard' && <Dashboard onPushAction={pushHistoryAction} addDsaLog={addDsaLog} />}
          {activeTab === 'transactions' && <Transactions onPushAction={pushHistoryAction} addDsaLog={addDsaLog} />}
          {activeTab === 'bills' && <BillTracker onPushAction={pushHistoryAction} addDsaLog={addDsaLog} />}
          {activeTab === 'graph' && <CashflowGraph addDsaLog={addDsaLog} />}
          {activeTab === 'goals' && <GoalPlanner onPushAction={pushHistoryAction} addDsaLog={addDsaLog} />}
          {activeTab === 'taxes' && <TaxCenter addDsaLog={addDsaLog} />}
          {activeTab === 'debts' && <DebtPlanner onPushAction={pushHistoryAction} addDsaLog={addDsaLog} />}
          {activeTab === 'ai' && <AIAdvisor addDsaLog={addDsaLog} />}
        </div>

        <footer className="diagnostics-bar">
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span style={{ fontWeight: 'bold', color: '#10b981' }}>● SYSTEM LOG</span>
            <span style={{ color: '#9ca3af', fontSize: '0.7rem' }}>
              {dsaLogs[0] || 'Idle'}
            </span>
          </div>
        </footer>
      </main>

      {isOnboardingOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '440px' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
              Setup Wizard (Step {onboardingStep} of 3)
            </h2>

            {onboardingStep === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Configure your AI credentials. Your key is stored securely in your browser's local storage and is never saved in the codebase.
                </p>
                <div className="form-group">
                  <label className="form-label">AI Model Provider</label>
                  <select 
                    className="form-input"
                    value={obProvider}
                    onChange={(e) => setObProvider(e.target.value as any)}
                  >
                    <option value="gemini">Google Gemini</option>
                    <option value="openai">OpenAI (GPT-4o-mini)</option>
                    <option value="openrouter">OpenRouter (Free Llama / Deepseek)</option>
                    <option value="groq">Groq (Llama 3 8B)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">API Key (Optional)</label>
                  <input 
                    type="password"
                    className="form-input form-input-mono"
                    value={obApiKey}
                    onChange={(e) => setObApiKey(e.target.value)}
                    placeholder="API Key (e.g. AIzaSy... or sk-...)"
                  />
                </div>
                <button onClick={() => setOnboardingStep(2)} className="btn btn-primary" style={{ width: '100%' }}>
                  Continue
                </button>
              </div>
            )}

            {onboardingStep === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Create your first bank account or cash ledger node to record balances.
                </p>
                <div className="form-group">
                  <label className="form-label">Account Name</label>
                  <input 
                    type="text"
                    className="form-input"
                    value={obAccName}
                    onChange={(e) => setObAccName(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Opening Balance (Rs.)</label>
                  <input 
                    type="number"
                    step="0.01"
                    className="form-input form-input-mono"
                    value={obAccBalance}
                    onChange={(e) => setObAccBalance(e.target.value)}
                    required
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button onClick={() => setOnboardingStep(1)} className="btn btn-secondary" style={{ flexGrow: 1 }}>
                    Back
                  </button>
                  <button onClick={() => setOnboardingStep(3)} className="btn btn-primary" style={{ flexGrow: 1 }} disabled={!obAccName.trim()}>
                    Continue
                  </button>
                </div>
              </div>
            )}

            {onboardingStep === 3 && (
              <form onSubmit={handleCompleteOnboarding} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Configure your baseline tax percentages. These are used to project estimated tax withholdings and compute sales tax deductions.
                </p>
                <div className="form-group">
                  <label className="form-label">Effective Income Tax Rate (%)</label>
                  <input 
                    type="number"
                    className="form-input form-input-mono"
                    value={obIncomeTax}
                    onChange={(e) => setObIncomeTax(e.target.value)}
                    min="0"
                    max="100"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Estimated Sales Tax Rate (%)</label>
                  <input 
                    type="number"
                    className="form-input form-input-mono"
                    value={obSalesTax}
                    onChange={(e) => setObSalesTax(e.target.value)}
                    min="0"
                    max="100"
                    required
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" onClick={() => setOnboardingStep(2)} className="btn btn-secondary" style={{ flexGrow: 1 }}>
                    Back
                  </button>
                  <button type="submit" className="btn btn-primary" style={{ flexGrow: 1 }}>
                    Start Tracking
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
