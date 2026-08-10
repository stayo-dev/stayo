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
  /**
   * Data ownership scope: BUSINESS (null hostelId) or HOSTEL (valid hostelId).
   */
  expenseScope: 'BUSINESS' | 'HOSTEL';
  /**
   * Which hostel this cost belongs to when expenseScope is 'HOSTEL'.
   * Must be empty string when expenseScope is 'BUSINESS'.
   */
  hostelId: string;
  /**
   * The receipt image, held until submit. The upload path
   * (`POST /expenses` multipart -> `uploadReceiptImage`) already existed
   * end to end; the UI simply had no way to pick a file.
   */
  receiptFile: File | null;
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
  expenseScope: 'HOSTEL',
  hostelId: '',
  receiptFile: null,
};

export interface ExpenseFilterState {
  status: 'All Status' | 'Paid' | 'Pending' | 'Partially Paid';
  sort: 'Recent' | 'Oldest' | 'Amount: High to low' | 'Amount: Low to high';
  paymentMethod: string | null;
  /**
   * Vendor filter. The sheet previously listed vendors as non-interactive
   * spans populated from mock fixtures, for a field that did not exist here —
   * so it showed suppliers the owner had never used and did nothing when
   * tapped.
   */
  vendor: string | null;
  recurring: 'all' | 'recurring' | 'one-time';
  amountMin: string;
  amountMax: string;
  /** Custom filter start date/datetime (ISO string, YYYY-MM-DD, or YYYY-MM-DDTHH:mm). */
  startDate: string;
  /** Custom filter end date/datetime (ISO string, YYYY-MM-DD, or YYYY-MM-DDTHH:mm). */
  endDate: string;
}

export const EMPTY_EXPENSE_FILTERS: ExpenseFilterState = {
  status: 'All Status',
  sort: 'Recent',
  paymentMethod: null,
  vendor: null,
  recurring: 'all',
  amountMin: '',
  amountMax: '',
  startDate: '',
  endDate: '',
};
