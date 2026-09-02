import { describe, expect, it } from 'vitest';
import {
  requiredKycDocTypes,
  isDocUploaded,
  missingKycDocs,
  canContinuePastDocuments,
  kycDocLabel,
} from './onboardingKyc';

describe('onboardingKyc', () => {
  describe('requiredKycDocTypes', () => {
    it('is Aadhaar + College ID for students (and the default)', () => {
      expect(requiredKycDocTypes('STUDENT')).toEqual(['AADHAAR', 'COLLEGE_ID']);
      expect(requiredKycDocTypes(null)).toEqual(['AADHAAR', 'COLLEGE_ID']);
      expect(requiredKycDocTypes(undefined)).toEqual(['AADHAAR', 'COLLEGE_ID']);
      expect(requiredKycDocTypes('student')).toEqual(['AADHAAR', 'COLLEGE_ID']);
    });

    it('is Aadhaar + Work ID for working professionals', () => {
      expect(requiredKycDocTypes('WORKING_PROFESSIONAL')).toEqual(['AADHAAR', 'WORK_ID']);
    });
  });

  describe('isDocUploaded', () => {
    it('treats PENDING / APPROVED / VERIFIED as uploaded', () => {
      expect(isDocUploaded({ doc_type: 'AADHAAR', document_status: 'PENDING' })).toBe(true);
      expect(isDocUploaded({ doc_type: 'AADHAAR', document_status: 'APPROVED' })).toBe(true);
      expect(isDocUploaded({ doc_type: 'AADHAAR', document_status: 'VERIFIED' })).toBe(true);
    });

    it('does not count missing or rejected', () => {
      expect(isDocUploaded(undefined)).toBe(false);
      expect(isDocUploaded({ doc_type: 'AADHAAR', document_status: 'MISSING' })).toBe(false);
      expect(isDocUploaded({ doc_type: 'AADHAAR', document_status: 'REJECTED' })).toBe(false);
    });
  });

  describe('missingKycDocs / canContinuePastDocuments', () => {
    it('blocks until every required student doc is uploaded', () => {
      expect(missingKycDocs('STUDENT', [])).toEqual(['AADHAAR', 'COLLEGE_ID']);
      expect(
        missingKycDocs('STUDENT', [{ doc_type: 'AADHAAR', document_status: 'PENDING' }]),
      ).toEqual(['COLLEGE_ID']);
      expect(canContinuePastDocuments('STUDENT', [{ doc_type: 'AADHAAR', document_status: 'PENDING' }])).toBe(false);
    });

    it('allows continuing once both are uploaded, even if only PENDING', () => {
      const items = [
        { doc_type: 'AADHAAR', document_status: 'PENDING' },
        { doc_type: 'COLLEGE_ID', document_status: 'PENDING' },
      ];
      expect(missingKycDocs('STUDENT', items)).toEqual([]);
      expect(canContinuePastDocuments('STUDENT', items)).toBe(true);
    });

    it('re-blocks a rejected document', () => {
      const items = [
        { doc_type: 'AADHAAR', document_status: 'APPROVED' },
        { doc_type: 'COLLEGE_ID', document_status: 'REJECTED', rejection_reason: 'Blurry' },
      ];
      expect(missingKycDocs('STUDENT', items)).toEqual(['COLLEGE_ID']);
      expect(canContinuePastDocuments('STUDENT', items)).toBe(false);
    });

    it('uses the working-professional set when the type is switched', () => {
      const items = [
        { doc_type: 'AADHAAR', document_status: 'PENDING' },
        { doc_type: 'COLLEGE_ID', document_status: 'APPROVED' },
      ];
      expect(missingKycDocs('WORKING_PROFESSIONAL', items)).toEqual(['WORK_ID']);
    });
  });

  it('labels the doc types', () => {
    expect(kycDocLabel('AADHAAR')).toBe('Aadhaar');
    expect(kycDocLabel('COLLEGE_ID')).toBe('College ID');
    expect(kycDocLabel('WORK_ID')).toBe('Work ID');
    expect(kycDocLabel('UNKNOWN')).toBe('UNKNOWN');
  });
});
