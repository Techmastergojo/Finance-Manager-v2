import type { Goal } from '../db';

export interface GoalAllocation {
  goalId: number;
  goalName: string;
  requiredMonthly: number;
  allocatedAmount: number;
  monthsToComplete: number;
  status: 'On Track' | 'Underfunded' | 'Fully Funded';
}

export function allocateSavings(
  goals: Goal[],
  monthlySurplus: number
): { allocations: GoalAllocation[]; unallocated: number } {
  const priorityWeight = { High: 0, Medium: 1, Low: 2 };
  
  const activeGoals = goals
    .filter(g => g.currentAmount < g.targetAmount)
    .map(g => {
      const deficit = g.targetAmount - g.currentAmount;
      const today = new Date();
      const target = new Date(g.targetDate);
      
      // Calculate months remaining (minimum 1 month)
      let monthsRemaining = (target.getFullYear() - today.getFullYear()) * 12 + (target.getMonth() - today.getMonth());
      if (monthsRemaining <= 0) monthsRemaining = 1;

      const requiredMonthly = deficit / monthsRemaining;

      return {
        goal: g,
        deficit,
        monthsRemaining,
        requiredMonthly
      };
    });

  // Sort them primary by priority, secondary by deadline urgency
  activeGoals.sort((a, b) => {
    const pDiff = priorityWeight[a.goal.priority] - priorityWeight[b.goal.priority];
    if (pDiff !== 0) return pDiff;
    return new Date(a.goal.targetDate).getTime() - new Date(b.goal.targetDate).getTime();
  });

  const allocations: GoalAllocation[] = [];
  let remainingSurplus = monthlySurplus;

  // First pass: Allocate minimum required monthly to each goal
  for (const item of activeGoals) {
    const allocation = Math.min(remainingSurplus, item.requiredMonthly);
    remainingSurplus -= allocation;
    
    const monthsToComplete = allocation > 0 ? item.deficit / allocation : Infinity;

    allocations.push({
      goalId: item.goal.id || 0,
      goalName: item.goal.name,
      requiredMonthly: item.requiredMonthly,
      allocatedAmount: allocation,
      monthsToComplete: isFinite(monthsToComplete) ? Math.ceil(monthsToComplete) : 999,
      status: allocation >= item.requiredMonthly ? 'On Track' : 'Underfunded'
    });
  }

  // Second pass: Leftover surplus goes to speed up the highest priority goals
  if (remainingSurplus > 0) {
    for (const alloc of allocations) {
      const item = activeGoals.find(g => g.goal.id === alloc.goalId);
      if (!item) continue;

      const additional = remainingSurplus; // Distribute remaining
      alloc.allocatedAmount += additional;
      remainingSurplus = 0;

      const monthsToComplete = alloc.allocatedAmount > 0 ? item.deficit / alloc.allocatedAmount : Infinity;
      alloc.monthsToComplete = isFinite(monthsToComplete) ? Math.ceil(monthsToComplete) : 999;
      
      if (alloc.allocatedAmount >= item.requiredMonthly) {
        alloc.status = 'On Track';
      }
    }
  }

  return {
    allocations,
    unallocated: remainingSurplus
  };
}
