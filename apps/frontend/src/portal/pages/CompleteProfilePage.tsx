import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Camera,
  CheckCircle2,
  GraduationCap,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { tenantService } from '@features/tenants/api';
import { useAuth } from '@context/AuthContext';
import { StayoLoader } from '@shared/ui/brand';

type ProfileType = '' | 'STUDENT' | 'WORKING_PROFESSIONAL';

type OnboardingForm = {
  name: string;
  phone: string;
  emergency_contact: string;
  gender: string;
  date_of_birth: string;
  permanent_address: string;
  profile_type: ProfileType;
  college_name: string;
  roll_number: string;
  course: string;
  year_of_study: string;
  branch: string;
  office_name: string;
  office_location: string;
  job_role: string;
};

type OnboardingSettings = {
  require_profile_photo_onboarding?: boolean;
  require_phone_otp_onboarding?: boolean;
  invited_defaults?: Partial<OnboardingForm>;
  invite_summary?: {
    monthly_rent?: number;
    advance_deposit?: number;
    maintenance_charge?: number;
    maintenance_type?: string;
    joined_on?: string | null;
    room?: { room_no?: string; floor?: number | null } | null;
  };
};

const initialForm: OnboardingForm = {
  name: '',
  phone: '',
  emergency_contact: '',
  gender: '',
  date_of_birth: '',
  permanent_address: '',
  profile_type: '',
  college_name: '',
  roll_number: '',
  course: '',
  year_of_study: '',
  branch: '',
  office_name: '',
  office_location: '',
  job_role: '',
};

const steps = [
  { id: 1, title: 'Identity', icon: UserRound },
  { id: 2, title: 'Background', icon: GraduationCap },
  { id: 3, title: 'Review', icon: ShieldCheck },
];

const normalizeIndianPhone = (value: string) => {
  const cleaned = String(value || '').replace(/\D/g, '');
  if (cleaned.length === 10) return `+91${cleaned}`;
  if (cleaned.length === 12 && cleaned.startsWith('91')) return `+${cleaned}`;
  if (cleaned.length === 13 && cleaned.startsWith('091')) return `+${cleaned.slice(1)}`;
  return null;
};

const indianPhoneDigits = (value: string) => {
  const normalized = normalizeIndianPhone(value);
  return normalized ? normalized.slice(3) : String(value || '').replace(/\D/g, '').slice(-10);
};

const currency = (value?: number) =>
  Number(value || 0).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });

const fieldClass =
  'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20';

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required ? ' *' : ''}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${fieldClass} mt-1.5`}
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required ? ' *' : ''}
      </span>
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className={`${fieldClass} mt-1.5 resize-none`}
      />
    </label>
  );
}

export function CompleteProfilePage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, updateUser } = useAuth();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<OnboardingForm>(initialForm);
  const [settings, setSettings] = useState<OnboardingSettings | null>(null);
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [selectedCollege, setSelectedCollege] = useState<string>('');
  const [selectedCourse, setSelectedCourse] = useState<string>('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/', { replace: true });
      return;
    }
    if (user.role?.toLowerCase() !== 'tenant') {
      navigate('/dashboard', { replace: true });
      return;
    }
    if (user.is_profile_completed) {
      navigate('/tenant/home', { replace: true });
    }
  }, [authLoading, navigate, user]);

  useEffect(() => {
    if (!user || user.role?.toLowerCase() !== 'tenant') return;
    let mounted = true;
    setLoading(true);
    tenantService
      .getMyOnboardingSettings()
      .then((data: OnboardingSettings) => {
        if (!mounted) return;
        const defaults = data?.invited_defaults ?? {};
        setSettings(data);

        const college = String(defaults.college_name || '');
        if (college === 'Sreenidhi Institute of Science and Technology' || college === 'Sreenidhi University') {
          setSelectedCollege(college);
        } else if (college) {
          setSelectedCollege('Other');
        }

        const course = String(defaults.course || '');
        if (course === 'B.Tech') {
          setSelectedCourse(course);
        } else if (course) {
          setSelectedCourse('Other');
        }

        setForm((prev) => ({
          ...prev,
          name: prev.name || defaults.name || user.name || '',
          phone: prev.phone || defaults.phone || '',
          emergency_contact:
            prev.emergency_contact || defaults.emergency_contact || '',
          gender: prev.gender || defaults.gender || '',
          date_of_birth: prev.date_of_birth || defaults.date_of_birth || '',
          permanent_address: prev.permanent_address || defaults.permanent_address || '',
          profile_type: (prev.profile_type || defaults.profile_type || '') as ProfileType,
          college_name: prev.college_name || college,
          roll_number: prev.roll_number || defaults.roll_number || '',
          course: prev.course || course,
          year_of_study: prev.year_of_study || String(defaults.year_of_study || ''),
          branch: prev.branch || defaults.branch || '',
          office_name: prev.office_name || defaults.office_name || '',
          office_location: prev.office_location || defaults.office_location || '',
          job_role: prev.job_role || defaults.job_role || '',
        }));
      })
      .catch((err: unknown) => {
        const message =
          (err as { response?: { data?: { error?: { message?: string } } } })?.response
            ?.data?.error?.message || 'Could not load your invited details';
        setError(message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [user]);

  const photoRequired = true;
  const inviteSummary = settings?.invite_summary;

  const progress = useMemo(() => Math.round((step / steps.length) * 100), [step]);

  const update = (key: keyof OnboardingForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const validateStep = (targetStep = step) => {
    if (targetStep === 1) {
      if (!form.name.trim()) return 'Full name is required';
      const primaryPhone = normalizeIndianPhone(form.phone);
      const emergencyPhone = normalizeIndianPhone(form.emergency_contact);
      if (!primaryPhone) return 'Enter a valid 10-digit Indian mobile number';
      if (!form.emergency_contact.trim()) return 'Emergency contact is required';
      if (!emergencyPhone) return 'Enter a valid 10-digit emergency mobile number';
      if (primaryPhone === emergencyPhone) return 'Primary mobile and emergency mobile must be different numbers';
      if (!form.gender) return 'Gender is required';
      if (!form.permanent_address.trim()) return 'Permanent address is required';
    }

    if (targetStep === 2) {
      if (!form.profile_type) return 'Select student or working professional';
      if (form.profile_type === 'STUDENT') {
        if (!form.college_name.trim()) return 'College name is required';
        if (!form.roll_number.trim()) return 'Roll number is required';
      }
      if (form.profile_type === 'WORKING_PROFESSIONAL' && !form.office_name.trim()) {
        return 'Company or office name is required';
      }
    }

    if (targetStep === 3 && photoRequired && !profilePhotoFile) {
      return 'Profile photo is required';
    }

    return null;
  };

  const goNext = () => {
    const message = validateStep(step);
    if (message) {
      setError(message);
      return;
    }
    setError('');
    setStep((current) => Math.min(3, current + 1));
  };

  const handlePhotoChange = (file?: File) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Profile photo must be JPG, PNG, or WEBP');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Profile photo must be less than 2MB');
      return;
    }
    setProfilePhotoFile(file);
    setProfilePhotoPreview(URL.createObjectURL(file));
    setError('');
  };

  const submit = async () => {
    const stepOneError = validateStep(1);
    const stepTwoError = validateStep(2);
    const stepThreeError = validateStep(3);
    const message = stepOneError || stepTwoError || stepThreeError;
    if (message) {
      setError(message);
      if (stepOneError) setStep(1);
      else if (stepTwoError) setStep(2);
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await tenantService.completeMyProfile(
        {
          name: form.name.trim(),
          phone: normalizeIndianPhone(form.phone),
          emergency_contact: form.emergency_contact.trim(),
          personal_email: null,
          gender: form.gender,
          date_of_birth: form.date_of_birth || null,
          permanent_address: form.permanent_address.trim(),
          temporary_address: form.permanent_address.trim(),
          address: form.permanent_address.trim(),
          profile_type: form.profile_type,
          college_name: form.profile_type === 'STUDENT' ? form.college_name.trim() : null,
          roll_number: form.profile_type === 'STUDENT' ? form.roll_number.trim() : null,
          course: form.profile_type === 'STUDENT' ? form.course.trim() || null : null,
          year_of_study:
            form.profile_type === 'STUDENT' && form.year_of_study
              ? Number(form.year_of_study)
              : null,
          branch: form.profile_type === 'STUDENT' ? form.branch.trim() || null : null,
          office_name:
            form.profile_type === 'WORKING_PROFESSIONAL' ? form.office_name.trim() : null,
          office_location:
            form.profile_type === 'WORKING_PROFESSIONAL'
              ? form.office_location.trim() || null
              : null,
          job_role:
            form.profile_type === 'WORKING_PROFESSIONAL' ? form.job_role.trim() || null : null,
        },
        profilePhotoFile,
      );

      // ADR-031: update AuthContext's in-memory user directly — there's no
      // more localStorage-persisted user object to patch.
      updateUser({ is_profile_completed: true });
      toast.success('Profile completed');
      window.location.assign('/tenant/home');
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response
          ?.data?.error?.message || 'Could not complete your profile';
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <StayoLoader size="lg" className="text-accent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-6 sm:py-8">
      <main className="mx-auto grid w-full max-w-5xl gap-5 lg:grid-cols-[340px_1fr]">
        <aside className="rounded-2xl overflow-hidden border border-border shadow-sm h-fit">
          <div
            className="px-5 py-4 relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #1B2D5B 0%, #243A72 100%)' }}
          >
            <div
              className="absolute inset-0 opacity-10"
              style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, #F07B1D 0%, transparent 60%)' }}
            />
            <div className="relative flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-white/15 ring-1 ring-white/20 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-white/90" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60">Onboarding</p>
                <h1
                  className="text-lg font-bold text-white leading-tight"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Complete your profile
                </h1>
              </div>
            </div>
          </div>

          <div className="bg-card p-5">
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-4 space-y-2">
              {steps.map((item) => {
                const Icon = item.icon;
                const active = item.id === step;
                const done = item.id < step;
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => {
                      if (item.id < step) setStep(item.id);
                    }}
                    className={`w-full flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm transition-colors ${
                      active
                        ? 'bg-accent text-accent-foreground shadow-sm'
                        : done
                        ? 'bg-success/10 text-success'
                        : 'bg-secondary/60 text-muted-foreground'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                      active ? 'bg-white/20' : done ? 'bg-success/20' : 'bg-muted'
                    }`}>
                      {done ? '✓' : item.id}
                    </div>
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="font-medium">{item.title}</span>
                  </button>
                );
              })}
            </div>

          {inviteSummary && (
            <div className="mt-5 rounded-2xl border border-border bg-secondary/40 p-4 text-sm">
              <p className="font-bold text-foreground">Invitation details</p>
              <dl className="mt-3 space-y-2 text-muted-foreground">
                <div className="flex justify-between gap-3">
                  <dt>Room</dt>
                  <dd className="text-foreground font-medium">
                    {inviteSummary.room?.room_no || 'Assigned'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Rent</dt>
                  <dd className="text-foreground font-medium">
                    {currency(inviteSummary.monthly_rent)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Deposit</dt>
                  <dd className="text-foreground font-medium">
                    {currency(inviteSummary.advance_deposit)}
                  </dd>
                </div>
              </dl>
            </div>
          )}
          </div>
        </aside>

        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
          {error && (
            <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2.5">
              <span className="text-amber-600 shrink-0 mt-0.5 font-bold">!</span>
              <p className="text-sm text-amber-800">{error}</p>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-foreground">Identity and contact</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Some details are pre-filled from your owner’s invitation.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Full name"
                  value={form.name}
                  required
                  onChange={(value) => update('name', value)}
                  placeholder="Your full name"
                />
                <Field
                  label="Mobile number"
                  value={indianPhoneDigits(form.phone)}
                  required
                  onChange={(value) => update('phone', indianPhoneDigits(value))}
                  placeholder="10-digit mobile"
                />
                <Field
                  label="Emergency contact"
                  value={form.emergency_contact}
                  required
                  onChange={(value) => update('emergency_contact', value)}
                  placeholder="Parent or guardian phone"
                />
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">Gender *</span>
                  <select
                    value={form.gender}
                    onChange={(e) => update('gender', e.target.value)}
                    className={`${fieldClass} mt-1.5`}
                  >
                    <option value="">Select gender</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </select>
                </label>
                <Field
                  label="Date of birth"
                  value={form.date_of_birth}
                  type="date"
                  onChange={(value) => update('date_of_birth', value)}
                />
              </div>

              <div className="grid gap-4">
                <TextArea
                  label="Permanent address (Address, City, State, Pincode)"
                  value={form.permanent_address}
                  required
                  onChange={(value) => update('permanent_address', value)}
                  placeholder="House, street, city, state, pincode"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2
                  className="text-lg font-bold text-foreground"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Education or work
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  This helps your hostel maintain complete operational records.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => update('profile_type', 'STUDENT')}
                  className={`rounded-2xl border-2 p-4 text-left transition-all active:scale-[0.98] ${
                    form.profile_type === 'STUDENT'
                      ? 'border-accent bg-accent/10 shadow-sm'
                      : 'border-border bg-card hover:border-accent/40'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center mb-3 ${
                    form.profile_type === 'STUDENT' ? 'bg-accent text-accent-foreground' : 'bg-accent/10 text-accent'
                  }`}>
                    <GraduationCap className="w-5 h-5" />
                  </div>
                  <p className="font-bold text-foreground">Student</p>
                  <p className="text-xs text-muted-foreground mt-0.5">College and course details</p>
                </button>
                <button
                  type="button"
                  onClick={() => update('profile_type', 'WORKING_PROFESSIONAL')}
                  className={`rounded-2xl border-2 p-4 text-left transition-all active:scale-[0.98] ${
                    form.profile_type === 'WORKING_PROFESSIONAL'
                      ? 'border-primary bg-primary/10 shadow-sm'
                      : 'border-border bg-card hover:border-primary/40'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center mb-3 ${
                    form.profile_type === 'WORKING_PROFESSIONAL' ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'
                  }`}>
                    <BriefcaseBusiness className="w-5 h-5" />
                  </div>
                  <p className="font-bold text-foreground">Working professional</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Company and role details</p>
                </button>
              </div>

              {form.profile_type === 'STUDENT' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">College *</span>
                    <select
                      value={selectedCollege}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSelectedCollege(val);
                        if (val !== 'Other') {
                          update('college_name', val);
                        } else {
                          update('college_name', '');
                        }
                      }}
                      className={`${fieldClass} mt-1.5`}
                    >
                      <option value="">Select College</option>
                      <option value="Sreenidhi Institute of Science and Technology">Sreenidhi Institute of Science and Technology</option>
                      <option value="Sreenidhi University">Sreenidhi University</option>
                      <option value="Other">Other</option>
                    </select>
                  </label>

                  {selectedCollege === 'Other' && (
                    <Field
                      label="Custom College Name"
                      value={form.college_name}
                      required
                      onChange={(value) => update('college_name', value)}
                    />
                  )}

                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">Course</span>
                    <select
                      value={selectedCourse}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSelectedCourse(val);
                        if (val !== 'Other') {
                          update('course', val);
                        } else {
                          update('course', '');
                        }
                      }}
                      className={`${fieldClass} mt-1.5`}
                    >
                      <option value="">Select Course</option>
                      <option value="B.Tech">B.Tech</option>
                      <option value="Other">Other</option>
                    </select>
                  </label>

                  {selectedCourse === 'Other' && (
                    <Field
                      label="Custom Course Name"
                      value={form.course}
                      onChange={(value) => update('course', value)}
                    />
                  )}

                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">Year of study</span>
                    <select
                      value={form.year_of_study}
                      onChange={(e) => update('year_of_study', e.target.value)}
                      className={`${fieldClass} mt-1.5`}
                    >
                      <option value="">Select Year of study</option>
                      <option value="1">1st Year</option>
                      <option value="2">2nd Year</option>
                      <option value="3">3rd Year</option>
                      <option value="4">4th Year</option>
                    </select>
                  </label>

                  <Field
                    label="Roll number"
                    value={form.roll_number}
                    required
                    onChange={(value) => update('roll_number', value)}
                  />
                  <Field
                    label="Branch"
                    value={form.branch}
                    onChange={(value) => update('branch', value)}
                  />
                </div>
              )}

              {form.profile_type === 'WORKING_PROFESSIONAL' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Company or office"
                    value={form.office_name}
                    required
                    onChange={(value) => update('office_name', value)}
                  />
                  <Field
                    label="Job role"
                    value={form.job_role}
                    onChange={(value) => update('job_role', value)}
                  />
                  <Field
                    label="Office location"
                    value={form.office_location}
                    onChange={(value) => update('office_location', value)}
                  />
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2
                  className="text-lg font-bold text-foreground"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Review and submit
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  You can edit these details later from your tenant profile.
                </p>
              </div>

              <label className="flex items-center gap-4 rounded-2xl border-2 border-dashed border-accent/30 bg-accent/5 p-4 cursor-pointer hover:border-accent transition-colors">
                <div className={`w-16 h-16 rounded-full overflow-hidden bg-secondary flex items-center justify-center shrink-0 ${
                  profilePhotoPreview ? 'ring-2 ring-accent ring-offset-2' : 'ring-1 ring-border'
                }`}>
                  {profilePhotoPreview ? (
                    <img
                      src={profilePhotoPreview}
                      alt="Profile preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Camera className="w-6 h-6 text-accent" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-foreground text-sm">
                    Profile photo {photoRequired ? '*' : '(optional)'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">JPG, PNG, or WEBP under 2MB</p>
                  {profilePhotoFile && (
                    <p className="text-xs text-accent font-medium mt-1 truncate">{profilePhotoFile.name}</p>
                  )}
                </div>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => handlePhotoChange(e.target.files?.[0])}
                />
                <span className="text-sm font-semibold text-accent shrink-0">Choose</span>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ['Name', form.name],
                  ['Phone', normalizeIndianPhone(form.phone) || form.phone],
                  ['Emergency', form.emergency_contact],
                  ['Type', form.profile_type === 'STUDENT' ? 'Student' : 'Working professional'],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-border bg-secondary/40 p-4">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-sm font-bold text-foreground">{value || 'Not provided'}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-accent/20 bg-accent/10 p-4 text-sm text-foreground flex gap-3">
                <CheckCircle2 className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                <p>
                  OTP verification is not required right now. Your phone will remain unverified
                  until verification is added back to onboarding.
                </p>
              </div>
            </div>
          )}

          <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-5">
            <button
              type="button"
              disabled={step === 1 || submitting}
              onClick={() => {
                setError('');
                setStep((current) => Math.max(1, current - 1));
              }}
              className="inline-flex items-center gap-2 rounded-2xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground disabled:opacity-40 active:scale-[0.98] transition-transform"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            {step < 3 ? (
              <button
                type="button"
                onClick={goNext}
                className="inline-flex items-center gap-2 rounded-2xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground active:scale-[0.98] transition-transform shadow-sm"
              >
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                disabled={submitting}
                onClick={submit}
                className="inline-flex min-w-36 items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-60 active:scale-[0.98] transition-transform shadow-sm"
              >
                {submitting ? <StayoLoader size="sm" label={null} /> : null}
                {submitting ? 'Saving…' : 'Complete profile'}
              </button>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
