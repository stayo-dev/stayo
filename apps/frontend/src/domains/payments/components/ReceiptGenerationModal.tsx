import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
} from '@/app/components/ui/dialog';
import { CheckCircle2, AlertTriangle, Download, FileText } from 'lucide-react';
import { tenantPortalApi } from '@features/tenant-portal/api';
import { StayoLoader } from '@shared/ui/brand';

interface Props {
  open: boolean;
  onClose: () => void;
  paymentId: string | null;
  receiptNumber?: string | null;
}

type Stage = 'idle' | 'generating' | 'success' | 'error';

export function ReceiptGenerationModal({ open, onClose, paymentId, receiptNumber }: Props) {
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('Preparing receipt details...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadBlob, setDownloadBlob] = useState<Blob | null>(null);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [cooldown, setCooldown] = useState(60);
  const cooldownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Cooldown countdown timer
  useEffect(() => {
    if (isRateLimited && cooldown > 0) {
      cooldownIntervalRef.current = setInterval(() => {
        setCooldown((prev) => {
          if (prev <= 1) {
            if (cooldownIntervalRef.current) clearInterval(cooldownIntervalRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (cooldownIntervalRef.current) clearInterval(cooldownIntervalRef.current);
    };
  }, [isRateLimited, cooldown]);

  useEffect(() => {
    if (!open) {
      // Reset state on close
      setStage('idle');
      setProgress(0);
      setErrorMessage(null);
      setDownloadBlob(null);
      setIsRateLimited(false);
      return;
    }

    if (!paymentId) return;

    let progressTimer: NodeJS.Timeout;
    let apiCompleted = false;
    let apiError: any = null;
    let fetchedBlob: Blob | null = null;

    setStage('generating');
    setProgress(0);
    setErrorMessage(null);

    // 1. Fire the API call
    const fetchReceipt = async () => {
      try {
        const blob = await tenantPortalApi.downloadReceipt(paymentId);
        fetchedBlob = blob;
        apiCompleted = true;
      } catch (err: any) {
        apiError = err;
        apiCompleted = true;
      }
    };
    fetchReceipt();

    // 2. Animate the progress bar dynamically
    const startTime = Date.now();
    const duration = 2500; // 2.5 seconds minimum generation animation

    const updateProgress = async () => {
      const elapsed = Date.now() - startTime;
      const calculatedProgress = Math.min(Math.round((elapsed / duration) * 100), 99);

      if (!apiCompleted) {
        setProgress(calculatedProgress);
        
        // Progress stage text changes
        if (calculatedProgress < 25) {
          setProgressText('Preparing receipt details...');
        } else if (calculatedProgress < 50) {
          setProgressText('Verifying transaction signature...');
        } else if (calculatedProgress < 75) {
          setProgressText('Applying brand template...');
        } else {
          setProgressText('Generating PDF document...');
        }

        progressTimer = setTimeout(updateProgress, 50);
      } else {
        // API call is complete!
        if (apiError) {
          let errorMsg = 'Generation failed. Please try again.';
          let rateLimitActive = false;
          let retrySeconds = 60;

          if (apiError.response?.data) {
            let dataText = '';
            if (apiError.response.data instanceof Blob) {
              try {
                dataText = await apiError.response.data.text();
              } catch (e) {}
            } else if (typeof apiError.response.data === 'string') {
              dataText = apiError.response.data;
            } else {
              try {
                dataText = JSON.stringify(apiError.response.data);
              } catch (e) {}
            }

            if (dataText) {
              try {
                const parsed = JSON.parse(dataText);
                errorMsg = parsed?.error?.message || parsed?.detail || parsed?.error || dataText;
                
                // Check if it's a rate limit error
                if (apiError.response.status === 429 || errorMsg.toLowerCase().includes('too many') || errorMsg.toLowerCase().includes('rate limit')) {
                  rateLimitActive = true;
                  const matches = errorMsg.match(/(\d+)\s*seconds?/i);
                  if (matches && matches[1]) {
                    retrySeconds = parseInt(matches[1], 10);
                  }
                }
              } catch {
                errorMsg = dataText;
              }
            }
          } else if (apiError.message) {
            errorMsg = apiError.message;
            if (errorMsg.toLowerCase().includes('429') || errorMsg.toLowerCase().includes('too many') || errorMsg.toLowerCase().includes('rate limit')) {
              rateLimitActive = true;
            }
          }

          setErrorMessage(errorMsg);
          setIsRateLimited(rateLimitActive);
          setCooldown(retrySeconds);
          setStage('error');
        } else if (fetchedBlob) {
          // Finish progress bar
          setProgress(100);
          setProgressText('Document complete!');
          setDownloadBlob(fetchedBlob);
          
          triggerDownload(fetchedBlob);
          setStage('success');
        }
      }
    };

    progressTimer = setTimeout(updateProgress, 50);

    return () => {
      clearTimeout(progressTimer);
    };
  }, [open, paymentId]);

  const triggerDownload = (blob: Blob) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const name = receiptNumber ? `Receipt_${receiptNumber}` : `Receipt_${paymentId?.slice(0, 8)}`;
    a.download = `${name}.pdf`;
    a.click();
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
    }, 250);
  };

  const handleManualDownload = () => {
    if (downloadBlob) {
      triggerDownload(downloadBlob);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-6 rounded-2xl border border-border shadow-2xl bg-card overflow-hidden">
        
        {stage === 'generating' && (
          <div className="flex flex-col items-center py-6 text-center space-y-6">
            <div className="relative flex items-center justify-center">
              <StayoLoader size="lg" className="text-[#FF7A00]" />
              <FileText className="absolute w-6 h-6 text-[#1E1E1E]" />
            </div>
            
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-[#1E1E1E] dark:text-white">Generating Receipt</h3>
              <p className="text-sm font-medium text-muted-foreground animate-pulse">{progressText}</p>
            </div>

            <div className="w-full space-y-1.5">
              <div className="w-full bg-[#1E1E1E]/5 dark:bg-white/10 h-2.5 rounded-full overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-[#FF7A00] to-[#E06B00] h-full rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs font-bold text-[#FF7A00]">{progress}%</span>
            </div>
          </div>
        )}

        {stage === 'success' && (
          <div className="flex flex-col items-center py-6 text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center animate-bounce">
              <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-bold text-[#1E1E1E] dark:text-white">Receipt Ready!</h3>
              <p className="text-sm text-muted-foreground">
                Your hostel-branded receipt has been generated. The download should begin automatically.
              </p>
            </div>

            <button
              onClick={handleManualDownload}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#FF7A00] text-white font-bold hover:bg-[#E06B00] transition-colors shadow-lg shadow-[#FF7A00]/20 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Download Receipt Again
            </button>
          </div>
        )}

        {stage === 'error' && (
          <div className="flex flex-col items-center py-4 space-y-5">
            <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>

            <div className="text-center space-y-2">
              <h3 className="text-lg font-bold text-[#1E1E1E] dark:text-white">
                {isRateLimited ? 'Generation Restricted' : 'Generation Failed'}
              </h3>
              <p className="text-sm text-red-600 dark:text-red-400 font-semibold px-2">
                {errorMessage}
              </p>
            </div>

            {isRateLimited && (
              <div className="w-full rounded-xl bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 p-4 space-y-2">
                <h4 className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                  Abuse Protection Active
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  To secure our servers, downloading receipts is limited. You can generate this receipt again in{' '}
                  <span className="font-bold text-[#FF7A00]">{cooldown}s</span>.
                </p>
              </div>
            )}

            <div className="flex w-full gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-3 px-4 rounded-xl border border-border bg-card text-[#1E1E1E] dark:text-white font-bold hover:bg-muted/50 transition-colors cursor-pointer"
              >
                Close
              </button>
              {isRateLimited && (
                <button
                  disabled
                  className="flex-1 py-3 px-4 rounded-xl bg-[#FF7A00]/50 text-white/80 font-bold cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  Retry in {cooldown}s
                </button>
              )}
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
