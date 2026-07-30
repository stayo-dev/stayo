interface ToggleProps {
  checked: boolean;
  onChange: () => void;
  label: string;
  sub: string;
}

/** Ports the toggle-switch visual already used in owner-money's ReviewStep.tsx (bg-primary/bg-muted track + translating knob) — features/ can't import app/components/ui/switch.tsx directly. */
export function Toggle({ checked, onChange, label, sub }: ToggleProps) {
  return (
    <button type="button" onClick={onChange} className="flex w-full items-center gap-3 border-t border-border py-3.5 text-left">
      <span className="flex-1">
        <span className="block text-[13.5px] font-semibold text-foreground">{label}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">{sub}</span>
      </span>
      <span className={`relative h-[25px] w-[42px] flex-none rounded-full transition-colors ${checked ? 'bg-[#A45D44]' : 'bg-muted'}`}>
        <span className={`absolute top-0.5 h-[21px] w-[21px] rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[17px]' : 'translate-x-0.5'}`} />
      </span>
    </button>
  );
}
