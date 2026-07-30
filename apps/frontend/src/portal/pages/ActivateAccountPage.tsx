import { FormEvent, InputHTMLAttributes, ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BadgeIndianRupee,
  Building2,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  DoorOpen,
  Download,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Lock,
  Receipt,
  ShieldCheck,
  Unlock,
  UserRound,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import { tenantService } from '@features/tenants/api';
import { useAuth } from '@context/AuthContext';
import { SignaturePad } from '@shared/ui/inputs';

type ActivationStep = 'ACCOUNT' | 'RULES' | 'AGREEMENT' | 'PROFILE' | 'ACTIVATE';

type ActivationContext = {
  activation_state: {
    current_step: ActivationStep;
    completed_steps: ActivationStep[];
    blocked_steps: ActivationStep[];
    account_setup_completed: boolean;
    rules_accepted: boolean;
    agreement_signed: boolean;
    profile_completed: boolean;
    documents_uploaded: boolean;
    activation_completed: boolean;
  };
  current_step: ActivationStep;
  profile: { name?: string; email?: string; phone?: string };
  tenant: Record<string, string | number | null | undefined>;
  hostel: { name?: string; logo_url?: string; address?: string; phone?: string };
  room_summary: Record<string, string | number | boolean | string[] | null | undefined>;
  rules: {
    title?: string;
    version?: string;
    content?: { categories?: RuleCategory[] };
    required_acknowledgements?: string[];
  };
  agreement: {
    id: string;
    status: string;
    signed_at?: string | null;
    pdf_url?: string | null;
    content_snapshot: Record<string, any>;
    tenant_signature_url?: string | null;
    tenant_signature_name?: string | null;
    tenant_signed_at?: string | null;
    guardian_signature_url?: string | null;
    guardian_signature_name?: string | null;
    guardian_relation?: string | null;
    guardian_signed_at?: string | null;
    owner_signature_url?: string | null;
    owner_signature_name?: string | null;
    owner_signed_at?: string | null;
  } | null;
  documents: { uploaded_count?: number; verification_status?: string };
  missing_fields?: { tier_1_required?: string[] };
};

type RuleCategory = {
  id: string;
  title: string;
  severity?: 'standard' | 'important' | 'critical';
  icon?: string;
  highlights?: string[];
  rules?: string[];
};

type ProfileDraft = {
  profile: Record<string, string>;
  selectedCollege: string;
  selectedCourse: string;
  photoUrl: string;
  guardianOtpVerified?: boolean;
  guardianVerifiedPhone?: string;
  savedAt: number;
};

function normalizeActivationToken(value: string | null | undefined) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }

  return decoded
    .replace(/^\/?(activate|invite)\//i, '')
    .replace(/^(\{\{4\}\}|\{\{1\}\}|%7B%7B4%7D%7D|%7B%7B1%7D%7D|\{1\}|%7B1%7D)+/i, '')
    .trim();
}

const currency = (value: unknown) =>
  Number(value || 0).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });

const fmtDate = (value: unknown) =>
  value ? new Date(String(value)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const phoneDigits = (value: unknown) => String(value || '').replace(/\D/g, '').slice(-10);

const activationSteps: { id: ActivationStep; label: string; helper: string }[] = [
  { id: 'ACCOUNT', label: 'Welcome', helper: 'Confirm stay & mobile' },
  { id: 'RULES', label: 'Rules', helper: 'Read and accept' },
  { id: 'AGREEMENT', label: 'Agreement', helper: 'Sign contract' },
  { id: 'PROFILE', label: 'Identity', helper: 'Verify details' },
  { id: 'ACTIVATE', label: 'Activate', helper: 'Create password' },
];

const visualSteps: { id: 'ACCOUNT' | 'AGREEMENT' | 'PROFILE' | 'ACTIVATE'; label: string; helper: string }[] = [
  { id: 'ACCOUNT', label: 'Welcome', helper: 'Confirm stay & mobile' },
  { id: 'AGREEMENT', label: 'Agreement', helper: 'Rules & contract' },
  { id: 'PROFILE', label: 'Identity', helper: 'Verify details' },
  { id: 'ACTIVATE', label: 'Activate', helper: 'Create password' },
];

const guardianRelations = ['Father', 'Mother', 'Brother', 'Sister', 'Uncle', 'Aunt', 'Grandparent', 'Spouse', 'Other'];

const activationMessages = [
  'Activating your account...',
  'Setting up your room access...',
  'Preparing tenant portal...',
];

function passwordStrength(password: string) {
  let score = 0;
  const suggestions: string[] = [];

  if (password.length >= 8) {
    score += 1;
  } else {
    suggestions.push('Use at least 8 characters');
  }

  if (/[A-Z]/.test(password)) {
    score += 1;
  } else {
    suggestions.push('Add one uppercase letter');
  }

  if (/[0-9]/.test(password)) {
    score += 1;
  } else {
    suggestions.push('Add one number');
  }

  if (/[^A-Za-z0-9]/.test(password)) {
    score += 1;
  } else {
    suggestions.push('Add one symbol');
  }

  if (score <= 1) {
    return {
      label: 'Weak',
      width: '25%',
      color: 'bg-red-500',
      textColor: 'text-red-700',
      suggestions,
    };
  }
  if (score === 2) {
    return {
      label: 'Fair',
      width: '50%',
      color: 'bg-amber-500',
      textColor: 'text-amber-700',
      suggestions,
    };
  }
  if (score === 3) {
    return {
      label: 'Good',
      width: '75%',
      color: 'bg-lime-500',
      textColor: 'text-lime-700',
      suggestions,
    };
  }
  return {
    label: 'Strong',
    width: '100%',
    color: 'bg-emerald-500',
    textColor: 'text-emerald-700',
    suggestions: [],
  };
}

function duplicatePhoneMessage(values: { primary?: string; emergency?: string; guardian?: string }) {
  const entries = [
    ['Primary mobile', phoneDigits(values.primary)],
    ['Emergency mobile', phoneDigits(values.emergency)],
    ['Guardian mobile', phoneDigits(values.guardian)],
  ].filter(([, value]) => String(value || '').length > 0);

  for (const [, value] of entries) {
    if (String(value).length !== 10) continue;
    const matches = entries.filter(([, candidate]) => candidate === value);
    if (matches.length > 1) {
      return `${matches.map(([label]) => label).join(' and ')} must be different numbers.`;
    }
  }
  return '';
}

function invalidPhoneMessage(
  values: { primary?: string; emergency?: string; guardian?: string },
  fields?: ('primary' | 'emergency' | 'guardian')[]
) {
  const allEntries = [
    ['primary', 'Primary mobile', values.primary, true],
    ['emergency', 'Emergency mobile', values.emergency, true],
    ['guardian', 'Guardian mobile', values.guardian, false],
  ] as const;

  const entries = fields
    ? allEntries.filter(([k]) => fields.includes(k))
    : allEntries;

  for (const [, label, value, required] of entries) {
    const rawValue = String(value || '').trim();
    const digits = rawValue.replace(/\D/g, '');
    if (!rawValue && !required) continue;
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return `${label} must be a valid 10-digit Indian mobile number.`;
    }
  }
  return '';
}

function profileDraftKey(token: string) {
  return `hms:tenant-activation:${token}:profile-draft`;
}

function readProfileDraft(token: string): ProfileDraft | null {
  if (!token || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(profileDraftKey(token));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProfileDraft>;
    if (!parsed.profile || typeof parsed.profile !== 'object') return null;
    return {
      profile: parsed.profile as Record<string, string>,
      selectedCollege: String(parsed.selectedCollege || ''),
      selectedCourse: String(parsed.selectedCourse || ''),
      photoUrl: String(parsed.photoUrl || ''),
      guardianOtpVerified: Boolean(parsed.guardianOtpVerified),
      guardianVerifiedPhone: String(parsed.guardianVerifiedPhone || ''),
      savedAt: Number(parsed.savedAt || Date.now()),
    };
  } catch {
    return null;
  }
}

function writeProfileDraft(token: string, draft: Omit<ProfileDraft, 'savedAt'>) {
  if (!token || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(profileDraftKey(token), JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // Local draft save is best-effort. Backend save still remains authoritative.
  }
}

function clearProfileDraft(token: string) {
  if (!token || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(profileDraftKey(token));
  } catch {
    // Ignore storage failures.
  }
}

const fieldClass =
  'mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20';

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  helperText,
  inputMode,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  helperText?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode'];
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-muted-foreground">
        {label}
        {required ? ' *' : ''}
      </span>
      <input type={type} inputMode={inputMode} value={value} onChange={(e) => onChange(e.target.value)} className={`${fieldClass} disabled:bg-muted/40 disabled:text-muted-foreground`} disabled={disabled} />
      {helperText ? <span className="mt-1 block text-xs text-muted-foreground">{helperText}</span> : null}
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block sm:col-span-2">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className={`${fieldClass} resize-none`} />
    </label>
  );
}

function RuleIcon({ icon }: { icon?: string }) {
  const cls = 'w-4 h-4';
  if (icon === 'receipt') return <Receipt className={cls} />;
  if (icon === 'lock') return <Lock className={cls} />;
  if (icon === 'wifi') return <Wifi className={cls} />;
  if (icon === 'alert-triangle') return <AlertTriangle className={cls} />;
  if (icon === 'door-open') return <DoorOpen className={cls} />;
  return <ShieldCheck className={cls} />;
}function Progress({
  ctx,
  activeStep,
  onStepClick,
}: {
  ctx: ActivationContext;
  activeStep: ActivationStep;
  onStepClick: (step: ActivationStep) => void;
}) {
  const completed = new Set(ctx?.completed_steps ?? ctx?.activation_state?.completed_steps ?? []);
  const current = ctx?.current_step ?? ctx?.activation_state?.current_step ?? 'ACCOUNT';
  
  const getStepVisualIndex = (stepId: ActivationStep) => {
    if (stepId === 'ACCOUNT') return 0;
    if (stepId === 'RULES' || stepId === 'AGREEMENT') return 1;
    if (stepId === 'PROFILE') return 2;
    if (stepId === 'ACTIVATE') return 3;
    return 0;
  };

  const currentIndex = getStepVisualIndex(current);
  const activeIndex = getStepVisualIndex(activeStep);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-bold text-accent">Step {Math.max(1, activeIndex + 1)} of {visualSteps.length}</span>
        <span className="text-muted-foreground">{visualSteps.length - Math.max(1, activeIndex + 1)} steps remaining</span>
      </div>
      <div className="flex items-center gap-0">
        {visualSteps.map((step, i) => {
          const done = step.id === 'AGREEMENT' 
            ? completed.has('AGREEMENT') 
            : completed.has(step.id);
             
          const active = step.id === 'AGREEMENT'
            ? (activeStep === 'RULES' || activeStep === 'AGREEMENT')
            : activeStep === step.id;

          const stepIndex = getStepVisualIndex(step.id);

          return (
            <div key={step.id} className="flex-1 flex items-center">
              <div className={`h-1.5 rounded-full flex-1 transition-colors duration-300 ${
                done || active || (stepIndex <= activeIndex) ? 'bg-accent' : 'bg-muted'
              }`} />
              {i < visualSteps.length - 1 && <div className="w-1" />}
            </div>
          );
        })}
      </div>
      
      {/* Pill navigation buttons */}
      <div className="flex items-center gap-1.5 overflow-x-auto py-1 no-scrollbar scroll-smooth">
        {visualSteps.map((step, i) => {
          const done = step.id === 'AGREEMENT' 
            ? completed.has('AGREEMENT') 
            : completed.has(step.id);
             
          const active = step.id === 'AGREEMENT'
            ? (activeStep === 'RULES' || activeStep === 'AGREEMENT')
            : activeStep === step.id;

          const clickable = getStepVisualIndex(step.id) <= getStepVisualIndex(current);

          return (
            <button
              key={step.id}
              type="button"
              disabled={!clickable}
              onClick={() => {
                if (step.id === 'AGREEMENT') {
                  if (current === 'RULES' || current === 'AGREEMENT') {
                    onStepClick(current);
                  } else {
                    onStepClick('AGREEMENT');
                  }
                } else {
                  onStepClick(step.id);
                }
              }}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-bold transition-all shrink-0 border ${
                active 
                  ? 'bg-accent border-accent text-accent-foreground shadow-sm shadow-accent/20' 
                  : done 
                  ? 'bg-emerald-500/10 border-emerald-200 text-emerald-700 hover:bg-emerald-500/20' 
                  : clickable
                  ? 'bg-secondary border-border text-foreground hover:bg-secondary/80'
                  : 'bg-muted/30 border-transparent text-muted-foreground opacity-40 cursor-not-allowed'
              }`}
            >
              <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black ${
                active ? 'bg-white text-accent' : done ? 'bg-emerald-500 text-white' : 'bg-muted-foreground/20 text-muted-foreground'
              }`}>
                {done ? '✓' : i + 1}
              </span>
              <span>{step.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ActivateAccountPage() {
  const { token: pathToken } = useParams();
  const [searchParams] = useSearchParams();
  const token = normalizeActivationToken(pathToken || searchParams.get('token'));
  const navigate = useNavigate();
  const { login } = useAuth();

  const [ctx, setCtx] = useState<ActivationContext | null>(null);
  const [checking, setChecking] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [invalidCode, setInvalidCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [lastPassword, setLastPassword] = useState('');
  const [visibleStep, setVisibleStep] = useState<ActivationStep | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [activationProgress, setActivationProgress] = useState(0);
  const [profileDraftReady, setProfileDraftReady] = useState(false);
  const [profileDraftStatus, setProfileDraftStatus] = useState<'idle' | 'restored' | 'saving' | 'saved'>('idle');
  const [photoUploading, setPhotoUploading] = useState(false);
  const [paymentFrequency, setPaymentFrequency] = useState('MONTHLY');

  const [account, setAccount] = useState({ password: '', confirm_password: '', phone: '', otp: '', email: '' });
  const [otpSent, setOtpSent] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [otpCountdown, setOtpCountdown] = useState(0);

  // Guardian OTP Verification state
  const [guardianOtpSent, setGuardianOtpSent] = useState(false);
  const [guardianOtpSending, setGuardianOtpSending] = useState(false);
  const [guardianOtpCountdown, setGuardianOtpCountdown] = useState(0);
  const [guardianOtp, setGuardianOtp] = useState('');
  const [guardianOtpVerified, setGuardianOtpVerified] = useState(false);
  const [guardianVerifiedPhone, setGuardianVerifiedPhone] = useState('');
  const [guardianOtpVerifying, setGuardianOtpVerifying] = useState(false);

  // Override / Unlock states to allow editing verified numbers
  const [guardianOverrideUnlocked, setGuardianOverrideUnlocked] = useState(false);

  // Success Pop-up Modal State
  const [showSuccessModal, setShowSuccessModal] = useState<null | { title: string; message: string }>(null);

  // Agreement Signature State
  const [tenantSigBlob, setTenantSigBlob] = useState<Blob | null>(null);
  const [tenantSigName, setTenantSigName] = useState('');
  const [guardianSigBlob, setGuardianSigBlob] = useState<Blob | null>(null);
  const [isGuardianLocked, setIsGuardianLocked] = useState(true);
  const [activeSigType, setActiveSigType] = useState<'tenant' | 'guardian' | null>(null);

  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [showAgreementPreview, setShowAgreementPreview] = useState(false);

  const [profile, setProfile] = useState<Record<string, string>>({
    phone: '',
    gender: '',
    date_of_birth: '',
    permanent_address: '',
    temporary_address: '',
    profile_type: 'STUDENT',
    college_name: '',
    course: '',
    year_of_study: '',
    branch: '',
    roll_number: '',
    office_name: '',
    office_location: '',
    job_role: '',
    guardian_name: '',
    guardian_phone: '',
    guardian_relation: '',
    emergency_phone: '',
  });

  const [selectedCollege, setSelectedCollege] = useState<string>('');
  const [selectedCourse, setSelectedCourse] = useState<string>('');
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<string>('');

  useEffect(() => {
    if (otpCountdown <= 0) return;
    const timer = window.setTimeout(() => {
      setOtpCountdown((c) => c - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [otpCountdown]);

  useEffect(() => {
    if (guardianOtpCountdown <= 0) return;
    const timer = window.setTimeout(() => {
      setGuardianOtpCountdown((c) => c - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [guardianOtpCountdown]);



  useEffect(() => {
    if (showSuccessModal) {
      const timer = setTimeout(() => {
        setShowSuccessModal(null);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [showSuccessModal]);

  const handleSendGuardianOtp = async () => {
    const phone = (profile.guardian_phone || '').trim();
    if (!phone) {
      setError('Please enter a parent/guardian mobile number first.');
      return;
    }
    const invalidMessage = invalidPhoneMessage({
      guardian: phone,
    }, ['guardian']);
    if (invalidMessage) {
      setError(invalidMessage);
      return;
    }
    const duplicateMessage = duplicatePhoneMessage({
      primary: profile.phone,
      guardian: phone,
    });
    if (duplicateMessage) {
      setError(duplicateMessage);
      return;
    }

    setGuardianOtpSending(true);
    setError('');
    try {
      await tenantService.sendPhoneOtp({
        phone,
        purpose: 'ParentVerify',
      });
      setGuardianOtpSent(true);
      setGuardianOtpCountdown(60);
    } catch (err: any) {
      const message =
        err?.response?.data?.error?.message ||
        err?.message ||
        'Could not send verification code to guardian';
      setError(message);
    } finally {
      setGuardianOtpSending(false);
    }
  };

  const handleVerifyGuardianOtp = async () => {
    const phone = (profile.guardian_phone || '').trim();
    if (!phone) {
      setError('Please enter a parent/guardian mobile number.');
      return;
    }
    if (guardianOtp.length < 6) {
      setError('Please enter the 6-digit verification code.');
      return;
    }
    setGuardianOtpVerifying(true);
    setError('');
    try {
      await tenantService.verifyPhoneOtp({
        phone,
        otp: guardianOtp,
        purpose: 'ParentVerify',
      });
      setGuardianOtpVerified(true);
      setGuardianVerifiedPhone(phone);
      setGuardianOverrideUnlocked(false);
      setShowSuccessModal({
        title: 'Guardian Phone Verified',
        message: `OTP verification for your parent/guardian mobile number (+91 ${phone.slice(-10)}) was successful!`,
      });
      setError('');
    } catch (err: any) {
      const message =
        err?.response?.data?.error?.message ||
        err?.message ||
        'Verification failed. Invalid or expired code.';
      setError(message);
    } finally {
      setGuardianOtpVerifying(false);
    }
  };



  const isGuardianPhoneVerified =
    !guardianOverrideUnlocked &&
    Boolean(profile.guardian_phone) && (
      (ctx?.tenant?.guardian_phone && profile.guardian_phone === phoneDigits(ctx?.tenant?.guardian_phone) && ctx?.verification_status?.guardian_verified) ||
      (ctx?.tenant?.phone_2 && profile.guardian_phone === phoneDigits(ctx?.tenant?.phone_2) && ctx?.verification_status?.guardian_verified) ||
      (guardianOtpVerified && profile.guardian_phone === guardianVerifiedPhone)
    );



  const isStudent = String(profile.profile_type || ctx?.tenant?.profile_type || 'STUDENT').toUpperCase() === 'STUDENT';

  const handleSendOtp = async () => {
    const phone = account.phone.trim();
    if (!phone) {
      setError('Please enter your primary mobile number first.');
      return;
    }
    setOtpSending(true);
    setError('');
    try {
      await tenantService.sendPhoneOtp({
        phone,
        purpose: 'Registration',
      });
      setOtpSent(true);
      setOtpCountdown(60);
    } catch (err: any) {
      const message =
        err?.response?.data?.error?.message ||
        err?.message ||
        'Could not send verification code';
      setError(message);
    } finally {
      setOtpSending(false);
    }
  };

  // Agreement Signature State
  
  useEffect(() => {
    if (ctx) {
      const completed = new Set(ctx.completed_steps ?? ctx.activation_state?.completed_steps ?? []);
      if (completed.has('RULES') || ctx.activation_state?.rules_accepted) {
        setAcks({
          fee_refund_rules: true,
          discipline_policies: true,
          late_fee_obligations: true,
          damage_liabilities: true,
          hostel_rules: true,
        });
      }
    }
  }, [ctx]);

  const loadContext = async () => {
    if (!token) {
      setInvalid(true);
      setChecking(false);
      return;
    }
    setChecking(true);
    setProfileDraftReady(false);
    try {
      const data = await tenantService.getActivationContext(token);
      const draft = readProfileDraft(token);
      setCtx(data);
      setPaymentFrequency(String(data?.tenant?.payment_frequency || 'MONTHLY'));
      setProfilePhotoPreview(String(data.tenant?.photo_url || draft?.photoUrl || ''));
      setInvalid(false);
      setInvalidCode('');
      setError('');
      setAccount((prev) => ({
        ...prev,
        phone: prev.phone || phoneDigits(data.tenant?.phone_1 || data.profile?.phone),
        email: prev.email || '',
      }));

      const college = String(data.tenant?.college_name || '');
      if (college === 'Sreenidhi Institute of Science and Technology' || college === 'Sreenidhi University') {
        setSelectedCollege(college);
      } else if (college) {
        setSelectedCollege('Other');
      }

      const course = String(data.tenant?.course || '');
      if (course === 'B.Tech') {
        setSelectedCourse(course);
      } else if (course) {
        setSelectedCourse('Other');
      }

      if (draft?.selectedCollege) {
        setSelectedCollege(draft.selectedCollege);
      }
      if (draft?.selectedCourse) {
        setSelectedCourse(draft.selectedCourse);
      }

      const backendProfile = {
        phone: phoneDigits(data.tenant?.phone_1 || data.profile?.phone),
        gender: String(data.tenant?.gender || ''),
        date_of_birth: String(data.tenant?.date_of_birth || ''),
        permanent_address: String(data.tenant?.permanent_address || ''),
        temporary_address: String(data.tenant?.temporary_address || ''),
        profile_type: String(data.tenant?.profile_type || 'STUDENT'),
        college_name: college,
        course,
        year_of_study: String(data.tenant?.year_of_study || ''),
        branch: String(data.tenant?.branch || ''),
        roll_number: String(data.tenant?.roll_number || ''),
        office_name: String(data.tenant?.office_name || ''),
        office_location: String(data.tenant?.office_location || ''),
        job_role: String(data.tenant?.job_role || ''),
        guardian_name: String(data.tenant?.guardian_name || data.agreement?.guardian_signature_name || ''),
        guardian_phone: phoneDigits(data.tenant?.guardian_phone || data.tenant?.phone_2),
        guardian_relation: String(data.tenant?.guardian_relation || data.agreement?.guardian_relation || ''),
        emergency_phone: phoneDigits(data.tenant?.phone_3),
      };

      const mergedProfile = {
        ...backendProfile,
        ...(data.activation_state?.profile_completed ? {} : draft?.profile || {}),
      };

      setProfile(mergedProfile);
      
      const backendGuardianPhone = phoneDigits(data.tenant?.guardian_phone || data.tenant?.phone_2 || '');
      if (backendGuardianPhone) {
        setGuardianOtpVerified(true);
        setGuardianVerifiedPhone(backendGuardianPhone);
      } else if (draft?.guardianOtpVerified) {
        setGuardianOtpVerified(true);
        setGuardianVerifiedPhone(draft.guardianVerifiedPhone || '');
      }

      if (data.agreement) {
        setTenantSigName(String(data.agreement.tenant_signature_name || ''));
      }
      
      const hasGuardianDetails = Boolean(
        mergedProfile.guardian_name ||
        mergedProfile.guardian_relation
      );
      setIsGuardianLocked(hasGuardianDetails);

      if (data.activation_state?.profile_completed) {
        clearProfileDraft(token);
      }
      setProfileDraftStatus(draft && !data.activation_state?.profile_completed ? 'restored' : 'idle');
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        'This invitation link has expired or was already used.';
      const code =
        (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code || '';
      setInvalid(true);
      setInvalidCode(code);
      setError(message);
    } finally {
      setProfileDraftReady(true);
      setChecking(false);
    }
  };

  useEffect(() => {
    loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const currentStep = ctx?.current_step ?? ctx?.activation_state?.current_step;
  const completed = new Set(ctx?.completed_steps ?? ctx?.activation_state?.completed_steps ?? []);
  const activeStep = visibleStep || currentStep;
  const ruleCategories = ctx?.agreement?.content_snapshot?.hostel_rules?.categories ?? ctx?.rules?.content?.categories ?? [];
  const requiredAcks = ctx?.rules?.required_acknowledgements ?? [];
  const allAcksChecked = requiredAcks.length > 0 && requiredAcks.every((key) => acks[key] === true);
  const strength = passwordStrength(account.password);
  const activationStageIndex = activationProgress < 40 ? 0 : activationProgress < 78 ? 1 : 2;
  const activationProgressWidth = `${Math.max(8, Math.round(activationProgress))}%`;

  useEffect(() => {
    setVisibleStep(null);
  }, [ctx?.current_step, ctx?.activation_state?.current_step]);

  useEffect(() => {
    if (!(submitting && activeStep === 'ACTIVATE')) {
      setActivationProgress(0);
      return;
    }

    const startedAt = Date.now();
    setActivationProgress(8);
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const next =
        elapsed < 1800
          ? 8 + (elapsed / 1800) * 32
          : elapsed < 4600
            ? 40 + ((elapsed - 1800) / 2800) * 38
            : 78 + Math.min(((elapsed - 4600) / 6500) * 16, 16);
      setActivationProgress(next);
    }, 250);

    return () => window.clearInterval(timer);
  }, [activeStep, submitting]);

  useEffect(() => {
    if (!token || !ctx || !profileDraftReady || ctx.activation_state?.profile_completed) return;
    if (activeStep !== 'PROFILE') return;

    setProfileDraftStatus('saving');
    const timer = window.setTimeout(() => {
      writeProfileDraft(token, {
        profile,
        selectedCollege,
        selectedCourse,
        photoUrl: /^https?:\/\//.test(profilePhotoPreview) ? profilePhotoPreview : '',
        guardianOtpVerified,
        guardianVerifiedPhone,
      });
      setProfileDraftStatus('saved');
    }, 700);

    return () => window.clearTimeout(timer);
  }, [
    activeStep,
    ctx,
    profile,
    profileDraftReady,
    profilePhotoPreview,
    selectedCollege,
    selectedCourse,
    token,
    guardianOtpVerified,
    guardianVerifiedPhone,
  ]);

  const goToStep = (step: ActivationStep) => {
    const completed = new Set(ctx?.completed_steps ?? ctx?.activation_state?.completed_steps ?? []);
    const targetStep = step === 'RULES' ? 'AGREEMENT' : step;
    if (targetStep === currentStep || completed.has(targetStep)) {
      setError('');
      setVisibleStep(targetStep);
      setShowWelcome(false);
    }
  };

  const submitStep = async (step: ActivationStep, data: Record<string, unknown>) => {
    setSubmitting(true);
    setError('');
    try {
      const result = await tenantService.updateActivationWorkflow({ token, step, data });
      if (step === 'ACTIVATE' && typeof data.password === 'string') {
        setLastPassword(data.password);
      }
      if (step === 'ACTIVATE') {
        // Auto-login: the backend now sets hms_session + hms_refresh_token cookies
        // and returns session data in the response body
        const session = (result as any)?.session;
        if (session?.access_token && session?.refresh_token) {
          try {
            // ADR-031: hand the real Supabase session to the Supabase
            // client directly — it persists/refreshes itself from here.
            // AuthContext's own onAuthStateChange listener picks this up
            // and hydrates `user` from GET /auth/me; no more hand-written
            // localStorage.
            const { supabase } = await import('@lib/supabaseClient');
            const { queryClient } = await import('@lib/queryClient');
            queryClient.clear();
            const { error } = await supabase.auth.setSession({
              access_token: session.access_token,
              refresh_token: session.refresh_token,
            });
            if (error) throw error;

            navigate('/tenant/home', { replace: true });
            return true;
          } catch {
            // Session cookie was still set by the backend, try login page
            navigate('/login?signin=1', { replace: true });
            return true;
          }
        }

        // Fallback: no session in response, try traditional login
        const submittedPassword = String(data?.password || lastPassword || "");
        const email = ctx?.profile?.email || (ctx?.profile?.phone ? `${ctx.profile.phone}@hms.temp` : (ctx?.tenant?.phone_1 ? `${ctx.tenant.phone_1}@hms.temp` : ''));
        if (submittedPassword && email) {
          try {
            await login(email, submittedPassword);
            navigate('/tenant/home', { replace: true });
            return true;
          } catch {
            navigate('/login?signin=1', { replace: true });
            return true;
          }
        }
        navigate(result?.redirect_to || '/login?signin=1', { replace: true });
        return true;
      }
      setCtx(result as ActivationContext);
      setVisibleStep(null);
      return true;
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        'Could not save this step';
      setError(message);
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const accountSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const emailVal = (account.email || '').trim().toLowerCase();
    if (!emailVal) {
      setError('Gmail ID is required');
      return;
    }
    const gmailRegex = /^[a-zA-Z0-9._%+-]+@gmail\.com$/;
    if (!gmailRegex.test(emailVal)) {
      setError('Please enter a valid Gmail ID (e.g. name@gmail.com)');
      return;
    }

    const success = await submitStep('ACCOUNT', account);
    if (success) {
      setShowSuccessModal({
        title: 'Mobile Number Verified',
        message: `Your primary mobile number (+91 ${account.phone.slice(-10)}) has been successfully verified!`,
      });
    }
  };

  const handlePhotoChange = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Image must be under 2MB');
      return;
    }
    setProfilePhotoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setProfilePhotoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);

    setPhotoUploading(true);
    setError('');
    try {
      const uploadRes = await tenantService.uploadActivationPhoto(token, file);
      if (uploadRes?.photo_url) {
        setProfilePhotoPreview(uploadRes.photo_url);
        setProfilePhotoFile(null);
        writeProfileDraft(token, {
          profile,
          selectedCollege,
          selectedCourse,
          photoUrl: uploadRes.photo_url,
          guardianOtpVerified,
          guardianVerifiedPhone,
        });
        setProfileDraftStatus('saved');
      }
    } catch (err: any) {
      const message =
        err?.response?.data?.error?.message ||
        err?.message ||
        'Photo upload failed. You can try again or save after choosing the photo.';
      setError(message);
    } finally {
      setPhotoUploading(false);
    }
  };

  const agreementSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ctx) return;
    setError('');

    const existingTenantSigUrl = ctx.agreement?.tenant_signature_url || '';
    const existingGuardianSigUrl = ctx.agreement?.guardian_signature_url || '';
    const tenantSigNameValue = (tenantSigName || ctx.agreement?.tenant_signature_name || '').trim();
    const guardianSigNameValue = (profile.guardian_name || ctx.agreement?.guardian_signature_name || '').trim();
    const guardianRelationValue = (profile.guardian_relation || ctx.agreement?.guardian_relation || '').trim();
    const tenantHasSignatureImage = Boolean(tenantSigBlob || existingTenantSigUrl);
    const guardianHasSignatureImage = Boolean(guardianSigBlob || existingGuardianSigUrl);
    const tenantSignatureComplete = Boolean(tenantHasSignatureImage && tenantSigNameValue);
    const guardianSignatureComplete = Boolean(guardianHasSignatureImage && guardianSigNameValue && guardianRelationValue);

    if (tenantHasSignatureImage && !tenantSigNameValue) {
      setError('Your typed full name signature is required');
      return;
    }
    if (tenantSigNameValue && !tenantHasSignatureImage) {
      setError('Please draw your signature');
      return;
    }
    if (guardianHasSignatureImage && !guardianSigNameValue) {
      setError("Parent/Guardian typed full name signature is required");
      return;
    }
    if (guardianHasSignatureImage && !guardianRelationValue) {
      setError("Please select parent/guardian relationship");
      return;
    }
    if (!tenantSignatureComplete && !guardianSignatureComplete) {
      setError('Add at least one signature: tenant or parent/guardian.');
      return;
    }

    setSubmitting(true);
    try {
      // 1. Upload signatures that are part of this agreement signing.
      let tenantSigUrl = existingTenantSigUrl;
      if (tenantSignatureComplete && tenantSigBlob) {
        const tenantFile = new File([tenantSigBlob], 'tenant_signature.png', { type: 'image/png' });
        const tenantUpload = await tenantService.uploadActivationSignature(token, tenantFile, 'tenant');
        tenantSigUrl = tenantUpload.url;
      }

      let guardianSigUrl = existingGuardianSigUrl;
      if (guardianSignatureComplete && guardianSigBlob) {
        const guardianFile = new File([guardianSigBlob], 'guardian_signature.png', { type: 'image/png' });
        const guardianUpload = await tenantService.uploadActivationSignature(token, guardianFile, 'guardian');
        guardianSigUrl = guardianUpload.url;
      }

      // 2. Submit step to Activation State Machine
      const saved = await submitStep('AGREEMENT', {
        tenant_signature_url: tenantSignatureComplete ? tenantSigUrl : null,
        tenant_signature_name: tenantSignatureComplete ? tenantSigNameValue : null,
        guardian_signature_url: guardianSignatureComplete ? guardianSigUrl : null,
        guardian_signature_name: guardianSignatureComplete ? guardianSigNameValue : null,
        guardian_relation: guardianSignatureComplete ? guardianRelationValue : null,
      });

      if (saved) {
        // Clear local drawing state
        setTenantSigBlob(null);
        setGuardianSigBlob(null);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to submit agreement signature');
    } finally {
      setSubmitting(false);
    }
  };

  const profileSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isStudent) {
      if (!profile.guardian_name?.trim()) {
        setError('Parent/Guardian name is required.');
        return;
      }
      if (!profile.guardian_relation) {
        setError('Parent/Guardian relation is required.');
        return;
      }
      if (!profile.guardian_phone) {
        setError('Parent/Guardian phone number is required.');
        return;
      }
    }

    const invalidMessage = invalidPhoneMessage({
      primary: profile.phone,
      emergency: profile.emergency_phone,
      guardian: profile.guardian_phone,
    });
    if (invalidMessage) {
      setError(invalidMessage);
      return;
    }
    const duplicateMessage = duplicatePhoneMessage({
      primary: profile.phone,
      emergency: profile.emergency_phone,
      guardian: profile.guardian_phone,
    });
    if (duplicateMessage) {
      setError(duplicateMessage);
      return;
    }

    if (isStudent && !isGuardianPhoneVerified) {
      setError('Please verify the parent/guardian phone number first.');
      return;
    }
    if (profile.guardian_phone && !isGuardianPhoneVerified) {
      setError('Please verify the parent/guardian phone number first.');
      return;
    }

    if (!profile.emergency_phone) {
      setError('Emergency contact mobile number is required.');
      return;
    }


    if (!profilePhotoFile && !profilePhotoPreview) {
      setError('Profile photo is required');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      let photoUrl = profilePhotoPreview;
      if (profilePhotoFile) {
        const uploadRes = await tenantService.uploadActivationPhoto(token, profilePhotoFile);
        if (uploadRes?.photo_url) {
          photoUrl = uploadRes.photo_url;
        }
      }
      const saved = await submitStep('PROFILE', {
        ...profile,
        photo_url: photoUrl,
        guardian_otp: guardianOtp,
      });
      if (saved) {
        clearProfileDraft(token);
        setProfileDraftStatus('idle');
      }
    } catch (err: any) {
      const message =
        err?.response?.data?.error?.message ||
        err?.message ||
        'Failed to save profile or upload photo';
      setError(message);
      setSubmitting(false);
    }
  };

  const documentPending = ctx && !ctx.activation_state?.documents_uploaded;

  if (checking) {
    return (
      <div className="min-h-screen bg-background px-4 py-8">
        <div className="mx-auto grid w-full max-w-5xl gap-5 lg:grid-cols-[340px_1fr]">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="h-14 w-14 rounded-2xl bg-muted animate-pulse" />
            <div className="mt-5 h-3 rounded bg-muted animate-pulse" />
            <div className="mt-3 h-24 rounded-xl bg-muted animate-pulse" />
          </div>
          <div className="rounded-2xl border border-border bg-card p-6">
            <Loader2 className="w-8 h-8 animate-spin text-accent" />
            <p className="mt-4 text-sm font-medium text-foreground">Loading your setup</p>
            <p className="mt-1 text-sm text-muted-foreground">Checking the latest activation state...</p>
          </div>
        </div>
      </div>
    );
  }

  if (invalid || !ctx) {
    const title =
      invalidCode === 'ALREADY_ACTIVE'
        ? 'Account already active'
        : invalidCode === 'EXPIRED'
          ? 'Invitation expired'
          : invalidCode === 'CANCELLED'
            ? 'Invitation cancelled'
            : 'Invitation unavailable';
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center">
          <AlertTriangle className="w-7 h-7" />
        </div>
        <h1 className="mt-5 text-xl font-bold text-foreground">{title}</h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">{error || 'This activation link has expired or was already used.'}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={loadContext} className="rounded-xl border border-border px-4 py-2 text-sm font-semibold">
            Retry
          </button>
          <Link to="/login?signin=1" className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground">
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-5 sm:py-8">
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed left-1/2 top-4 z-[80] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-2xl shadow-amber-900/10"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <p className="min-w-0 flex-1 text-sm font-semibold leading-5 text-amber-900">{error}</p>
            <button
              type="button"
              onClick={() => setError('')}
              className="rounded-lg p-1 text-amber-700 transition-colors hover:bg-amber-100"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      <main className="mx-auto grid w-full max-w-6xl gap-5 lg:grid-cols-[360px_1fr]">
        <aside className="h-fit rounded-2xl overflow-hidden border border-border shadow-sm">
          <div
            className="px-5 py-4 relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #1B2D5B 0%, #243A72 100%)' }}
          >
            <div
              className="absolute inset-0 opacity-10"
              style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, #F07B1D 0%, transparent 60%)' }}
            />
            <div className="relative flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-white/15 ring-1 ring-white/20 flex items-center justify-center overflow-hidden shrink-0">
                {ctx.hostel.logo_url ? (
                  <img src={ctx.hostel.logo_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Building2 className="w-6 h-6 text-white/80" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60">Tenant admission</p>
                <h1
                  className="text-lg font-bold text-white truncate leading-tight"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {ctx.hostel.name}
                </h1>
              </div>
            </div>
          </div>

          <div className="bg-card p-5">
            <Progress ctx={ctx} activeStep={activeStep || ctx.activation_state?.current_step} onStepClick={goToStep} />

          <div className="mt-4 rounded-xl border border-border bg-secondary/40 px-4 py-2.5 text-sm flex items-center justify-between gap-3 flex-wrap">
            <span className="font-bold text-foreground">{String(ctx.room_summary.room_number || 'Room')} • {currency(ctx.room_summary.monthly_rent)}/month</span>
            <span className="text-xs text-muted-foreground">Starts {fmtDate(ctx.room_summary.billing_start_date)}</span>
          </div>
          </div>
        </aside>

        <section className="rounded-2xl border border-border bg-card p-5 pb-24 sm:p-6 sm:pb-6 shadow-sm">
          {activeStep === 'ACCOUNT' && !ctx.activation_state?.account_setup_completed && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold text-accent uppercase tracking-wider">Step 1 of {visualSteps.length}</p>
                <h2 className="mt-1 text-2xl font-black text-foreground tracking-tight">
                  Welcome to {ctx.hostel.name}
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Confirm your stay details and verify your mobile number to begin.
                </p>
              </div>

              {/* Allocation Stay Summary */}
              <div className="rounded-2xl border border-border bg-secondary/20 p-4 space-y-3.5 shadow-sm">
                <div className="flex items-center justify-between border-b border-border/50 pb-2">
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Room Allocation Details</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    Reserved
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-card border border-border/60 p-2.5">
                    <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Room</span>
                    <span className="text-base font-extrabold text-foreground">{ctx.room_summary.room_number || 'Assigned'}</span>
                  </div>
                  <div className="rounded-xl bg-card border border-border/60 p-2.5">
                    <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Monthly Rent</span>
                    <span className="text-base font-extrabold text-foreground">{currency(ctx.room_summary.monthly_rent)}</span>
                  </div>
                  <div className="rounded-xl bg-card border border-border/60 p-2.5">
                    <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Joining Date</span>
                    <span className="text-xs font-extrabold text-foreground block mt-1">{fmtDate(ctx.room_summary.joining_date)}</span>
                  </div>
                </div>
              </div>

              {/* Mobile Verification Form */}
              <form onSubmit={accountSubmit} className="space-y-4 pt-2">
                <div className="block">
                  <span className="text-xs font-semibold text-muted-foreground">Primary Mobile Number *</span>
                  <div className="flex gap-2 mt-1.5">
                    <input
                      type="tel"
                      value={account.phone}
                      onChange={(e) => setAccount({ ...account, phone: phoneDigits(e.target.value) })}
                      placeholder="e.g. 9876543210"
                      className={`${fieldClass} mt-0 flex-1`}
                      disabled={otpSent && otpCountdown > 0}
                    />
                    <button
                      type="button"
                      disabled={otpSending || (otpCountdown > 0) || !account.phone}
                      onClick={handleSendOtp}
                      className="px-4 py-2 text-xs font-bold bg-accent text-accent-foreground rounded-xl active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent/90 transition-all shadow-sm shrink-0 whitespace-nowrap"
                    >
                      {otpSending ? 'Sending...' : otpCountdown > 0 ? `Resend in ${otpCountdown}s` : otpSent ? 'Resend code' : 'Send Code'}
                    </button>
                  </div>
                </div>

                {otpSent && (
                  <div className="block max-w-sm">
                    <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-accent" />
                      Verification Code *
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={account.otp}
                      onChange={(e) => setAccount({ ...account, otp: phoneDigits(e.target.value) })}
                      placeholder="Enter 6-digit code"
                      className={`${fieldClass} tracking-widest text-center font-bold text-lg mt-1.5`}
                      autoFocus
                    />
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      We sent a verification code to your mobile number.
                    </p>
                  </div>
                )}

                {/* Email Collection */}
                <div className="block">
                  <span className="text-xs font-semibold text-muted-foreground">Gmail ID <span className="text-destructive">*</span></span>
                  <input
                    type="email"
                    value={account.email}
                    onChange={(e) => setAccount({ ...account, email: e.target.value.trim() })}
                    placeholder="e.g. yourname@gmail.com"
                    className={`${fieldClass} mt-1.5`}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Used for account notifications and hostel communications.
                  </p>
                </div>

                <PrimaryButton loading={submitting} disabled={!otpSent || account.otp.length < 6}>
                  Verify & Continue
                </PrimaryButton>
              </form>
            </div>
          )}

          {activeStep === 'ACCOUNT' && ctx.activation_state?.account_setup_completed && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold text-accent uppercase tracking-wider">Step 1 of {visualSteps.length}</p>
                <h2 className="mt-1 text-2xl font-black text-foreground tracking-tight">Welcome</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Your mobile number has been successfully verified. Let's move to the next step.
                </p>
              </div>

              <div className="flex items-center justify-between p-4 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
                <div className="flex items-center gap-2.5 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                  <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>Mobile Verified</span>
                </div>
                <div className="text-sm font-semibold text-muted-foreground">
                  +91 {account.phone || ctx.profile?.phone || ctx.tenant?.phone_1}
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setVisibleStep(null)}
                  className="inline-flex items-center gap-2 rounded-2xl bg-accent px-5 py-3.5 text-sm font-semibold text-accent-foreground active:scale-[0.98] transition-all shadow-sm cursor-pointer hover:bg-accent/90"
                >
                  Continue Setup
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {activeStep === 'RULES' && (
            <div className="space-y-5 pb-24">
              <SectionHeading icon={<ClipboardCheck className="w-5 h-5" />} title={ctx.rules.title || 'Hostel rules'} text="6 rule sections · Estimated reading time: 2 minutes. Expand only the sections you want to inspect in detail." />
              <div className="grid gap-3">
                {ruleCategories.map((category) => (
                  <details
                    key={category.id}
                    className={`rounded-xl border p-4 bg-background transition-all duration-300 ${
                      category.id === 'facilities'
                        ? 'border-emerald-500/60 bg-emerald-50/5 dark:bg-emerald-950/5 shadow-md shadow-emerald-500/5 ring-1 ring-emerald-500/10'
                        : 'border-border bg-background'
                    }`}
                  >
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 font-semibold text-foreground">
                          <span
                            className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                              category.id === 'facilities'
                                ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                                : 'bg-accent/10 text-accent'
                            }`}
                          >
                            <RuleIcon icon={category.icon} />
                          </span>
                          {category.title}
                        </div>
                        {category.id === 'facilities' ? (
                          <span className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider bg-emerald-500 text-white shadow-sm shadow-emerald-500/20">
                            Included Facilities
                          </span>
                        ) : (
                          <span
                            className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                              category.severity === 'critical'
                                ? 'bg-destructive/10 text-destructive'
                                : category.severity === 'important'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {category.severity || 'standard'}
                          </span>
                        )}
                      </div>
                    </summary>
                    <div className="mt-3 space-y-2">
                      {(category.highlights || []).map((item) => (
                        <p
                          key={item}
                          className={`rounded-lg px-3 py-2 text-sm font-semibold leading-relaxed ${
                            category.id === 'facilities'
                              ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-800 dark:text-emerald-300'
                              : 'bg-muted/50 text-foreground'
                          }`}
                        >
                          {item}
                        </p>
                      ))}
                      {(category.rules || []).map((item) => (
                        <p key={item} className="text-sm text-muted-foreground">
                          {item}
                        </p>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
              <div className="space-y-2 rounded-xl border border-border bg-background p-4">
                {[
                  ['fee_refund_rules', 'I understand hostel fee and refund rules'],
                  ['discipline_policies', 'I understand discipline policies'],
                  ['late_fee_obligations', 'I understand late fee and payment obligations'],
                  ['damage_liabilities', 'I understand hostel property damage liabilities'],
                  ['hostel_rules', 'I agree to comply with hostel rules'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={acks[key] === true} onChange={(e) => setAcks({ ...acks, [key]: e.target.checked })} className="mt-1 h-4 w-4 accent-accent" />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div className="sticky bottom-3 z-20 rounded-2xl border border-border bg-card/95 p-3 shadow-xl backdrop-blur flex gap-2">
                <button
                  type="button"
                  onClick={() => goToStep('ACCOUNT')}
                  className="rounded-2xl border border-border bg-background px-4 text-muted-foreground hover:bg-secondary/40 active:scale-[0.98] transition-transform shadow-sm flex items-center justify-center cursor-pointer"
                  title="Back to Account"
                >
                  <ArrowRight className="w-4 h-4 rotate-180" />
                </button>
                {completed.has('RULES') ? (
                  <button
                    type="button"
                    onClick={() => goToStep('AGREEMENT')}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3.5 text-sm font-semibold text-accent-foreground active:scale-[0.98] transition-transform shadow-sm cursor-pointer"
                  >
                    Proceed to Agreement
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!allAcksChecked || submitting}
                    onClick={() => submitStep('RULES', { acknowledgements: acks, typed_signature_name: ctx.profile.name })}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3.5 text-sm font-semibold text-accent-foreground disabled:opacity-50 active:scale-[0.98] transition-transform shadow-sm"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Accept rules
                  </button>
                )}
              </div>
            </div>
          )}

          {activeStep === 'AGREEMENT' && ctx?.agreement && (
            <form onSubmit={agreementSubmit} className="space-y-5 pb-24">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <SectionHeading
                  icon={<FileText className="w-5 h-5" />}
                  title="Review & Sign Agreement"
                  text="Please review the terms of your hostel stay and sign electronically below to proceed."
                />
              </div>

              {/* Immutable Lease Snapshot Box */}
              <div className="rounded-2xl border border-border bg-background p-6 md:p-8 shadow-sm space-y-5 text-sm leading-relaxed text-foreground select-none">
                <div className="text-center border-b pb-4 mb-4">
                  <h3 className="font-extrabold text-base tracking-tight text-slate-800">
                    HOSTEL RESIDENCY AGREEMENT
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Hostel: {ctx.agreement.content_snapshot.hostel_name}
                  </p>
                </div>

                <p>
                  This agreement is made and entered into by and between the Hostel Management of <strong>{ctx.agreement.content_snapshot.hostel_name}</strong> (represented by <strong>{ctx.agreement.content_snapshot.owner_name}</strong>) and the Tenant <strong>{ctx.agreement.content_snapshot.tenant_name}</strong>.
                </p>

                <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 mt-3 mb-1">
                  1. Room & Financial Summary
                </h4>
                <div className="bg-muted/40 rounded-lg p-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs border border-border/50">
                  <div>
                    <span className="text-muted-foreground">Assigned Room:</span>{" "}
                    <strong className="text-foreground">{ctx.agreement.content_snapshot.room_number}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Joining Date:</span>{" "}
                    <strong className="text-foreground">{ctx.agreement.content_snapshot.joining_date}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Monthly Rent:</span>{" "}
                    <strong className="text-foreground">₹{ctx.agreement.content_snapshot.monthly_rent}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Security Deposit:</span>{" "}
                    <strong className="text-foreground">₹{ctx.agreement.content_snapshot.advance_deposit}</strong>
                  </div>
                  {ctx.agreement.content_snapshot.maintenance_charge > 0 && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Maintenance Charge:</span>{" "}
                      <strong className="text-foreground">
                        ₹{ctx.agreement.content_snapshot.maintenance_charge} ({ctx.agreement.content_snapshot.maintenance_type})
                      </strong>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Payment Cycle:</span>{" "}
                    <strong className="text-foreground">{ctx.agreement.content_snapshot.payment_frequency}</strong>
                  </div>
                </div>

                <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 mt-4 mb-1">
                  2. Terms of Residency & Rules Compliance
                </h4>
                <ul className="list-disc pl-5 space-y-2 text-xs text-muted-foreground">
                  <li>The Tenant shall use the allocated room solely for residential purposes. Sub-letting or transferring the room to any other person is strictly prohibited.</li>
                  <li>The Tenant agrees to pay the monthly rent of ₹{ctx.agreement.content_snapshot.monthly_rent} on or before the due date as defined by the hostel policy. Late payments may attract fees or lead to suspension of access.</li>
                  <li>A refundable security deposit of ₹{ctx.agreement.content_snapshot.advance_deposit} is deposited with the management, which will be settled/refunded upon successful move-out compliance checks, subject to clearance of all pending dues and room inspection for damages.</li>
                  <li>Either party must provide at least 30 days written notice prior to terminating this residency agreement.</li>
                  <li className="text-foreground font-medium bg-secondary/20 p-2 rounded border border-border/50">
                    <strong>Hostel Rules Binding Clause:</strong> The Tenant explicitly agrees to follow, comply with, and be legally bound by each and every rule, policy, and regulation of the hostel (as reviewed and accepted under the Rules section). This includes all guidelines concerning fee refunds, hostel discipline, guest policies, late fee obligations, and property damage liabilities. Any breach of these rules constitutes a violation of this residency agreement and may result in immediate termination of stay.
                  </li>
                </ul>

                {ruleCategories.length > 0 && (
                  <>
                    <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 mt-4 mb-1">
                      3. Hostel Rules & Regulations
                    </h4>
                    <div className="space-y-4 pl-2 text-xs text-muted-foreground border-l-2 border-slate-100 ml-1">
                      {ruleCategories.map((category: any) => (
                        <div key={category.id} className="space-y-1">
                          <h5 className="font-bold text-slate-800">{category.title}</h5>
                          <ul className="list-disc pl-5 space-y-1">
                            {(category.highlights || []).map((hl: string, idx: number) => (
                              <li key={`hl-${idx}`} className="italic text-foreground font-medium">
                                {hl}
                              </li>
                            ))}
                            {(category.rules || []).map((rule: string, idx: number) => (
                              <li key={`rule-${idx}`}>
                                {rule}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {ctx.agreement.content_snapshot.custom_rules && (
                  <>
                    <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 mt-4 mb-1">
                      4. Additional Custom Rules
                    </h4>
                    <p className="text-xs whitespace-pre-line text-muted-foreground bg-amber-50/20 border border-amber-500/10 rounded-lg p-3 italic">
                      {ctx.agreement.content_snapshot.custom_rules}
                    </p>
                  </>
                )}

                <p className="text-[10px] text-muted-foreground mt-4 pt-4 border-t border-dashed">
                  This electronic document is valid under the Information Technology Act. Digital signatures and IP details collected during onboarding are legally binding.
                </p>
              </div>

              {/* Signature Section - Side-by-Side Action Buttons */}
              <p className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-xs font-semibold text-emerald-700">
                At least one signature is required. Tenant, parent/guardian, or both can sign to continue.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
                {/* Tenant Signature Button */}
                <button
                  type="button"
                  onClick={() => setActiveSigType('tenant')}
                  className={`flex flex-col items-center justify-center p-5 rounded-2xl border text-center transition-all hover:shadow-md cursor-pointer active:scale-[0.98] ${
                    !isStudent ? 'sm:col-span-2' : ''
                  } ${
                    tenantSigBlob || ctx.agreement?.tenant_signature_url
                      ? 'border-emerald-500 bg-emerald-500/5 hover:bg-emerald-500/10'
                      : 'border-dashed border-border bg-card hover:bg-secondary/40'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-accent text-xs font-bold">1</span>
                    <span className="text-sm font-bold text-foreground">Sign as Tenant</span>
                  </div>
                  {tenantSigBlob || ctx.agreement?.tenant_signature_url ? (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold mt-1">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Tenant Signed: {tenantSigName || ctx.agreement?.tenant_signature_name}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground mt-1">Click to sign and enter name</span>
                  )}
                </button>

                {/* Guardian Signature Button */}
                {isStudent ? (
                  <button
                    type="button"
                    onClick={() => setActiveSigType('guardian')}
                    className={`flex flex-col items-center justify-center p-5 rounded-2xl border text-center transition-all hover:shadow-md cursor-pointer active:scale-[0.98] ${
                      guardianSigBlob || ctx.agreement?.guardian_signature_url
                        ? 'border-emerald-500 bg-emerald-500/5 hover:bg-emerald-500/10'
                        : 'border-dashed border-border bg-card hover:bg-secondary/40'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-accent text-xs font-bold">2</span>
                      <span className="text-sm font-bold text-foreground">Sign as Parent/Guardian</span>
                    </div>
                    {guardianSigBlob || ctx.agreement?.guardian_signature_url ? (
                      <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold mt-1">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>Guardian Signed: {profile.guardian_name || ctx.agreement?.guardian_signature_name}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground mt-1">Optional if tenant has signed</span>
                    )}
                  </button>
                ) : null}
              </div>

              {/* Fullscreen Modal Portal for Signatures */}
              {activeSigType && typeof document !== "undefined" && createPortal(
                <div className="fixed inset-0 z-[100] bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-0 sm:p-4">
                  {activeSigType === 'tenant' && (
                    <TenantSignatureModal
                      tenantSigName={tenantSigName}
                      tenantSigBlob={tenantSigBlob}
                      existingTenantSigUrl={ctx.agreement?.tenant_signature_url}
                      onConfirm={(name, blob) => {
                        setTenantSigName(name);
                        setTenantSigBlob(blob);
                        setActiveSigType(null);
                      }}
                      onClose={() => setActiveSigType(null)}
                    />
                  )}
                  {activeSigType === 'guardian' && (
                    <GuardianSignatureModal
                      guardianName={profile.guardian_name || ''}
                      guardianRelation={profile.guardian_relation || ''}
                      guardianSigBlob={guardianSigBlob}
                      existingGuardianSigUrl={ctx.agreement?.guardian_signature_url}
                      onConfirm={(name, relation, blob) => {
                        setProfile(prev => ({
                          ...prev,
                          guardian_name: name,
                          guardian_relation: relation,
                        }));
                        setGuardianSigBlob(blob);
                        setActiveSigType(null);
                      }}
                      onClose={() => setActiveSigType(null)}
                    />
                  )}
                </div>,
                document.body
              )}

              {/* Submit Button Bar */}
              <div className="sticky bottom-3 z-20 rounded-2xl border border-border bg-card/95 p-3 shadow-xl backdrop-blur flex gap-2">
                <button
                  type="button"
                  onClick={() => goToStep('ACCOUNT')}
                  className="rounded-2xl border border-border bg-background px-4 text-muted-foreground hover:bg-secondary/40 active:scale-[0.98] transition-transform shadow-sm flex items-center justify-center cursor-pointer"
                  title="Back to Welcome"
                >
                  <ArrowRight className="w-4 h-4 rotate-180" />
                </button>
                {completed.has('AGREEMENT') ? (
                  <button
                    type="button"
                    onClick={() => goToStep('PROFILE')}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3.5 text-sm font-semibold text-accent-foreground active:scale-[0.98] transition-transform shadow-sm cursor-pointer"
                  >
                    Proceed to Identity
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3.5 text-sm font-semibold text-accent-foreground disabled:opacity-50 active:scale-[0.98] transition-transform shadow-sm cursor-pointer"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Uploading & signing agreement...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        Submit & sign contract
                      </>
                    )}
                  </button>
                )}
              </div>
            </form>
          )}

          {activeStep === 'PROFILE' && (
            <>
            <form data-profile-form onSubmit={profileSubmit} className="space-y-5">
              <SectionHeading icon={<ShieldCheck className="w-5 h-5" />} title="Verify your identity" text="Just a few quick fields — we'll collect address and academic details after activation." />
              <div className="flex items-center gap-2 rounded-2xl border border-border bg-secondary/40 px-4 py-3 text-xs font-semibold text-muted-foreground">
                {profileDraftStatus === 'saving' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    Saving draft...
                  </>
                ) : profileDraftStatus === 'restored' ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Draft restored from this device
                  </>
                ) : profileDraftStatus === 'saved' ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Draft saved locally
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Saved steps are synced to your account
                  </>
                )}
              </div>

              <FormGroup title="Personal details">
              <div className="grid gap-4">
                <label className="block">
                  <span className="text-xs font-semibold text-muted-foreground">Profile type *</span>
                  <select value={profile.profile_type} onChange={(e) => setProfile({ ...profile, profile_type: e.target.value })} className={fieldClass}>
                    <option value="STUDENT">Student</option>
                    <option value="WORKING_PROFESSIONAL">Working professional</option>
                  </select>
                </label>
                <Field label="Date of birth" required type="date" value={profile.date_of_birth} onChange={(v) => setProfile({ ...profile, date_of_birth: v })} />
                <label className="block">
                  <span className="text-xs font-semibold text-muted-foreground">Gender *</span>
                  <select value={profile.gender} onChange={(e) => setProfile({ ...profile, gender: e.target.value })} className={fieldClass}>
                    <option value="">Select gender</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </select>
                </label>
              </div>
              </FormGroup>
              
              <FormGroup title="Guardian details">
                <div className="rounded-2xl border border-border bg-secondary/10 p-4.5 space-y-4 shadow-sm">
                  {isGuardianLocked && profile.guardian_name && profile.guardian_relation ? (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card rounded-xl p-3 border border-border/60">
                      <div className="space-y-1">
                        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground font-sans">Guardian Details</span>
                        <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 font-sans">
                          {profile.guardian_name}
                          <span className="text-xs font-normal text-muted-foreground">({profile.guardian_relation})</span>
                        </h4>
                        <p className="text-[11px] text-muted-foreground font-sans">Synced and locked from agreement signing.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsGuardianLocked(false)}
                        className="shrink-0 text-xs font-semibold text-accent hover:underline flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border bg-background hover:bg-secondary/40 transition cursor-pointer font-sans"
                      >
                        Modify details
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3.5">
                      {!isGuardianLocked && profile.guardian_name && profile.guardian_relation && (
                        <div className="flex items-center justify-between rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                          <span className="flex items-center gap-1.5 font-medium font-sans">
                            <Unlock className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                            Editing details updates all stages.
                          </span>
                          <button
                            type="button"
                            onClick={() => setIsGuardianLocked(true)}
                            className="font-bold underline hover:text-amber-900 transition-colors font-sans"
                          >
                            Lock
                          </button>
                        </div>
                      )}
                      
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field
                          label="Guardian name"
                          value={profile.guardian_name || ''}
                          onChange={(v) => setProfile({ ...profile, guardian_name: v })}
                        />
                        <label className="block">
                          <span className="text-xs font-semibold text-muted-foreground font-sans">Guardian relation</span>
                          <select
                            value={profile.guardian_relation || ''}
                            onChange={(e) => setProfile({ ...profile, guardian_relation: e.target.value })}
                            className={fieldClass}
                          >
                            <option value="">Select relation</option>
                            {guardianRelations.map((relation) => (
                              <option key={relation} value={relation}>{relation}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  )}

                  <div className="border-t border-border/60 pt-3.5 space-y-3">
                    <div className="block font-sans">
                      <span className="text-xs font-semibold text-muted-foreground flex items-center justify-between font-sans">
                        <span>Guardian phone {isStudent && <span className="text-destructive">*</span>}</span>
                        {isGuardianPhoneVerified && (
                          <span className="flex items-center gap-2 font-sans">
                            <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded font-sans">
                              <CheckCircle2 className="w-3 h-3" /> Verified
                            </span>
                            <button
                              type="button"
                              onClick={() => setGuardianOverrideUnlocked(true)}
                              className="text-[11px] text-accent hover:underline font-semibold font-sans cursor-pointer"
                            >
                              Edit
                            </button>
                          </span>
                        )}
                      </span>
                      <div className="flex gap-2 mt-1.5">
                        <input
                          type="tel"
                          disabled={isGuardianPhoneVerified}
                          value={profile.guardian_phone || ''}
                          onChange={(e) => setProfile({ ...profile, guardian_phone: phoneDigits(e.target.value) })}
                          placeholder="e.g. 98765 43210"
                          className={`${fieldClass} mt-0 flex-1`}
                        />
                      </div>
                      {!isGuardianPhoneVerified && profile.guardian_phone && profile.guardian_phone.length === 10 && (
                        <button
                          type="button"
                          disabled={guardianOtpSending || (guardianOtpCountdown > 0)}
                          onClick={handleSendGuardianOtp}
                          className="w-full mt-2 px-4 py-3 text-sm font-bold bg-accent text-accent-foreground rounded-xl active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent/90 transition-all shadow-sm font-sans"
                        >
                          {guardianOtpSending ? 'Sending...' : guardianOtpCountdown > 0 ? `Resend in ${guardianOtpCountdown}s` : guardianOtpSent ? 'Resend code' : 'Send Verification Code'}
                        </button>
                      )}
                      <p className="text-[11px] text-muted-foreground mt-1 font-sans">
                        {isStudent ? 'Mandatory mobile number for parent/guardian.' : 'Use a valid 10-digit mobile number if provided.'}
                      </p>
                    </div>

                    {!isGuardianPhoneVerified && guardianOtpSent && (
                      <div className="block mt-3 font-sans bg-card border border-border/80 rounded-xl p-3.5 shadow-inner">
                        <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 font-sans">
                          <Lock className="w-3.5 h-3.5 text-accent font-sans" />
                          Guardian Verification Code *
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={guardianOtp}
                          onChange={(e) => setGuardianOtp(phoneDigits(e.target.value))}
                          placeholder="Enter 6-digit code"
                          className={`${fieldClass} mt-1.5 tracking-widest text-center font-bold text-lg`}
                        />
                        <button
                          type="button"
                          disabled={guardianOtpVerifying || guardianOtp.length < 6}
                          onClick={handleVerifyGuardianOtp}
                          className="w-full mt-2 px-4 py-3 text-sm font-bold bg-emerald-600 text-white rounded-xl active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-700 transition-all shadow-sm"
                        >
                          {guardianOtpVerifying ? 'Verifying...' : 'Verify Code'}
                        </button>
                        <p className="mt-1.5 text-[11px] text-muted-foreground font-sans">
                          We sent a verification code to the guardian's mobile number.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </FormGroup>

              <FormGroup title="Emergency contact details">
                <div className="rounded-2xl border border-border bg-secondary/10 p-4.5 shadow-sm space-y-3 font-sans">
                  <div className="block font-sans">
                    <span className="text-xs font-semibold text-muted-foreground font-sans">
                      <span>Emergency contact (Mobile) <span className="text-destructive">*</span></span>
                    </span>
                    <input
                      type="tel"
                      value={profile.emergency_phone || ''}
                      onChange={(e) => setProfile({ ...profile, emergency_phone: phoneDigits(e.target.value) })}
                      placeholder="e.g. +91 98765 43210"
                      className={`${fieldClass} mt-1.5`}
                    />
                    <p className="text-[11px] text-muted-foreground mt-1 font-sans">
                      Must be valid and different from primary and guardian numbers.
                    </p>
                  </div>
                </div>
              </FormGroup>

              <FormGroup title="Photo verification">
              <label className="flex items-center gap-3 rounded-xl border border-border bg-secondary/30 p-3 cursor-pointer hover:bg-secondary/50 transition-colors">
                <div className={`w-11 h-11 rounded-full overflow-hidden bg-secondary flex items-center justify-center shrink-0 ${
                  profilePhotoPreview ? 'ring-2 ring-accent ring-offset-1' : 'ring-1 ring-border'
                }`}>
                  {profilePhotoPreview ? (
                    <img
                      src={profilePhotoPreview}
                      alt="Profile preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Camera className="w-4 h-4 text-accent" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {photoUploading ? (
                    <p className="text-xs font-medium text-accent">Uploading...</p>
                  ) : profilePhotoFile ? (
                    <p className="text-xs text-accent font-medium truncate">{profilePhotoFile.name}</p>
                  ) : !profilePhotoFile && /^https?:\/\//.test(profilePhotoPreview) ? (
                    <p className="text-xs text-emerald-700 font-medium">✓ Photo uploaded</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Upload photo *</p>
                  )}
                </div>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => handlePhotoChange(e.target.files?.[0])}
                />
                <span className="text-xs font-semibold text-accent shrink-0">{profilePhotoPreview ? 'Change' : 'Choose'}</span>
              </label>
              </FormGroup>

              <div className="rounded-xl border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-800 flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-blue-500" />
                <p>Address, academic, and work details can be completed later from your tenant portal.</p>
              </div>

              <div className="hidden sm:flex gap-2">
                <button
                  type="button"
                  onClick={() => goToStep('AGREEMENT')}
                  className="rounded-2xl border border-border bg-background px-4 text-muted-foreground hover:bg-secondary/40 active:scale-[0.98] transition-transform shadow-sm flex items-center justify-center cursor-pointer"
                  title="Back to Agreement"
                >
                  <ArrowRight className="w-4 h-4 rotate-180" />
                </button>
                {completed.has('PROFILE') ? (
                  <button
                    type="button"
                    onClick={() => goToStep('ACTIVATE')}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3.5 text-sm font-semibold text-accent-foreground active:scale-[0.98] transition-transform shadow-sm cursor-pointer"
                  >
                    Proceed to Activation
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <PrimaryButton loading={submitting || photoUploading}>
                    {photoUploading ? 'Uploading photo...' : 'Verify identity'}
                  </PrimaryButton>
                )}
              </div>
            </form>
            <div className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-md border-t border-border px-5 py-3 sm:hidden flex gap-2" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
              <button
                type="button"
                onClick={() => goToStep('AGREEMENT')}
                className="rounded-2xl border border-border bg-background px-4 text-muted-foreground hover:bg-secondary/40 active:scale-[0.98] transition-transform shadow-sm flex items-center justify-center cursor-pointer"
                title="Back to Agreement"
              >
                <ArrowRight className="w-4 h-4 rotate-180" />
              </button>
              {completed.has('PROFILE') ? (
                <button
                  type="button"
                  onClick={() => goToStep('ACTIVATE')}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3.5 text-sm font-semibold text-accent-foreground active:scale-[0.98] transition-transform shadow-sm cursor-pointer"
                >
                  Proceed to Activation
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={submitting || photoUploading}
                  onClick={() => {
                    const form = document.querySelector('form[data-profile-form]') as HTMLFormElement | null;
                    if (form) form.requestSubmit();
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3.5 text-sm font-semibold text-accent-foreground disabled:opacity-50 active:scale-[0.98] transition-transform shadow-sm"
                >
                  {(submitting || photoUploading) ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  {photoUploading ? 'Uploading photo...' : 'Verify identity'}
                </button>
              )}
            </div>
          </>
          )}

          {activeStep === 'ACTIVATE' && (
            <div className="space-y-6">
              <SectionHeading icon={<CheckCircle2 className="w-5 h-5 text-emerald-500" />} title="Activate Your Account" text="Secure your account and complete activation to log in to the tenant portal." />

              {/* 4-Point Verification Checklist */}
              <div className="rounded-2xl border border-border bg-secondary/15 p-4.5 space-y-3 shadow-sm">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Onboarding Verification Checklist</h3>
                <div className="space-y-2.5">
                  <div className="flex items-start gap-2.5 text-sm">
                    <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-500" />
                    <div>
                      <span className="font-semibold text-foreground block">1. Stay & Allocation Confirmed</span>
                      <span className="text-xs text-muted-foreground">Room {ctx.room_summary.room_number || 'Assigned'} • {currency(ctx.room_summary.monthly_rent)}/month</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 text-sm">
                    <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-500" />
                    <div>
                      <span className="font-semibold text-foreground block">2. Primary Mobile Verified</span>
                      <span className="text-xs text-muted-foreground">+91 {account.phone || ctx.profile?.phone || ctx.tenant?.phone_1}</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 text-sm">
                    <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-500" />
                    <div>
                      <span className="font-semibold text-foreground block">3. Hostel Agreement Signed</span>
                      <span className="text-xs text-muted-foreground">Signed as "{ctx.agreement?.tenant_signature_name || ctx.profile?.name}"</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 text-sm">
                    <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-500" />
                    <div>
                      <span className="font-semibold text-foreground block">4. Identity Profile Verified</span>
                      <span className="text-xs text-muted-foreground">Gender, Date of Birth & Guardian details confirmed</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Signed Agreement Preview & Download Card */}
              {ctx?.agreement && (
                <div className="rounded-2xl border border-border bg-card p-5 space-y-4 shadow-sm">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent shrink-0">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-foreground">Signed Rental Agreement</h4>
                        <p className="text-xs text-muted-foreground">
                          {ctx.agreement.tenant_signature_name ? `Signed by ${ctx.agreement.tenant_signature_name}` : 'Digitally Signed'}
                          {ctx.agreement.tenant_signed_at && ` on ${new Date(ctx.agreement.tenant_signed_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAgreementPreview(true)}
                        className="px-3.5 py-2 rounded-xl border border-border bg-background hover:bg-secondary text-xs font-semibold text-foreground transition-colors flex items-center gap-1.5 cursor-pointer active:scale-95"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        View
                      </button>
                      {ctx.agreement.pdf_url ? (
                        <a
                          href={ctx.agreement.pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3.5 py-2 rounded-xl bg-accent hover:bg-accent/95 text-xs font-semibold text-accent-foreground transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm shadow-accent/15"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download PDF
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Generating PDF...</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Secure Password Creation */}
              <div className="rounded-2xl border border-border bg-card p-5 space-y-4 shadow-sm">
                <div>
                  <h3 className="text-sm font-bold text-foreground">Set Account Password</h3>
                  <p className="text-xs text-muted-foreground">Choose a strong password to access your dashboard in the future.</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-semibold text-muted-foreground">New Password *</span>
                    <div className="relative mt-1.5">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={account.password}
                        onChange={(e) => setAccount({ ...account, password: e.target.value })}
                        className={`${fieldClass} mt-0 pr-11`}
                        placeholder="Min 8 characters"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((value) => !value)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full ${strength.color} transition-all`} style={{ width: strength.width }} />
                    </div>
                    <p className={`mt-1 text-[10px] font-bold ${strength.textColor}`}>Password strength: {strength.label}</p>
                  </label>

                  <label className="block">
                    <span className="text-xs font-semibold text-muted-foreground">Confirm Password *</span>
                    <div className="relative mt-1.5">
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        value={account.confirm_password}
                        onChange={(e) => setAccount({ ...account, confirm_password: e.target.value })}
                        className={`${fieldClass} mt-0 pr-11`}
                        placeholder="Re-enter password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((value) => !value)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                        aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                      >
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </label>
                </div>
              </div>

              {/* Billing Cycle */}
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-xl bg-accent/10 flex items-center justify-center text-accent shrink-0">
                    <Receipt className="w-4 h-4" />
                  </div>
                  <label className="text-xs font-semibold text-muted-foreground">Select Billing Cycle</label>
                </div>
                <select
                  value={paymentFrequency}
                  onChange={(e) => setPaymentFrequency(e.target.value)}
                  className="w-full mt-2 px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="MONTHLY">Monthly (Pay rent every month)</option>
                  <option value="QUARTERLY">Quarterly (Pay rent every 3 months)</option>
                  <option value="HALF_YEARLY">Half Yearly (Pay rent every 6 months)</option>
                  <option value="ACADEMIC_YEARLY">Academic Yearly (Pay rent every 12 months)</option>
                </select>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  Confirm your preferred billing frequency. Changing it later will require submitting a change request to the hostel owner.
                </p>
              </div>

              {submitting && (
                <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4">
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-accent" />
                    <p className="text-sm font-bold text-foreground">{activationMessages[activationStageIndex]}</p>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
                      style={{ width: activationProgressWidth }}
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => goToStep('PROFILE')}
                  className="rounded-2xl border border-border bg-background px-4 text-muted-foreground hover:bg-secondary/40 active:scale-[0.98] transition-transform shadow-sm flex items-center justify-center cursor-pointer"
                  title="Back to Identity"
                >
                  <ArrowRight className="w-4 h-4 rotate-180" />
                </button>
                <button
                  type="button"
                  onClick={() => submitStep('ACTIVATE', {
                    password: account.password,
                    confirm_password: account.confirm_password,
                    payment_frequency: paymentFrequency
                  })}
                  disabled={submitting || account.password.length < 8 || account.password !== account.confirm_password}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:scale-[0.98] transition-transform shadow-sm cursor-pointer"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Activate Account
                </button>
              </div>
            </div>
          )}
        </section>
      </main>

      {showAgreementPreview && ctx?.agreement && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <AgreementPreviewModal
            agreement={ctx.agreement}
            onClose={() => setShowAgreementPreview(false)}
          />
        </div>,
        document.body
      )}

      {showSuccessModal && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in font-sans">
          <style>{`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes slideUp {
              from { transform: translateY(100%); }
              to { transform: translateY(0); }
            }
            @keyframes scaleUp {
              from { transform: scale(0.95); opacity: 0; }
              to { transform: scale(1); opacity: 1; }
            }
            .animate-fade-in {
              animation: fadeIn 0.2s ease-out forwards;
            }
            .animate-slide-up {
              animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }
            @media (min-width: 640px) {
              .animate-slide-up {
                animation: scaleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
              }
            }
          `}</style>
          <div className="w-full max-w-sm bg-white rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl border border-slate-100 transform transition-all duration-300 translate-y-0 sm:scale-100 flex flex-col items-center text-center animate-slide-up">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border-2 border-emerald-500/20 text-emerald-600 flex items-center justify-center mb-4 shadow-sm animate-bounce">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 font-sans mb-2">
              {showSuccessModal.title}
            </h3>
            <p className="text-sm text-slate-500 leading-relaxed font-sans mb-6">
              {showSuccessModal.message}
            </p>
            <button
              type="button"
              onClick={() => setShowSuccessModal(null)}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl active:scale-[0.98] transition-all shadow-md shadow-emerald-600/20 font-sans text-sm cursor-pointer"
            >
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionHeading({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/10 text-accent shrink-0">{icon}</div>
      <div>
        <h2
          className="text-lg font-bold text-foreground"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {title}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

function FormGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-background p-4">
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-xl bg-accent/10 flex items-center justify-center text-accent shrink-0">
          {icon}
        </div>
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      </div>
      <p className="text-sm font-bold text-foreground">{value}</p>
    </div>
  );
}

function PrimaryButton({ loading, children }: { loading: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-2xl bg-accent px-5 py-3.5 text-sm font-semibold text-accent-foreground disabled:opacity-50 active:scale-[0.98] transition-transform shadow-sm"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
      {children}
    </button>
  );
}

interface AgreementPreviewModalProps {
  agreement: any;
  onClose: () => void;
}

function AgreementPreviewModal({ agreement, onClose }: AgreementPreviewModalProps) {
  const ruleCategories = agreement?.content_snapshot?.hostel_rules?.categories || [];

  return (
    <div className="w-full h-full sm:h-[85vh] sm:max-w-4xl bg-card rounded-none sm:rounded-3xl border-0 sm:border border-border/80 shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
      {/* Header */}
      <div className="px-4 sm:px-6 py-4 border-b border-border bg-muted/30 flex justify-between items-center">
        <div>
          <h3 className="font-extrabold text-foreground text-lg tracking-tight">Rental Agreement Preview</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Hostel: {agreement.content_snapshot.hostel_name}</p>
        </div>
        <div className="flex items-center gap-2.5">
          {agreement.pdf_url && (
            <a
              href={agreement.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-accent-foreground transition-all active:scale-[0.98] shadow-sm shadow-accent/20 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Download PDF
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 sm:p-6 space-y-6 flex-1 overflow-y-auto select-none bg-secondary/5">
        <div className="rounded-2xl border border-border bg-background p-6 md:p-8 space-y-5 text-sm leading-relaxed text-foreground shadow-sm">
          <div className="text-center border-b pb-4 mb-4">
            <h3 className="font-extrabold text-base tracking-tight text-slate-800 uppercase">
              HOSTEL RESIDENCY AGREEMENT
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Hostel: {agreement.content_snapshot.hostel_name}
            </p>
          </div>

          <p>
            This agreement is made and entered into by and between the Hostel Management of <strong>{agreement.content_snapshot.hostel_name}</strong> (represented by <strong>{agreement.content_snapshot.owner_name}</strong>) and the Tenant <strong>{agreement.content_snapshot.tenant_name}</strong>.
          </p>

          <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 mt-3 mb-1">
            1. Room & Financial Summary
          </h4>
          <div className="bg-muted/40 rounded-lg p-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs border border-border/50">
            <div>
              <span className="text-muted-foreground">Assigned Room:</span>{" "}
              <strong className="text-foreground">{agreement.content_snapshot.room_number}</strong>
            </div>
            <div>
              <span className="text-muted-foreground">Joining Date:</span>{" "}
              <strong className="text-foreground">{agreement.content_snapshot.joining_date}</strong>
            </div>
            <div>
              <span className="text-muted-foreground">Monthly Rent:</span>{" "}
              <strong className="text-foreground">{currency(agreement.content_snapshot.monthly_rent)}</strong>
            </div>
            <div>
              <span className="text-muted-foreground">Security Deposit:</span>{" "}
              <strong className="text-foreground">{currency(agreement.content_snapshot.advance_deposit)}</strong>
            </div>
            {agreement.content_snapshot.maintenance_charge > 0 && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Maintenance Charge:</span>{" "}
                <strong className="text-foreground">
                  {currency(agreement.content_snapshot.maintenance_charge)} ({agreement.content_snapshot.maintenance_type})
                </strong>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Payment Cycle:</span>{" "}
              <strong className="text-foreground">{agreement.content_snapshot.payment_frequency}</strong>
            </div>
          </div>

          <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 mt-4 mb-1">
            2. Terms of Residency & Rules Compliance
          </h4>
          <ul className="list-disc pl-5 space-y-2 text-xs text-muted-foreground">
            <li>The Tenant shall use the allocated room solely for residential purposes. Sub-letting or transferring the room to any other person is strictly prohibited.</li>
            <li>The Tenant agrees to pay the monthly rent of {currency(agreement.content_snapshot.monthly_rent)} on or before the due date as defined by the hostel policy. Late payments may attract fees or lead to suspension of access.</li>
            <li>A refundable security deposit of {currency(agreement.content_snapshot.advance_deposit)} is deposited with the management, which will be settled/refunded upon successful move-out compliance checks, subject to clearance of all pending dues and room inspection for damages.</li>
            <li>Either party must provide at least 30 days written notice prior to terminating this residency agreement.</li>
            <li className="text-foreground font-medium bg-secondary/20 p-2.5 rounded border border-border/50 list-none mt-1">
              <strong>Hostel Rules Binding Clause:</strong> The Tenant explicitly agrees to follow, comply with, and be legally bound by each and every rule, policy, and regulation of the hostel. This includes all guidelines concerning fee refunds, hostel discipline, guest policies, late fee obligations, and property damage liabilities. Any breach of these rules constitutes a violation of this residency agreement and may result in immediate termination of stay.
            </li>
          </ul>

          {ruleCategories.length > 0 && (
            <>
              <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 mt-4 mb-1">
                3. Hostel Rules & Regulations
              </h4>
              <div className="space-y-4 pl-2 text-xs text-muted-foreground border-l-2 border-slate-100 ml-1">
                {ruleCategories.map((category: any) => (
                  <div key={category.id} className="space-y-1.5">
                    <h5 className="font-bold text-slate-800">{category.title}</h5>
                    <ul className="list-disc pl-5 space-y-1">
                      {(category.highlights || []).map((hl: string, idx: number) => (
                        <li key={`hl-${idx}`} className="italic text-foreground font-medium">
                          {hl}
                        </li>
                      ))}
                      {(category.rules || []).map((rule: string, idx: number) => (
                        <li key={`rule-${idx}`}>
                          {rule}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}

          {agreement.content_snapshot.custom_rules && (
            <>
              <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 mt-4 mb-1">
                4. Additional Custom Rules
              </h4>
              <p className="text-xs whitespace-pre-line text-muted-foreground bg-amber-50/20 border border-amber-500/10 rounded-lg p-3 italic">
                {agreement.content_snapshot.custom_rules}
              </p>
            </>
          )}

          {/* Signatures preview inside the preview modal */}
          {(agreement.tenant_signature_name || agreement.guardian_signature_name) && (
            <div className="border-t border-dashed pt-4 mt-4 space-y-3">
              <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 mb-1">
                Digital Signatures & Verification Details
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                {agreement.tenant_signature_name && (
                  <div className="p-3 rounded-xl border bg-muted/20 space-y-1">
                    <span className="font-bold block text-foreground">Lessee (Tenant) Signature</span>
                    <span className="text-muted-foreground block">Name: {agreement.tenant_signature_name}</span>
                    {agreement.tenant_signed_at && (
                      <span className="block text-[10px] text-muted-foreground/80">
                        Date: {new Date(agreement.tenant_signed_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                )}
                {agreement.guardian_signature_name && (
                  <div className="p-3 rounded-xl border bg-muted/20 space-y-1">
                    <span className="font-bold block text-foreground">Parent/Guardian Signature</span>
                    <span className="text-muted-foreground block">Name: {agreement.guardian_signature_name} ({agreement.guardian_relation || 'Parent'})</span>
                    {agreement.guardian_signed_at && (
                      <span className="block text-[10px] text-muted-foreground/80">
                        Date: {new Date(agreement.guardian_signed_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground mt-4 pt-4 border-t border-dashed">
            This electronic document is valid under the Information Technology Act. Digital signatures and IP details collected during onboarding are legally binding.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 sm:px-6 py-4 border-t border-border bg-muted/30 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-5 py-2.5 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-95 transition-all cursor-pointer"
        >
          Close Preview
        </button>
      </div>
    </div>
  );
}

interface TenantSignatureModalProps {
  tenantSigName: string;
  tenantSigBlob: Blob | null;
  existingTenantSigUrl?: string | null;
  onConfirm: (name: string, blob: Blob | null) => void;
  onClose: () => void;
}

function TenantSignatureModal({
  tenantSigName,
  tenantSigBlob,
  existingTenantSigUrl,
  onConfirm,
  onClose,
}: TenantSignatureModalProps) {
  const [name, setName] = useState(tenantSigName);
  const [blob, setBlob] = useState<Blob | null>(tenantSigBlob);

  const isValid = name.trim().length > 0 && (blob !== null || !!existingTenantSigUrl);

  return (
    <div className="w-full h-full sm:h-auto sm:max-w-lg bg-card rounded-none sm:rounded-3xl border-0 sm:border border-border/80 shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-border bg-muted/30 flex justify-between items-center">
        <div>
          <h3 className="font-extrabold text-foreground text-lg tracking-tight">Tenant Signature</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Please write your name and draw your signature below</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-xl hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Body */}
      <div className="p-4 sm:p-6 space-y-5 flex-1 overflow-y-auto flex flex-col">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
            Full Name (Type to sign) <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Type your official full name"
            className="w-full rounded-xl border border-border px-4 py-3 text-sm focus:border-accent focus:outline-none bg-background text-foreground"
          />
        </div>

        <div className="flex-1 flex flex-col min-h-[200px]">
          <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
            Draw Signature <span className="text-destructive">*</span>
          </label>
          <div className="rounded-xl overflow-hidden border border-border relative bg-background [&_button.absolute]:hidden flex-1 flex flex-col">
            <SignaturePad
              onSave={(b) => setBlob(b)}
              placeholder="Draw tenant signature here"
              existingSignatureUrl={existingTenantSigUrl}
              className="flex-1 flex flex-col space-y-2"
              canvasHeightClass="flex-1 min-h-[160px]"
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted/30 flex justify-between items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-95 transition-all cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!isValid}
          onClick={() => onConfirm(name, blob)}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50 active:scale-[0.98] transition-all cursor-pointer shadow-sm shadow-accent/20"
        >
          Apply Signature
        </button>
      </div>
    </div>
  );
}

interface GuardianSignatureModalProps {
  guardianName: string;
  guardianRelation: string;
  guardianSigBlob: Blob | null;
  existingGuardianSigUrl?: string | null;
  onConfirm: (name: string, relation: string, blob: Blob | null) => void;
  onClose: () => void;
}

function GuardianSignatureModal({
  guardianName,
  guardianRelation,
  guardianSigBlob,
  existingGuardianSigUrl,
  onConfirm,
  onClose,
}: GuardianSignatureModalProps) {
  const [name, setName] = useState(guardianName);
  const [relation, setRelation] = useState(guardianRelation);
  const [blob, setBlob] = useState<Blob | null>(guardianSigBlob);

  const isValid = name.trim().length > 0 && relation.length > 0 && (blob !== null || !!existingGuardianSigUrl);

  return (
    <div className="w-full h-full sm:h-auto sm:max-w-lg bg-card rounded-none sm:rounded-3xl border-0 sm:border border-border/80 shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-border bg-muted/30 flex justify-between items-center">
        <div>
          <h3 className="font-extrabold text-foreground text-lg tracking-tight">Parent/Guardian Co-Signature</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Please provide guardian details and signature below</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-xl hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Body */}
      <div className="p-4 sm:p-6 space-y-5 flex-1 overflow-y-auto flex flex-col">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
              Relationship <span className="text-destructive">*</span>
            </label>
            <select
              required
              value={relation}
              onChange={(e) => setRelation(e.target.value)}
              className="w-full rounded-xl border border-border px-3.5 py-3 text-sm focus:border-accent focus:outline-none bg-background text-foreground"
            >
              <option value="">Select</option>
              <option value="Father">Father</option>
              <option value="Mother">Mother</option>
              <option value="Guardian">Guardian</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
              Guardian Full Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Guardian name"
              className="w-full rounded-xl border border-border px-3.5 py-3 text-sm focus:border-accent focus:outline-none bg-background text-foreground"
            />
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-[200px]">
          <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
            Draw Signature <span className="text-destructive">*</span>
          </label>
          <div className="rounded-xl overflow-hidden border border-border relative bg-background [&_button.absolute]:hidden flex-1 flex flex-col">
            <SignaturePad
              onSave={(b) => setBlob(b)}
              placeholder="Draw parent/guardian signature here"
              existingSignatureUrl={existingGuardianSigUrl}
              className="flex-1 flex flex-col space-y-2"
              canvasHeightClass="flex-1 min-h-[160px]"
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted/30 flex justify-between items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-95 transition-all cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!isValid}
          onClick={() => onConfirm(name, relation, blob)}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50 active:scale-[0.98] transition-all cursor-pointer shadow-sm shadow-accent/20"
        >
          Apply Signature
        </button>
      </div>
    </div>
  );
}
