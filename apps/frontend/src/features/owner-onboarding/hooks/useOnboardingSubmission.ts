import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { onboardingApi } from '../api/onboardingApi';
import { hostelLeadsApi } from '@features/hostel-leads/api';
import type { OwnerOnboardingStateApi } from './useOwnerOnboardingState';

/** The backend's 409 for a taken email (see /api/auth/owner-signup). */
const isAlreadyRegistered = (error: unknown) => {
  const err = (error as { response?: { status?: number; data?: { error?: { code?: string } } } })?.response;
  return err?.status === 409 || err?.data?.error?.code === 'ALREADY_EXISTS';
};

const getErrorMessage = (error: unknown, fallback: string) => {
  const data = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data;
  return data?.error?.message || fallback;
};

/**
 * Wraps `useOwnerOnboardingState` with the real backend calls that turn
 * account creation and hostel/floor/room setup from local wizard state into
 * actual database rows — see the onboarding-backend-integration plan for why
 * this lives as a separate hook rather than folding into
 * `useOwnerOnboardingState` (that hook stays a faithful, backend-agnostic
 * port of the design's own state shape).
 *
 * `leadToken` (owner-acquisition funnel phase 2): present only when this
 * wizard run was reached via a lead activation link. Threaded into
 * owner-signup (server-side marks the lead OWNER_ACTIVATED) and, after
 * publish finishes, into a trailing "mark LIVE" call — both no-ops when
 * absent, so a normal signup is completely unaffected.
 */
export function useOnboardingSubmission(s: OwnerOnboardingStateApi, leadToken?: string) {
  const { login, user } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accountReady, setAccountReady] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const completeSignup = async () => {
    const email = s.data.email.trim();
    try {
      await onboardingApi.ownerSignup({
        name: s.data.name.trim(),
        email,
        password,
        phone: s.data.mobile.trim(),
        ...(leadToken ? { lead_token: leadToken } : {}),
      });
    } catch (error) {
      // The email already has a Stayo account — most often because this same
      // person got partway through before. Don't dead-end them on a raw
      // "Email already registered": if the password they just typed is the
      // right one, log them in and carry on with the wizard.
      if (!isAlreadyRegistered(error)) throw error;
      try {
        await login(email, password);
        setAccountReady(true);
        s.setOtpOpen(false);
        s.go(s.step + 1);
        stayoToast.success('You already had an account — signed you in.');
        return;
      } catch {
        throw new Error(
          'This email already has a Stayo account, and that password did not match. Log in instead, or reset your password.',
        );
      }
    }
    await login(email, password);
    setAccountReady(true);
    s.setOtpOpen(false);
    s.go(s.step + 1);
  };

  const submitAccount = async () => {
    // Already created and signed in — stepping back and forward again must not
    // try to register a second time (it would 409 and stall the wizard).
    if (accountReady || user) {
      s.go(s.step + 1);
      return;
    }
    if (!s.data.name.trim() || !s.data.mobile.trim() || !s.data.email.trim() || !password.trim()) {
      stayoToast.error('Fill in your name, mobile, email, and a password to continue.');
      return;
    }
    if (password.trim().length < 8) {
      stayoToast.error('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      stayoToast.error('Both passwords must match.');
      return;
    }
    setSendingOtp(true);
    try {
      const result = await onboardingApi.sendPhoneOtp(s.data.mobile.trim());

      // No code is coming — WhatsApp is unavailable and the backend has
      // recorded the number as unverified. Create the account directly.
      if (result.verification_required === false) {
        await completeSignup();
        return;
      }

      setOtpCode('');
      s.setOtpOpen(true);
    } catch (error) {
      stayoToast.error(getErrorMessage(error, 'Could not create your account. Please try again.'));
    } finally {
      setSendingOtp(false);
    }
  };

  const submitOtp = async () => {
    if (otpCode.trim().length !== 6) {
      stayoToast.error('Enter the 6-digit code.');
      return;
    }
    setVerifyingOtp(true);
    try {
      await onboardingApi.verifyPhoneOtp(s.data.mobile.trim(), otpCode.trim());
      await completeSignup();
    } catch (error) {
      stayoToast.error(getErrorMessage(error, 'Verification failed. Check the code and try again.'));
    } finally {
      setVerifyingOtp(false);
    }
  };

  const submitPublish = async () => {
    setPublishing(true);
    try {
      const hostel = await onboardingApi.createHostel({
        name: s.data.hostelName.trim() || 'My Hostel',
        address: s.data.address.trim(),
        city: s.data.city.trim() || undefined,
      });

      for (let floorNum = 1; floorNum <= s.data.floors; floorNum++) {
        const floor = await onboardingApi.createFloor({
          hostelId: hostel.id,
          name: `Floor ${floorNum}`,
          sort_order: floorNum,
        });
        for (let roomNum = 1; roomNum <= s.data.roomsPerFloor; roomNum++) {
          await onboardingApi.createRoom({
            hostelId: hostel.id,
            room_no: `${floorNum}${String(roomNum).padStart(2, '0')}`,
            capacity: s.data.bedsPerRoom,
            floor_id: floor.id,
          });
        }
      }

      if (leadToken) {
        try {
          await hostelLeadsApi.completeInvitation(leadToken);
        } catch (err) {
          console.error('[useOnboardingSubmission] lead-complete side effect failed (non-fatal)', err);
        }
      }

      s.go(s.step + 1);
    } catch (error) {
      stayoToast.error(getErrorMessage(error, 'Could not publish your hostel. Please try again.'));
    } finally {
      setPublishing(false);
    }
  };

  return {
    accountReady: accountReady || Boolean(user),
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    otpCode,
    setOtpCode,
    sendingOtp,
    verifyingOtp,
    publishing,
    submitAccount,
    submitOtp,
    submitPublish,
  };
}
