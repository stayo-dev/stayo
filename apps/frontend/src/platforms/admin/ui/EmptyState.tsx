import { ADMIN_CARD } from '../theme/palette';

/**
 * A genuinely empty queue — distinct from `NotWiredYet`, which means the data
 * source does not exist. Keeping the two apart matters: "nothing to review"
 * and "this feature isn't built" must never look the same to an admin.
 */
export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className={`${ADMIN_CARD} px-5 py-14 text-center`}>
      <div className="font-display text-[17px] font-bold text-[#221E1A]">{title}</div>
      <div className="mt-1.5 text-[13px] text-[#8A7F75]">{message}</div>
    </div>
  );
}
