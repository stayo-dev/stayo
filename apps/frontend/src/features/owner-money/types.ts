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
   * Which hostel this cost belongs to, or '' for a genuinely
   * business-wide cost. Previously the client deleted this and forced
   * every expense to BUSINESS scope, so multi-property owners could not
   * compare properties — while 8 of 11 existing rows already carried a
   * hostel. See the expenses module audit.
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
}

export const EMPTY_EXPENSE_FILTERS: ExpenseFilterState = {
  status: 'All Status',
  sort: 'Recent',
  paymentMethod: null,
  vendor: null,
  recurring: 'all',
  amountMin: '',
  amountMax: '',
};
