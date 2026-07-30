import { eyebrow, h1, sub } from '../stepStyles';

interface PublishStepProps {
  publishChoice: 'now' | 'draft';
  setPublishChoice: (choice: 'now' | 'draft') => void;
}

export function PublishStep({ publishChoice, setPublishChoice }: PublishStepProps) {
  const options: { value: 'now' | 'draft'; title: string; body: string }[] = [
    { value: 'now', title: 'Publish now', body: 'Go live & appear in search instantly' },
    { value: 'draft', title: 'Keep as draft', body: 'Finish details later, publish when ready' },
  ];
  return (
    <div>
      <div className={eyebrow}>RAISE THE FLAG</div>
      <h1 className={h1}>Ready to go live?</h1>
      <p className={sub}>Publish to start receiving enquiries, or keep polishing as a draft.</p>
      <div className="flex max-w-[440px] flex-col gap-3">
        {options.map((opt) => {
          const active = publishChoice === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPublishChoice(opt.value)}
              className={`flex items-center gap-3.5 rounded-2xl border-[1.5px] bg-card/95 px-5 py-4.5 text-left transition-colors ${
                active ? 'border-primary' : 'border-border'
              }`}
            >
              <span
                className={`flex h-5.5 w-5.5 flex-none items-center justify-center rounded-full border-2 ${
                  active ? 'border-primary' : 'border-border'
                }`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${active ? 'bg-primary' : 'bg-transparent'}`} />
              </span>
              <span className="text-left">
                <span className="block font-display text-base font-bold text-foreground">{opt.title}</span>
                <span className="text-[13px] font-medium text-muted-foreground">{opt.body}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
