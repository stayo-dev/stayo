import { useSpecialMealCount } from '../hooks/useSpecialMeals';
import { cookLine, occasionTitle, type SpecialOccasion } from '../specialMeals';

/** One line on the kitchen sheet for a special meal served today or tomorrow. */
export function SpecialMealKitchenLine({ hostelId, occasion }: { hostelId: string; occasion: SpecialOccasion }) {
  const { data } = useSpecialMealCount(hostelId, occasion.id);
  if (!data) return null;
  const [nonVeg, veg] = cookLine(data.count);
  return (
    <p className="rounded-xl bg-muted px-4 py-3 text-[15px] font-bold">
      {occasionTitle(occasion)} special: {nonVeg.value} non-veg · {veg.value} veg
    </p>
  );
}
