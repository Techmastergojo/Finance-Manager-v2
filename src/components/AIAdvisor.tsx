import React, { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Transaction } from '../db';
import { AIIcon, CheckIcon } from '../icons';
import { queryAI } from '../ai';

interface AIAdvisorProps {
  addDsaLog: (log: string) => void;
}

interface Message {
  sender: 'user' | 'ai';
  text: string;
}

export const AIAdvisor: React.FC<AIAdvisorProps> = ({ addDsaLog }) => {
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];
  const goals = useLiveQuery(() => db.goals.toArray()) || [];
  const bills = useLiveQuery(() => db.bills.where('isPaid').equals(0).toArray()) || [];

  // API Config State
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState<'gemini' | 'openai' | 'openrouter' | 'groq'>('gemini');
  const [isKeySaved, setIsKeySaved] = useState(false);

  const [messages, setMessages] = useState<Message[]>([
    { sender: 'ai', text: "Hello! I am your AI Financial Advisor. Input your API key, and I can analyze your accounts, bills, and goals to provide personalized advice." }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef<number | null>(null);

  const [receiptText, setReceiptText] = useState('');
  const [parsedTx, setParsedTx] = useState<any>(null);
  const [isParsing, setIsParsing] = useState(false);

  useEffect(() => {
    const savedKey = localStorage.getItem('ai_api_key') || localStorage.getItem('gemini_api_key');
    const savedProvider = localStorage.getItem('ai_provider') as any;
    if (savedKey) {
      setApiKey(savedKey);
      setIsKeySaved(true);
    }
    if (savedProvider) {
      setProvider(savedProvider);
    }
  }, []);

  useEffect(() => {
    if (cooldown > 0) {
      cooldownRef.current = window.setTimeout(() => {
        setCooldown(c => c - 1);
      }, 1000);
    } else {
      if (cooldownRef.current) {
        clearTimeout(cooldownRef.current);
      }
    }
    return () => {
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
    };
  }, [cooldown]);

  const saveApiKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;
    localStorage.setItem('ai_api_key', apiKey.trim());
    localStorage.setItem('ai_provider', provider);
    setIsKeySaved(true);
    addDsaLog("AI Advisor: Saved API key and provider configuration securely.");
  };

  const clearApiKey = () => {
    localStorage.removeItem('ai_api_key');
    localStorage.removeItem('gemini_api_key');
    localStorage.removeItem('ai_provider');
    setApiKey('');
    setIsKeySaved(false);
    addDsaLog("AI Advisor: Cleared API config.");
  };

  // Compile full local financial context into clean text
  const getCompiledFinancialContext = () => {
    const dataContext = {
      accounts: accounts.map(a => ({ name: a.name, type: a.type, balance: a.balance })),
      goals: goals.map(g => ({ name: g.name, target: g.targetAmount, current: g.currentAmount, date: g.targetDate, priority: g.priority })),
      pendingBills: bills.map(b => ({ name: b.name, amount: b.amount, due: b.dueDate, priority: b.priority })),
      recentTransactions: transactions.slice(-10).map(t => ({ description: t.description, amount: t.amount, type: t.type, category: t.category, date: t.date }))
    };

    return JSON.stringify(dataContext, null, 2);
  };

  const runGeminiQuery = async (promptText: string): Promise<string> => {
    if (cooldown > 0) {
      throw new Error(`Rate limit cooldown active. Please wait ${cooldown} seconds.`);
    }
    setCooldown(10);
    return queryAI(promptText);
  };

  // Chat message submission
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isLoading) return;

    const userText = chatInput.trim();
    setMessages(prev => [...prev, { sender: 'user', text: userText }]);
    setChatInput('');
    setIsLoading(true);

    const context = getCompiledFinancialContext();
    const systemInstruction = `You are an expert, encouraging financial counselor. Below is the user's current financial data context in JSON. Provide a direct, highly customized, and actionable answer to their question. Avoid generic filler. Limit your advice to 150 words.
    
    Data Context:
    ${context}`;

    const promptText = `${systemInstruction}\n\nUser Question: ${userText}`;

    try {
      const response = await runGeminiQuery(promptText);
      setMessages(prev => [...prev, { sender: 'ai', text: response }]);
      addDsaLog("Gemini AI: Successfully processed advisor prompt and returned insight.");
    } catch (err: any) {
      setMessages(prev => [...prev, { sender: 'ai', text: `Error: ${err.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Generate Automated Proactive Insights Report
  const triggerAutomatedReport = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setMessages(prev => [...prev, { sender: 'user', text: "Generate comprehensive portfolio audit report." }]);

    const context = getCompiledFinancialContext();
    const promptText = `You are a strict, helpful personal financial advisor. You have access to the user's financial details below in JSON. Provide a brief, highly actionable portfolio audit report. Outline:
    1. Financial Strengths
    2. Savings Leaks / Immediate Concerns (e.g. high-priority bills, unbalanced debts, or high categories)
    3. Actionable strategies to pay off debts and optimize goals.
    Keep your response structure under 200 words. Be direct, crisp, and numerical.
    
    Data Context:
    ${context}`;

    try {
      const response = await runGeminiQuery(promptText);
      setMessages(prev => [...prev, { sender: 'ai', text: response }]);
      addDsaLog("Gemini AI: Generated portfolio audit report.");
    } catch (err: any) {
      setMessages(prev => [...prev, { sender: 'ai', text: `Error: ${err.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Receipt text parsing
  const handleParseReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiptText.trim() || isParsing) return;

    setIsParsing(true);
    setParsedTx(null);

    const promptText = `Analyze this raw receipt/invoice text and extract the transaction details as a JSON object. Ensure the output is strictly valid JSON matching this schema:
    {
      "amount": number,
      "category": "string (suggest a standard category, e.g. Food, Utilities, Transport, Shopping)",
      "description": "string (name of the vendor/payee)",
      "date": "string (format YYYY-MM-DD, default to today if not found)",
      "tags": ["string"]
    }
    Output ONLY the JSON object, do not enclose it in markdown blocks or write any explanation.
    
    Receipt Text:
    "${receiptText}"`;

    try {
      const response = await runGeminiQuery(promptText);
      // Strip markdown code fences if Gemini added them despite instructions
      const cleaned = response.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      setParsedTx(parsed);
      addDsaLog(`Gemini AI Receipt Parser: Successfully parsed invoice text into structured transaction parameters.`);
    } catch (err: any) {
      alert(`Parsing failed: ${err.message}`);
    } finally {
      setIsParsing(false);
    }
  };

  // Autofill parsed receipt into transaction database
  const handleSaveParsedTransaction = async () => {
    if (!parsedTx) return;

    // Pick first checking/cash account as default source for expense
    const defaultAccount = accounts.find(a => a.type === 'Cash' || a.type === 'Card');
    const sourceAccId = defaultAccount?.id;

    if (!sourceAccId) {
      alert("No suitable account available to fund this parsed transaction.");
      return;
    }

    const txData: Transaction = {
      amount: parsedTx.amount,
      type: 'Expense',
      category: parsedTx.category,
      sourceAccountId: sourceAccId,
      date: parsedTx.date || new Date().toISOString().split('T')[0],
      description: parsedTx.description || 'Parsed Receipt Purchase',
      tags: parsedTx.tags || ['parsed'],
      currency: 'USD'
    };

    await db.transaction('rw', [db.transactions, db.accounts], async () => {
      await db.transactions.add(txData);
      const acc = await db.accounts.get(sourceAccId);
      if (acc) {
        await db.accounts.update(sourceAccId, { balance: acc.balance - txData.amount });
      }
    });

    addDsaLog(`Receipt Parser: Saved parsed receipt transaction for '${txData.description}' ($${txData.amount}) automatically.`);
    setParsedTx(null);
    setReceiptText('');
    alert("Transaction saved to ledger!");
  };

  return (
    <div className="advisor-chat">
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1.25fr', gap: '2rem', height: '100%' }}>
        
        {/* Chat advisor panel */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            <h3 className="header-title" style={{ fontSize: '1.125rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AIIcon size={20} /> AI Advisor Console
            </h3>
            {isKeySaved && (
              <button onClick={clearApiKey} className="btn btn-secondary" style={{ padding: '3px 8px', fontSize: '0.7rem' }}>
                Clear Key
              </button>
            )}
          </div>

          {!isKeySaved ? (
            <form onSubmit={saveApiKey} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem 0' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Enter your API Key and select your AI model provider. Your credentials persist locally on your device.
              </p>
              <div className="form-group">
                <label className="form-label">AI Model Provider</label>
                <select 
                  className="form-input"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as any)}
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI (GPT-4o-mini)</option>
                  <option value="openrouter">OpenRouter (Free Deepseek / Llama)</option>
                  <option value="groq">Groq (Llama 3 8B)</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">API Key</label>
                <input 
                  type="password" 
                  className="form-input form-input-mono"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIzaSy... or sk-..."
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary">Save Config</button>
            </form>
          ) : (
            <>
              {/* Chat pane */}
              <div className="chat-messages" style={{ overflowY: 'auto' }}>
                {messages.map((m, idx) => (
                  <div key={idx} className={`message ${m.sender === 'user' ? 'message-user' : 'message-ai'}`}>
                    {/* Render newlines */}
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                  </div>
                ))}
                {isLoading && (
                  <div className="message message-ai" style={{ fontStyle: 'italic' }}>
                    Gemini thinking...
                  </div>
                )}
              </div>

              {/* Chat controllers */}
              <form onSubmit={handleSendMessage} className="chat-input-container">
                <input 
                  type="text" 
                  className="form-input chat-input"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder={cooldown > 0 ? `API cooldown: wait ${cooldown}s...` : "Ask about your budget, debts, or bill warnings..."}
                  disabled={isLoading || cooldown > 0}
                  required
                />
                <button type="submit" className="btn btn-primary" disabled={isLoading || cooldown > 0}>
                  Send
                </button>
              </form>

              <button 
                onClick={triggerAutomatedReport} 
                className="btn btn-secondary" 
                style={{ width: '100%', marginTop: '0.5rem' }} 
                disabled={isLoading || cooldown > 0}
              >
                Perform Portfolio Audit
              </button>
            </>
          )}
        </div>

        {/* AI Receipt Text Parser */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <h3 className="header-title" style={{ fontSize: '1.125rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            Smart AI Receipt Parser
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Paste raw text from email receipts, bills, or grocery checkouts. Gemini parses the details into matching transactional formats instantly.
          </p>

          <form onSubmit={handleParseReceipt} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem', flexGrow: 1 }}>
            <div className="form-group" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
              <label className="form-label">Raw Invoice / Receipt Text</label>
              <textarea 
                className="form-input"
                style={{ resize: 'none', flexGrow: 1, minHeight: '140px', fontFamily: 'var(--font-mono)' }}
                value={receiptText}
                onChange={(e) => setReceiptText(e.target.value)}
                placeholder={`WALMART #4562\n7/05/2026\nGROCERY DEPT: $42.50\nSUBTOTAL: $42.50\nTOTAL CHARGED: $42.50`}
                disabled={!isKeySaved || isParsing}
                required
              />
            </div>

            <button 
              type="submit" 
              className="btn btn-primary" 
              disabled={!isKeySaved || isParsing || cooldown > 0 || !receiptText.trim()}
            >
              {isParsing ? 'Parsing...' : 'Analyze Receipt'}
            </button>
          </form>

          {parsedTx && (
            <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '6px', backgroundColor: 'var(--bg-color-60)', fontSize: '0.875rem', marginTop: '1rem' }}>
              <span className="form-label" style={{ fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>Extracted Transaction Parameters</span>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '0.375rem', marginBottom: '1rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Vendor:</span>
                <strong>{parsedTx.description}</strong>
                <span style={{ color: 'var(--text-secondary)' }}>Amount:</span>
                <strong className="amount-value" style={{ textAlign: 'left' }}>${parsedTx.amount}</strong>
                <span style={{ color: 'var(--text-secondary)' }}>Category:</span>
                <span>{parsedTx.category}</span>
                <span style={{ color: 'var(--text-secondary)' }}>Date:</span>
                <span>{parsedTx.date}</span>
                <span style={{ color: 'var(--text-secondary)' }}>Tags:</span>
                <span>{parsedTx.tags?.join(', ')}</span>
              </div>

              <button 
                onClick={handleSaveParsedTransaction} 
                className="btn btn-primary"
                style={{ width: '100%', backgroundColor: 'var(--accent-positive-10)' }}
              >
                <CheckIcon size={16} /> Save Parsed Entry to Ledger
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
