import { useEffect, useState } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { 
  ShieldCheck, 
  AlertTriangle, 
  Loader2, 
  User, 
  Calendar, 
  DollarSign, 
  CheckCircle2, 
  Clock, 
  CreditCard,
  Phone,
  Mail,
  Home,
  WifiOff,
  FileX
} from 'lucide-react';
import { verifyReceipt, VerificationDetails } from '@/domains/payments/api';
import { PublicLayout } from './PublicLayout';

export function ReceiptVerificationPage() {
  const { token: routeToken } = useParams<{ token: string }>();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<'INVALID' | 'NOT_FOUND' | 'EXPIRED' | 'UNAVAILABLE' | 'GENERIC' | null>(null);
  const [data, setData] = useState<VerificationDetails | null>(null);

  // Extract token from route parameter or query parameter '?token=...'
  const token = routeToken || new URLSearchParams(location.search).get('token');

  useEffect(() => {
    // Dynamic SEO Metadata
    document.title = 'Verify Payment Receipt | Stayo';
    const desc = document.querySelector('meta[name="description"]');
    desc?.setAttribute(
      'content',
      'Verify the authenticity of digital payment receipts issued by Stayo, Hyderabad.'
    );
  }, []);

  useEffect(() => {
    if (!token) {
      setError('Verification token is missing from the URL.');
      setErrorType('INVALID');
      setLoading(false);
      return;
    }

    async function doVerify() {
      try {
        setLoading(true);
        setError(null);
        setErrorType(null);
        const verifiedData = await verifyReceipt(token);
        setData(verifiedData);
      } catch (err: any) {
        console.error('Error during receipt verification:', err);
        if (!err.response) {
          setErrorType('UNAVAILABLE');
          setError('The verification server could not be reached. Please check your network connection and try again.');
        } else if (err.response.status === 404) {
          setErrorType('NOT_FOUND');
          setError('This receipt record does not exist in our database. It may have been deleted or archived.');
        } else if (err.response.status === 400) {
          const errMsg = err.response.data?.error || '';
          if (errMsg.toLowerCase().includes('expired')) {
            setErrorType('EXPIRED');
            setError('This verification link has expired. Receipts are valid for verification up to 1 year from issue date.');
          } else {
            setErrorType('INVALID');
            setError('This receipt token could not be verified. The signature is invalid or has been modified.');
          }
        } else {
          setErrorType('GENERIC');
          setError(err.response.data?.error || err.message || 'An unexpected error occurred while verifying the receipt.');
        }
      } finally {
        setLoading(false);
      }
    }

    doVerify();
  }, [token]);

  const renderErrorIcon = () => {
    switch (errorType) {
      case 'UNAVAILABLE':
        return <WifiOff className="w-8 h-8 text-red-500" />;
      case 'NOT_FOUND':
        return <FileX className="w-8 h-8 text-red-500" />;
      case 'EXPIRED':
        return <Clock className="w-8 h-8 text-red-500" />;
      default:
        return <AlertTriangle className="w-8 h-8 text-red-500" />;
    }
  };

  const getErrorTitle = () => {
    switch (errorType) {
      case 'UNAVAILABLE':
        return 'Server Connection Error';
      case 'NOT_FOUND':
        return 'Receipt Not Found';
      case 'EXPIRED':
        return 'Verification Expired';
      case 'INVALID':
        return 'Invalid or Tampered Receipt';
      default:
        return 'Verification Failed';
    }
  };

  return (
    <PublicLayout title="Receipt Verification" subtitle="Verify and inspect authentic digital hostel receipts.">
      <div className="max-w-xl mx-auto px-4 py-16">
        {loading && (
          <div className="flex flex-col items-center justify-center py-12 px-6 bg-white/70 backdrop-blur-md rounded-2xl border border-slate-200/50 shadow-xl">
            <Loader2 className="w-10 h-10 text-[#F07B1D] animate-spin mb-4" />
            <p className="text-slate-600 font-medium animate-pulse">Cryptographically verifying receipt signature...</p>
          </div>
        )}

        {!loading && error && (
          <div className="bg-white/80 backdrop-blur-md rounded-2xl border border-red-100 shadow-xl overflow-hidden animate-fadeIn">
            <div className="bg-red-500 py-4 px-6 flex items-center gap-3 text-white">
              <AlertTriangle className="w-6 h-6 flex-shrink-0" />
              <h2 className="text-lg font-semibold m-0">Verification Failed</h2>
            </div>
            
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                {renderErrorIcon()}
              </div>
              <p className="text-slate-800 font-bold text-lg mb-2">{getErrorTitle()}</p>
              <p className="text-slate-500 text-sm mb-6 max-w-sm mx-auto">
                {error}
              </p>

              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <a
                  href="tel:9392433422"
                  className="no-underline font-semibold text-sm px-6 py-2.5 rounded-lg border border-[#1B2D5B] text-[#1B2D5B] hover:bg-slate-50 transition-colors inline-flex items-center justify-center gap-2"
                >
                  <Phone className="w-4 h-4" />
                  <span>Call Warden</span>
                </a>
                <a
                  href="mailto:support@yourstayo.com"
                  className="no-underline font-semibold text-sm px-6 py-2.5 rounded-lg text-white hover:opacity-90 transition-opacity inline-flex items-center justify-center gap-2"
                  style={{ background: '#1B2D5B' }}
                >
                  <Mail className="w-4 h-4" />
                  <span>Contact Support</span>
                </a>
              </div>
            </div>
          </div>
        )}

        {!loading && !error && data && (
          <div className="bg-white/80 backdrop-blur-md rounded-2xl border border-emerald-100 shadow-xl overflow-hidden animate-fadeIn">
            {/* Header Status Bar */}
            <div className="bg-[#1B2D5B] py-6 px-6 relative overflow-hidden">
              {/* Background Glow */}
              <div className="absolute right-0 top-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl" />
              
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center flex-shrink-0 animate-scaleIn">
                  <ShieldCheck className="w-7 h-7 text-white" />
                </div>
                <div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 mb-1 border border-emerald-500/30">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>VERIFIED RECEIPT</span>
                  </div>
                  <h2 className="text-xl font-bold text-white m-0 tracking-tight">Stayo</h2>
                </div>
              </div>
            </div>

            <div className="p-8">
              {/* Obligation Summary */}
              <div className="text-center pb-6 mb-6 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-1">Receipt Number</span>
                <span className="text-lg font-mono font-bold text-slate-800 bg-slate-50 px-3 py-1 rounded-md border border-slate-100">
                  {data.receipt_number}
                </span>
                
                <div className="mt-6">
                  <span className="text-3xl font-extrabold text-slate-800">
                    ₹{data.amount.toLocaleString('en-IN')}
                  </span>
                  <span className="text-emerald-600 font-bold block text-sm mt-1 flex items-center justify-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    Successfully Settled
                  </span>
                </div>
              </div>

              {/* Obligation details */}
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Resident & Obligation Details</h3>
              <div className="bg-[#FFFDF8] border border-amber-100/50 rounded-xl p-4 mb-6 space-y-3.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 flex items-center gap-2">
                    <User className="w-4 h-4 text-slate-400" />
                    Resident Name
                  </span>
                  <span className="font-semibold text-slate-800">{data.tenant_name}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 flex items-center gap-2">
                    <Home className="w-4 h-4 text-slate-400" />
                    Allocated Room
                  </span>
                  <span className="font-semibold text-slate-800">
                    {data.room_no ? `Room ${data.room_no}` : 'N/A'} {data.room_floor != null ? `(Floor ${data.room_floor})` : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-slate-400" />
                    Issue Date
                  </span>
                  <span className="font-semibold text-slate-800">
                    {new Date(data.issued_at).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric'
                    })}
                  </span>
                </div>
              </div>

              {/* Transaction details */}
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Audit Details</h3>
              <div className="border border-slate-100 rounded-xl p-4 mb-6 space-y-3.5 bg-slate-50/50">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-slate-400" />
                    Payment Method
                  </span>
                  <span className="font-bold text-slate-800 uppercase text-xs tracking-wider">{data.payment_method}</span>
                </div>
                {data.transaction_id && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Transaction ID</span>
                    <span className="font-mono text-xs text-slate-700 bg-slate-100/80 px-2 py-0.5 rounded select-all">
                      {data.transaction_id}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-slate-400" />
                    Outstanding Dues
                  </span>
                  <span className={`font-semibold ${data.outstanding_dues > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                    ₹{data.outstanding_dues.toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-slate-400" />
                    Available Credit
                  </span>
                  <span className="font-semibold text-emerald-600">
                    ₹{data.future_credit.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>

              {/* Verification Signature Note */}
              <div className="flex gap-2.5 items-start p-3 bg-amber-500/5 rounded-xl border border-amber-500/10 text-xs text-amber-800 leading-relaxed mb-8">
                <ShieldCheck className="w-4 h-4 text-[#F07B1D] mt-0.5 flex-shrink-0" />
                <p className="m-0">
                  This transaction is cryptographically signed and secured using SHA256 HMAC tokens. The record has been matched directly with the live HMS ledger and verified as authentic.
                </p>
              </div>

              <div className="text-center">
                <Link
                  to="/"
                  className="no-underline text-[#1B2D5B] hover:text-[#F07B1D] text-sm font-semibold inline-flex items-center gap-1.5 transition-colors"
                >
                  <span>Go to Homepage</span>
                  <span>&rarr;</span>
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
