# Finance Manager

An ultimate client-side personal finance manager built to minimize mental friction, protect financial stability, and accelerate wealth-building. Designed with custom Data Structures and Algorithms (DSA) and integrated with decentralized local AI capabilities.

---

## 🚀 Key Features & Architectural Components

### 1. Dashboard Workspace & "Safe-to-Spend" Engine
- **Liquid Cash Focus**: Calculates disposable funds strictly from checking and liquid cash accounts, excluding long-term savings or investments to avoid false security.
- **Payday Anchors**: Tracks paycheck cycles (weekly, bi-weekly, monthly) and next payday dates.
- **Real-Time Limit calculation**: `Safe-to-Spend = Available Liquid Cash - Bills Due Before Payday - Savings Goal Target Contributions`.

### 2. Double-Entry Transaction Ledger
- **Verifiable Balances**: Logs all cash flows as income, expenses, transfers, or debt paydowns. Automatically checks and updates balance values in underlying Dexie/IndexedDB storage.
- **Trie Autocomplete Lookup**: Auto-suggests descriptions and categories in $O(L)$ time where $L$ is the prefix length.
- **Binary Search Amount Filtering**: Performs lower and upper bound binary search ranges on sorted arrays to filter transaction sizes in $O(\log N)$ time.
- **Custom Sort Algorithms**: Implements Stable Merge Sort for date and category columns, and Quick Sort for amount-based sorting.

### 3. Priority Queue Bill Tracker
- **Urgency Minimization Heap**: Uses a custom binary `MinHeap` structure to rank bills dynamically. Sorting matches due date deadlines primary, and priority weights (High, Medium, Low) secondary.
- **Real-Time Queue Visualizer**: Renders the internal flat array representation of the heap, helping you visualize the binary tree structure.
- **Deduction Source Selection**: Marks bills as paid and records corresponding double-entry transactions from selected accounts.

### 4. Interactive Debt Payoff Planner
- **Strategies comparison**: Simulates **Avalanche** (high APR rate focus) and **Snowball** (lowest principal balance focus) payoff timelines.
- **Urgency solvers**: Uses `MinHeap` structures configured with comparator metrics (descending APR vs. ascending principal).
- **Extra contributions planner**: Compares month-by-month projection timelines showing total interest saved and target payoff months.

### 5. Multi-Goal Savings Planner
- **Surplus Budget Allocator**: Sorts active goals by priority weights and target dates, automatically allocating monthly surplus capital to ensure High Priority goals stay on track first.
- **Spare Change Round-Ups Hook**: Sweeps spare change from transaction expenses up to the nearest dollar directly into your highest-priority Savings Goal.

### 6. Tax Center & 401(k) Maximizer
- **Paycheck-Only Tax Estimation**: Tracks gross income (excluding opening balances) and deductible business/personal tags, computing estimated income and sales tax liabilities.
- **401(k) Match Maximizer**: Audits employer pensions and contribution rates, alerting you if matching capital is being left on the table.
- **AI Filing Assistant**: Evaluates your double-entry ledger to compile a customized tax filing preparation checklist.

### 7. Multi-Currency Dijkstra Pathfinding
- **Arbitrage-Resistant Conversion**: Maps currencies (USD, EUR, GBP, PKR) as graph nodes and exchange rates as directed weighted edges.
- **Live Rate Integration**: Syncs live rates from a public API on startup with offline fallback backups.
- **Optimal Conversions**: Uses a customized Dijkstra pathfinder to optimize conversions.

### 8. Decentralized AI Integration
- **Zero-Trust Keys**: Key credentials are saved locally in the browser's `localStorage`.
- **Multi-Model Provider Support**: Plugs into Google Gemini, OpenAI, OpenRouter, and Groq endpoints.

---

## 🛠️ Tech Stack
- **Frontend Core**: React 18, TypeScript, Vite
- **Database (IndexedDB)**: Dexie.js for persistent, secure client-side storage (persists through page refreshes, tab exits, or terminal shutoffs)
- **Styling**: Modern, responsive Custom HSL CSS theme rules (no Tailwinds/UI frameworks)
- **Icons**: Lucide-inspired Custom SVG assets

---

## 💻 Installation & Local Development

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed (version 18+ recommended).

### Setup Instructions
1. **Clone the Repository**:
   ```bash
   git clone https://github.com/Techmastergojo/Finance-Manager-v2.git
   cd Finance-Manager-v2
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Start Development Server**:
   ```bash
   npm run dev
   ```
   Open your browser and navigate to the local URL (usually `http://localhost:5173`).

4. **Build Production Bundle**:
   ```bash
   npm run build
   ```

---
Made by Hamza Tehseen Cheema
