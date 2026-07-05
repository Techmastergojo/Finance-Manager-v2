import Dexie, { type Table } from 'dexie';

export interface Account {
  id?: number;
  name: string;
  type: 'Cash' | 'Card' | 'Investment' | 'Savings';
  balance: number;
  currency: string; // e.g. "USD", "EUR", "GBP"
}

export interface Transaction {
  id?: number;
  amount: number;
  type: 'Income' | 'Expense' | 'Transfer' | 'Debt Payoff';
  category: string; // e.g. "Housing/Rent", "Food/Groceries", "Income/Salary"
  sourceAccountId?: number; // From account
  destAccountId?: number; // To account
  date: string; // YYYY-MM-DD
  description: string;
  tags: string[];
  currency: string;
}

export interface Debt {
  id?: number;
  name: string;
  principal: number; // total remaining balance
  interestRate: number; // annual percentage rate (e.g., 18.5 for 18.5%)
  minPayment: number;
  monthlyAllocation: number; // user's allocated extra payoff amount
}

export interface Goal {
  id?: number;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string; // YYYY-MM-DD
  priority: 'High' | 'Medium' | 'Low';
}

export interface Bill {
  id?: number;
  name: string;
  amount: number;
  dueDate: string; // YYYY-MM-DD
  isPaid: number; // 0 for unpaid, 1 for paid
  priority: 'High' | 'Medium' | 'Low';
}

export class FinanceDatabase extends Dexie {
  accounts!: Table<Account>;
  transactions!: Table<Transaction>;
  debts!: Table<Debt>;
  goals!: Table<Goal>;
  bills!: Table<Bill>;

  constructor() {
    super('FinanceDatabaseV2');
    this.version(1).stores({
      accounts: '++id, name, type, currency',
      transactions: '++id, amount, type, category, sourceAccountId, destAccountId, date, description',
      debts: '++id, name, interestRate',
      goals: '++id, name, targetDate, priority',
      bills: '++id, name, dueDate, isPaid'
    });
  }
}

export const db = new FinanceDatabase();

// Prepopulate database with mock data if empty (Disabled)
export async function seedDatabaseIfEmpty() {
  // Seeding disabled
}
