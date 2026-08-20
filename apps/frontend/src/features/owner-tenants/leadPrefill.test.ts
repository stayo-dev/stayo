import { describe, it, expect } from 'vitest';
import { leadToInviteWizardData } from './leadPrefill';

describe('leadToInviteWizardData', () => {
  it('maps the enquiry fields the owner should not have to retype', () => {
    expect(
      leadToInviteWizardData({
        student_name: 'Harsha',
        student_phone: '9876543210',
        student_email: 'harsha@gmail.com',
        hostel_id: 'hostel-1',
      })
    ).toEqual({
      tenantName: 'Harsha',
      tenantPhone: '9876543210',
      tenantEmail: 'harsha@gmail.com',
      hostelId: 'hostel-1',
    });
  });

  it('omits fields the lead never captured, rather than overwriting with blanks', () => {
    expect(leadToInviteWizardData({ student_name: 'Harsha', student_phone: null, student_email: null, hostel_id: 'hostel-1' }))
      .toEqual({ tenantName: 'Harsha', hostelId: 'hostel-1' });
  });

  it('produces an empty object for a lead with nothing usable', () => {
    expect(leadToInviteWizardData({})).toEqual({});
  });
});
