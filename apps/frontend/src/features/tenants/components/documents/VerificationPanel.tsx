import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, Check, X, Send, MessageSquare, ChevronDown, ChevronUp, ExternalLink, ShieldCheck, User, AlertCircle, FileWarning } from 'lucide-react';
import { tenantService } from '@features/tenants/api';
import { queryKeys } from '@lib/queryKeys';

interface Props {
  hostelId: string;
  tenantId: string;
  documents: Record<string, any>[];
  profileType?: string;
  photoUrl?: string;
  onUpdated?: () => void;
}

export function VerificationPanel({ hostelId, tenantId, documents = [], profileType, photoUrl, onUpdated }: Props) {
  const qc = useQueryClient();
  const [newMessages, setNewMessages] = useState<Record<string, string>>({});
  const [expandedChats, setExpandedChats] = useState<Record<string, boolean>>({});
  const [rejectingDocId, setRejectingDocId] = useState<string>('');
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});

  const verifyMutation = useMutation({
    mutationFn: (docId: string) => tenantService.verifyDocument(tenantId, docId),
    onSuccess: () => {
      toast.success('Document approved');
      qc.invalidateQueries({ queryKey: queryKeys.tenants.full(hostelId, tenantId) });
      onUpdated?.();
    },
    onError: () => toast.error('Verification failed'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ docId, reason }: { docId: string; reason: string }) =>
      tenantService.rejectDocument(tenantId, docId, reason),
    onSuccess: () => {
      toast.success('Document query initiated');
      setRejectingDocId('');
      qc.invalidateQueries({ queryKey: queryKeys.tenants.full(hostelId, tenantId) });
      onUpdated?.();
    },
    onError: () => toast.error('Rejection failed'),
  });

  const messageMutation = useMutation({
    mutationFn: ({ docId, message }: { docId: string; message: string }) =>
      tenantService.postDocumentMessage(tenantId, docId, message),
    onSuccess: (_, variables) => {
      setNewMessages((prev) => ({ ...prev, [variables.docId]: '' }));
      qc.invalidateQueries({ queryKey: queryKeys.tenants.full(hostelId, tenantId) });
      onUpdated?.();
    },
    onError: () => toast.error('Failed to send message'),
  });

  const verifyAllMutation = useMutation({
    mutationFn: () => tenantService.verifyAllDocuments(tenantId),
    onSuccess: () => {
      toast.success('All active documents approved');
      qc.invalidateQueries({ queryKey: queryKeys.tenants.full(hostelId, tenantId) });
      onUpdated?.();
    },
    onError: () => toast.error('Could not approve all documents'),
  });

  const handleSendMessage = (docId: string) => {
    const text = (newMessages[docId] || '').trim();
    if (!text) return;
    messageMutation.mutate({ docId, message: text });
  };

  const toggleChat = (docId: string) => {
    setExpandedChats((prev) => ({ ...prev, [docId]: !prev[docId] }));
  };

  // Find checklist documents
  const aadhaarDoc = documents.find(d => {
    const t = String(d.doc_type ?? d.type ?? '').toUpperCase();
    return t === 'AADHAAR' || t === 'AADHAAR_CARD';
  });

  const isProfessional = String(profileType || 'STUDENT').toUpperCase() === 'WORKING_PROFESSIONAL';
  const idType = isProfessional ? 'WORK_ID' : 'COLLEGE_ID';
  const idDoc = documents.find(d => {
    const t = String(d.doc_type ?? d.type ?? '').toUpperCase();
    return t === idType || t === 'COLLEGE_ID' || t === 'WORK_ID';
  });

  const agreementDoc = documents.find(d => {
    const t = String(d.doc_type ?? d.type ?? '').toUpperCase();
    return t === 'AGREEMENT' || t === 'RENTAL_AGREEMENT';
  });

  const checklist = [
    {
      key: 'aadhaar',
      label: 'Aadhaar Card',
      description: 'Government photo identification card',
      doc: aadhaarDoc,
    },
    {
      key: 'id',
      label: isProfessional ? 'Work ID Card' : 'Student ID Card',
      description: isProfessional ? 'Proof of employment or company ID' : 'College/educational institution ID card',
      doc: idDoc,
    },
    {
      key: 'photo',
      label: 'Profile Photo',
      description: 'Recent passport-sized profile picture',
      doc: photoUrl ? {
        id: 'photo',
        doc_type: 'PHOTO',
        download_url: photoUrl,
        document_status: 'APPROVED',
        is_verified: true,
      } : null,
      isPhoto: true,
    },
    {
      key: 'agreement',
      label: 'Hostel Residency Agreement',
      description: 'Signed digital hostel residency agreement',
      doc: agreementDoc,
    }
  ];

  // Global counts for all required docs
  const totalCount = checklist.length;
  const verifiedCount = checklist.filter(item => {
    if (!item.doc) return false;
    const status = String(item.doc.document_status ?? item.doc.status ?? '').toUpperCase();
    return status === 'APPROVED' || item.doc.is_verified === true;
  }).length;

  const pendingDocs = checklist.filter(item => {
    if (!item.doc) return false;
    if (item.isPhoto) return false;
    const status = String(item.doc.document_status ?? item.doc.status ?? '').toUpperCase();
    return status === 'PENDING' || status === 'UPLOADED';
  });

  return (
    <div className="space-y-4">
      {/* Overview Progress Card */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Document Checklist</p>
            <p className="text-xs text-muted-foreground mt-1">
              Verification progress: <strong className="text-foreground">{verifiedCount} of {totalCount}</strong> complete
            </p>
          </div>
          {pendingDocs.length > 0 && (
            <button
              type="button"
              disabled={verifyAllMutation.isPending}
              onClick={() => verifyAllMutation.mutate()}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-bold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4" />
              Approve pending ({pendingDocs.length})
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-full bg-secondary rounded-full h-2 mt-4 overflow-hidden">
          <div
            className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${(verifiedCount / totalCount) * 100}%` }}
          />
        </div>
      </div>

      {/* Checklist items */}
      <div className="space-y-3">
        {checklist.map((item) => {
          const doc = item.doc;
          const status = doc ? String(doc.document_status ?? doc.status ?? 'PENDING').toUpperCase() : 'MISSING';
          const fileUrl = doc ? String(doc.download_url ?? '') : '';
          const docNumber = doc ? String(doc.doc_number ?? '').trim() : '';

          let chatMessages: { sender: string; sender_name: string; message: string; timestamp: string }[] = [];
          if (doc) {
            try {
              const reasonStr = String(doc.rejection_reason || '');
              if (reasonStr.startsWith('[') && reasonStr.endsWith(']')) {
                chatMessages = JSON.parse(reasonStr);
              } else if (reasonStr) {
                chatMessages = [{ sender: 'owner', sender_name: 'Owner Query', message: reasonStr, timestamp: '' }];
              }
            } catch {
              chatMessages = [];
            }
          }

          const docId = doc ? String(doc.id) : item.key;
          const isChatExpanded = expandedChats[docId] || chatMessages.length > 0;

          return (
            <div key={item.key} className="p-4 rounded-xl border border-border bg-card shadow-sm space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                <div className="flex gap-3 items-center min-w-0">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    status === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-600' :
                    status === 'REJECTED' ? 'bg-rose-500/10 text-rose-600' :
                    status === 'MISSING' ? 'bg-secondary text-muted-foreground' :
                    'bg-amber-500/10 text-amber-600'
                  }`}>
                    {item.isPhoto ? <User className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground text-sm">{item.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{item.description}</p>
                    {docNumber && <p className="text-[10px] font-mono text-muted-foreground mt-1 bg-secondary/50 px-1.5 py-0.5 rounded inline-block">No. {docNumber}</p>}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase ${
                    status === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/25' :
                    status === 'REJECTED' ? 'bg-rose-500/10 text-rose-600 border-rose-500/25' :
                    status === 'MISSING' ? 'bg-secondary text-muted-foreground border-border' :
                    'bg-amber-500/10 text-amber-600 border-amber-500/25'
                  }`}>
                    {status === 'APPROVED' ? 'Verified' : status === 'REJECTED' ? 'Queried' : status}
                  </span>

                  {fileUrl && (
                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1 rounded-lg border border-border hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0"
                      title="View file"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>

              {/* Actions for uploaded documents that are pending */}
              {doc && !item.isPhoto && status === 'PENDING' && (
                <div className="pt-2 border-t border-border/40 space-y-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={verifyMutation.isPending}
                      onClick={() => verifyMutation.mutate(docId)}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-bold"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => setRejectingDocId(rejectingDocId === docId ? '' : docId)}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 text-xs font-bold border border-rose-500/20"
                    >
                      <X className="w-3.5 h-3.5" />
                      Query / Reject
                    </button>
                  </div>

                  {rejectingDocId === docId && (
                    <div className="rounded-lg border border-rose-200 bg-rose-500/5 p-3 space-y-2">
                      <textarea
                        rows={2}
                        maxLength={500}
                        placeholder="Explain what is incorrect or missing in the file..."
                        value={rejectReasons[docId] || ''}
                        onChange={(e) => setRejectReasons((prev) => ({ ...prev, [docId]: e.target.value }))}
                        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-rose-500"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setRejectingDocId('')}
                          className="px-2 py-1 border border-border rounded text-[11px]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={rejectMutation.isPending || !(rejectReasons[docId] || '').trim()}
                          onClick={() => rejectMutation.mutate({ docId, reason: (rejectReasons[docId] || '').trim() })}
                          className="bg-rose-600 text-white px-2.5 py-1 rounded text-[11px] font-bold"
                        >
                          Send query
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Chat thread for uploaded docs */}
              {doc && !item.isPhoto && (
                <div className="pt-2 border-t border-border/40 space-y-2">
                  <button
                    type="button"
                    onClick={() => toggleChat(docId)}
                    className="flex items-center justify-between w-full text-xs text-muted-foreground hover:text-foreground"
                  >
                    <span className="flex items-center gap-1">
                      <MessageSquare className="w-3 h-3 text-accent" />
                      {chatMessages.length > 0
                        ? `Query History (${chatMessages.length})`
                        : 'Ask tenant to correct / start chat'}
                    </span>
                    {isChatExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>

                  {isChatExpanded && (
                    <div className="space-y-3 pt-1">
                      {chatMessages.length > 0 && (
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1 bg-secondary/20 p-2 rounded-lg">
                          {chatMessages.map((msg, idx) => {
                            const isOwner = msg.sender === 'owner';
                            return (
                              <div
                                key={idx}
                                className={`flex flex-col max-w-[90%] ${isOwner ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                              >
                                <span className="text-[9px] text-muted-foreground px-1">{msg.sender_name}</span>
                                <div className={`p-2 rounded-xl text-[11px] mt-0.5 ${
                                  isOwner ? 'bg-accent text-accent-foreground' : 'bg-secondary text-secondary-foreground'
                                }`}>
                                  {msg.message}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          placeholder="Type query to send..."
                          value={newMessages[docId] || ''}
                          onChange={(e) => setNewMessages((prev) => ({ ...prev, [docId]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSendMessage(docId);
                          }}
                          className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                        <button
                          type="button"
                          disabled={messageMutation.isPending}
                          onClick={() => handleSendMessage(docId)}
                          className="px-2 bg-accent text-accent-foreground rounded-lg hover:opacity-90"
                        >
                          <Send className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
