import { useState } from 'react';
import {
  Plus,
  X,
  Phone,
  MessageCircle,
  CircleDollarSign,
  Bell,
  LogOut,
  FolderOpen,
} from 'lucide-react';

interface FloatingActionMenuProps {
  phone: string;
  status: string;
  isOverdue: boolean;
  onCollect?: () => void;
  onRemind?: () => void;
  onWhatsApp?: () => void;
  onCall?: () => void;
  onMoveRoom?: () => void;
  onDocs?: () => void;
}

export function FloatingActionMenu({
  phone,
  status,
  isOverdue,
  onCollect,
  onRemind,
  onWhatsApp,
  onCall,
  onMoveRoom,
  onDocs,
}: FloatingActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  // FORMER_TENANT belongs here and was missing, so a tenant who had already
  // moved out still got the full action set — including "Move Out" a second
  // time, and payment/reminder actions against a closed tenancy.
  const isInactive = ['LEFT', 'CANCELLED', 'EXPIRED', 'FORMER_TENANT'].includes(status);

  if (isInactive) return null;

  const toggleMenu = () => setIsOpen(!isOpen);

  const handleAction = (cb?: () => void) => {
    if (cb) cb();
    setIsOpen(false);
  };

  return (
    <div className="fixed bottom-20 right-4 z-50 md:hidden flex flex-col items-end gap-3">
      {/* Action items overlay */}
      {isOpen && (
        <div className="flex flex-col items-end gap-2.5 animate-in fade-in slide-in-from-bottom-5 duration-200">
          {onCollect && isOverdue && (
            <div className="flex items-center gap-2">
              <span className="bg-background/95 dark:bg-card px-2.5 py-1 rounded-md text-xs font-semibold shadow-sm border border-border">
                Record Payment
              </span>
              <button
                type="button"
                onClick={() => handleAction(onCollect)}
                className="w-11 h-11 rounded-full bg-accent text-accent-foreground flex items-center justify-center shadow-lg active:scale-95 transition-transform"
              >
                <CircleDollarSign className="w-5 h-5" />
              </button>
            </div>
          )}

          {onRemind && isOverdue && status === 'ACTIVE' && (
            <div className="flex items-center gap-2">
              <span className="bg-background/95 dark:bg-card px-2.5 py-1 rounded-md text-xs font-semibold shadow-sm border border-border">
                Send Reminder
              </span>
              <button
                type="button"
                onClick={() => handleAction(onRemind)}
                className="w-11 h-11 rounded-full bg-secondary text-foreground flex items-center justify-center shadow-lg active:scale-95 transition-transform"
              >
                <Bell className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
          )}

          {onWhatsApp && (
            <div className="flex items-center gap-2">
              <span className="bg-background/95 dark:bg-card px-2.5 py-1 rounded-md text-xs font-semibold shadow-sm border border-border">
                WhatsApp Tenant
              </span>
              <button
                type="button"
                onClick={() => handleAction(onWhatsApp)}
                className="w-11 h-11 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg active:scale-95 transition-transform"
              >
                <MessageCircle className="w-5 h-5" />
              </button>
            </div>
          )}

          {onCall && (
            <div className="flex items-center gap-2">
              <span className="bg-background/95 dark:bg-card px-2.5 py-1 rounded-md text-xs font-semibold shadow-sm border border-border">
                Call Tenant
              </span>
              <button
                type="button"
                onClick={() => handleAction(onCall)}
                className="w-11 h-11 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-lg active:scale-95 transition-transform"
              >
                <Phone className="w-5 h-5" />
              </button>
            </div>
          )}

          {onMoveRoom && (
            <div className="flex items-center gap-2">
              <span className="bg-background/95 dark:bg-card px-2.5 py-1 rounded-md text-xs font-semibold shadow-sm border border-border">
                Transfer Room
              </span>
              <button
                type="button"
                onClick={() => handleAction(onMoveRoom)}
                className="w-11 h-11 rounded-full bg-secondary text-foreground flex items-center justify-center shadow-lg active:scale-95 transition-transform"
              >
                <LogOut className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
          )}

          {onDocs && (
            <div className="flex items-center gap-2">
              <span className="bg-background/95 dark:bg-card px-2.5 py-1 rounded-md text-xs font-semibold shadow-sm border border-border">
                Verify Documents
              </span>
              <button
                type="button"
                onClick={() => handleAction(onDocs)}
                className="w-11 h-11 rounded-full bg-secondary text-foreground flex items-center justify-center shadow-lg active:scale-95 transition-transform"
              >
                <FolderOpen className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main trigger button */}
      <button
        type="button"
        onClick={toggleMenu}
        className={`w-14 h-14 rounded-full flex items-center justify-center shadow-xl text-primary-foreground transition-all duration-300 ${
          isOpen
            ? 'bg-rose-500 hover:bg-rose-600 rotate-90 scale-95'
            : 'bg-accent hover:bg-accent/90'
        }`}
        aria-label="Add Action"
      >
        {isOpen ? <X className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
      </button>
    </div>
  );
}
