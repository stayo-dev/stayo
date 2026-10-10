import { useSpecialMealCount } from '../hooks/useSpecialMeals';
import { cookLine, occasionTitle, type SpecialOccasion } from '../specialMeals';
import { SpecialMealReadyPanel } from './SpecialMealReadyPanel';

/**
 * One block on the kitchen sheet for a special meal served today or tomorrow:
 * the cook numbers and, on the day, the cook's "food's ready" bell, because
 * the cook is the one who knows the biryani is done.
 */
export function SpecialMealKitchenLine({ hostelId, occasion }: { hostelId: string; occasion: SpecialOccasion }) {
  const { data, sendReady, isSendingReady } = useSpecialMealCount(hostelId, occasion.id);
  if (!data) return null;
  const [nonVeg, veg] = cookLine(data.count);
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted px-4 py-3">
      <p className="text-[15px] font-bold">
        {occasionTitle(occasion)} special: {nonVeg.value} non-veg · {veg.value} veg
      </p>
      <SpecialMealReadyPanel data={data} onSend={sendReady} isSending={isSendingReady} large />
    </div>
  );
}
