export type MoneyTab = 'pulse' | 'collections' | 'expenses';

export type MoneyModal = 'add-expense' | 'filters' | 'export' | null;

export interface AddExpenseData {
  title: string;
  category: string;
  amount: string;
  date: string;
  status: 'Paid' | 'Pending' | 'Partially Paid';
  vendor: string;
  paymentMethod: string;
  notes: string;
  recurring: boolean;
}

export const EMPTY_ADD_EXPENSE_DATA: AddExpenseData = {
  title: '',
  category: '',
  amount: '',
  date: new Date().toISOString().slice(0, 10),
  status: 'Paid',
  vendor: '',
  paymentMethod: '',
  notes: '',
  recurring: false,
};

export interface ExpenseFilterState {
  status: 'All Status' | 'Paid' | 'Pending' | 'Partially Paid';
  sort: 'Recent' | 'Oldest' | 'Amount: High to low' | 'Amount: Low to high';
  paymentMethod: string | null;
  recurring: 'all' | 'recurring' | 'one-time';
  amountMin: string;
  amountMax: string;
}

export const EMPTY_EXPENSE_FILTERS: ExpenseFilterState = {
  status: 'All Status',
  sort: 'Recent',
  paymentMethod: null,
  recurring: 'all',
  amountMin: '',
  amountMax: '',
};
