import { describe, expect, it } from 'vitest';
import { groupPaymentSchedule, describeNextPayment, toScheduleItem } from './paymentSchedule';

const TODAY = '2026-09-02';

function timelineItem(over: Record<string, any> = {}): Record<string, any> {
  return {
    obligation_id: over.obligation_id ?? 'ob-1',
    obligation_type: 'RENT',
    label: 'Rent Due - Sep 2026',
    amount: 7500,
    paid: 0,
    remaining: 7500,
    due_date: '2026-09-05',
    paid_date: null,
    period_start: '2026-09-01',
    rent_month: '2026-09-01',
    state: 'upcoming',
    payment_method: null,
    reference_number: null,
    ...over,
  };
}

describe('toScheduleItem', () => {
  it('drops pure payment / credit events', () => {
    expect(toScheduleItem({ obligation_id: 'x', obligation_type: 'PAYMENT' })).toBeNull();
    expect(toScheduleItem({ obligation_id: 'x', obligation_type: 'RENT_CREDIT' })).toBeNull();
  });

  it('surfaces paid date + method only for settled rows', () => {
    const paid = toScheduleItem(timelineItem({ state: 'paid', paid: 7500, remaining: 0, paid_date: '2026-08-08', payment_method: 'UPI' }));
    expect(paid?.paidDate).toBe('2026-08-08');
    expect(paid?.method).toBe('UPI');

    const upcoming = toScheduleItem(timelineItem({ state: 'upcoming', paid_date: '2026-09-01' }));
    expect(upcoming?.paidDate).toBeNull();
  });
});

describe('groupPaymentSchedule', () => {
  it('splits overdue / upcoming / paid', () => {
    const schedule = groupPaymentSchedule(
      [
        timelineItem({ obligation_id: 'aug', due_date: '2026-08-05', rent_month: '2026-08-01', period_start: '2026-08-01', state: 'overdue' }),
        timelineItem({ obligation_id: 'sep', due_date: '2026-09-05', state: 'upcoming' }),
        timelineItem({ obligation_id: 'jul', due_date: '2026-07-05', rent_month: '2026-07-01', period_start: '2026-07-01', state: 'paid', paid: 7500, remaining: 0, paid_date: '2026-07-05' }),
      ],
      null,
      TODAY,
    );
    expect(schedule.overdue.map((i) => i.id)).toEqual(['aug']);
    expect(schedule.upcoming.map((i) => i.id)).toEqual(['sep']);
    expect(schedule.paid.map((i) => i.id)).toEqual(['jul']);
  });

  it('next payment is the earliest still-owed obligation', () => {
    const schedule = groupPaymentSchedule(
      [
        timelineItem({ obligation_id: 'sep', due_date: '2026-09-05', state: 'upcoming' }),
        timelineItem({ obligation_id: 'oct', due_date: '2026-10-05', state: 'upcoming' }),
      ],
      null,
      TODAY,
    );
    expect(schedule.next).toMatchObject({ dueDate: '2026-09-05', projected: false, amount: 7500 });
  });

  it('falls back to the projected installment when nothing is owed', () => {
    const schedule = groupPaymentSchedule(
      [timelineItem({ state: 'paid', paid: 7500, remaining: 0, paid_date: '2026-09-01' })],
      { next_installment_amount: 7500, next_installment_due_date: '2026-10-05', period_start: '2026-10-01' },
      TODAY,
    );
    expect(schedule.next).toMatchObject({ dueDate: '2026-10-05', projected: true, amount: 7500 });
  });

  it('returns no next payment when nothing is owed and no projection is given', () => {
    const schedule = groupPaymentSchedule(
      [timelineItem({ state: 'paid', paid: 7500, remaining: 0 })],
      null,
      TODAY,
    );
    expect(schedule.next).toBeNull();
  });
});

describe('describeNextPayment', () => {
  it('formats an upcoming payment', () => {
    const label = describeNextPayment({ amount: 7500, dueDate: '2026-09-05', projected: false, billingPeriodLabel: 'Sep 2026' }, TODAY);
    expect(label).toMatchObject({ amount: '₹7,500', timing: 'in 3 days', isOverdue: false });
  });

  it('formats an overdue payment', () => {
    const label = describeNextPayment({ amount: 7500, dueDate: '2026-08-30', projected: false, billingPeriodLabel: 'Aug 2026' }, TODAY);
    expect(label).toMatchObject({ timing: '3 days late', isOverdue: true });
  });

  it('formats "due today"', () => {
    const label = describeNextPayment({ amount: 7500, dueDate: TODAY, projected: false, billingPeriodLabel: null }, TODAY);
    expect(label.timing).toBe('Due today');
  });

  it('says "Nothing due" for a null next', () => {
    expect(describeNextPayment(null, TODAY)).toMatchObject({ timing: 'Nothing due', amount: null });
  });

  it('marks a projection', () => {
    const label = describeNextPayment({ amount: 7500, dueDate: '2026-10-05', projected: true, billingPeriodLabel: 'Oct 2026' }, TODAY);
    expect(label.projected).toBe(true);
    expect(label.multiMonth).toBe(false);
  });

  it('flags a multi-month (quarterly) installment', () => {
    const label = describeNextPayment(
      { amount: 22500, dueDate: '2026-10-05', projected: true, billingPeriodLabel: 'Oct–Dec 2026' },
      TODAY,
    );
    expect(label).toMatchObject({ amount: '₹22,500', multiMonth: true, periodLabel: 'Oct–Dec 2026' });
  });
});

describe('groupPaymentSchedule — multi-month period labels', () => {
  it('labels a quarterly projection as a month range', () => {
    const schedule = groupPaymentSchedule(
      [],
      {
        next_installment_amount: 22500,
        next_installment_due_date: '2026-10-05',
        period_start: '2026-10-01',
        period_end: '2026-12-31',
      },
      TODAY,
    );
    expect(schedule.next?.billingPeriodLabel).toBe('Oct–Dec 2026');
  });
});
