import { useEffect } from 'react';
import type { OwnerOnboardingData } from '../../hooks/useOwnerOnboardingState';
import { eyebrow, h1, sub, tile, tileTitle, tileSub, stepBtn } from '../stepStyles';
import { describeDeposit, resolveDepositAmount, validateDeposit } from '../../depositPolicy';

interface DetailsStepProps {
  data: OwnerOnboardingData;
  setD: (patch: Partial<OwnerOnboardingData>) => void;
}

const choiceBtn = (active: boolean) =>
  `rounded-xl border-[1.5px] px-4 py-2.5 font-display text-sm font-bold transition-all ${
    active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card/95 text-foreground/80'
  }`;

const amountInput =
  'w-24 border-0 border-b-2 border-border bg-transparent px-0.5 py-1 text-right font-display text-lg font-bold text-foreground placeholder:font-normal placeholder:text-muted-foreground focus:border-primary focus:outline-none';

export function DetailsStep({ data, setD }: DetailsStepProps) {
  const takesDeposit = data.depositMode !== 'NONE';
  const depositState = {
    takesDeposit,
    mode: data.depositMode === 'FLAT' ? ('FLAT' as const) : ('MONTHS' as const),
    months: data.depositMonths,
    flatAmount: data.deposit,
  };

  const depositError = validateDeposit(depositState, data.monthlyRent);
  const depositSummary = describeDeposit(depositState, data.monthlyRent);

  // `deposit` is what the backend stores, so keep it in step with the answer
  // above it — otherwise "2 months" would publish whatever number happened to
  // be left in the field from an earlier choice.
  const resolved = resolveDepositAmount(depositState, data.monthlyRent);
  useEffect(() => {
    if (data.depositMode === 'MONTHS' && String(resolved) !== data.deposit) {
      setD({ deposit: String(resolved) });
    }
    if (data.depositMode === 'NONE' && data.deposit !== '0') {
      setD({ deposit: '0' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.depositMode, data.depositMonths, data.monthlyRent, resolved]);

  return (
    <div>
      <div className={eyebrow}>SHAPE THE STRUCTURE</div>
      <h1 className={h1}>A few property details.</h1>
      <p className={sub}>Capacity, meals and money. You&apos;ll lay out floors and rooms next.</p>
      <div className="flex w-full max-w-[460px] flex-col gap-3.5">
        <div className={tile}>
          <div>
            <div className={tileTitle}>Approx. capacity</div>
            <div className={tileSub}>Total beds</div>
          </div>
          <div className="flex items-center gap-3.5">
            <button type="button" onClick={() => setD({ capacity: Math.max(0, data.capacity - 4) })} className={stepBtn}>
              −
            </button>
            <span className="min-w-[64px] text-center font-display text-xl font-extrabold">{data.capacity}</span>
            <button type="button" onClick={() => setD({ capacity: data.capacity + 4 })} className={stepBtn}>
              +
            </button>
          </div>
        </div>

        <div className={tile}>
          <div className={tileTitle}>Food available?</div>
          <div className="flex gap-2">
            {(['Yes', 'No'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setD({ food: v })} className={choiceBtn(data.food === v)}>
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Rent comes before the deposit: a deposit expressed in months has
            nothing to multiply until the rent is known. */}
        <div className={tile}>
          <div>
            <div className={tileTitle}>Starting monthly rent</div>
            <div className={tileSub}>Applied to every room — change any room later</div>
          </div>
          <div className="flex items-center gap-1 font-display text-lg font-bold text-foreground">
            ₹
            <input
              value={data.monthlyRent}
              onChange={(e) => setD({ monthlyRent: e.target.value.replace(/[^0-9]/g, '') })}
              inputMode="numeric"
              placeholder="6500"
              className={amountInput}
            />
          </div>
        </div>

        {/* Ask whether there is a deposit at all before asking how much — the
            old single field forced an amount on owners who take none, and
            could not express "two months' rent", which is the common norm. */}
        <div className="rounded-[16px] border-[1.5px] border-border bg-card/95 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className={tileTitle}>Do you take a security deposit?</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setD({ depositMode: data.depositMode === 'FLAT' ? 'FLAT' : 'MONTHS' })}
                className={choiceBtn(takesDeposit)}
              >
                Yes
              </button>
              <button type="button" onClick={() => setD({ depositMode: 'NONE' })} className={choiceBtn(!takesDeposit)}>
                No
              </button>
            </div>
          </div>

          {takesDeposit && (
            <div className="mt-4 border-t border-border/70 pt-4">
              <div className="mb-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setD({ depositMode: 'MONTHS' })}
                  className={`flex-1 ${choiceBtn(data.depositMode === 'MONTHS')}`}
                >
                  Months of rent
                </button>
                <button
                  type="button"
                  onClick={() => setD({ depositMode: 'FLAT' })}
                  className={`flex-1 ${choiceBtn(data.depositMode === 'FLAT')}`}
                >
                  Flat amount
                </button>
              </div>

              {data.depositMode === 'MONTHS' ? (
                <div className="flex items-center justify-between gap-3">
                  <span className={tileSub}>How many months?</span>
                  <div className="flex items-center gap-3.5">
                    <button
                      type="button"
                      onClick={() =>
                        setD({ depositMonths: String(Math.max(1, (Number(data.depositMonths) || 1) - 1)) })
                      }
                      className={stepBtn}
                    >
                      −
                    </button>
                    <span className="min-w-[40px] text-center font-display text-xl font-extrabold">
                      {data.depositMonths || '0'}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setD({ depositMonths: String(Math.min(12, (Number(data.depositMonths) || 0) + 1)) })
                      }
                      className={stepBtn}
                    >
                      +
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span className={tileSub}>Deposit amount</span>
                  <div className="flex items-center gap-1 font-display text-lg font-bold text-foreground">
                    ₹
                    <input
                      value={data.deposit}
                      onChange={(e) => setD({ deposit: e.target.value.replace(/[^0-9]/g, '') })}
                      inputMode="numeric"
                      placeholder="10000"
                      className={amountInput}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Echo the real rupee figure back, so "2 months" is never a surprise. */}
          {(depositSummary || depositError) && (
            <p
              className={`mt-3 text-[12.5px] font-semibold ${
                depositError ? 'text-muted-foreground' : 'text-success'
              }`}
            >
              {depositError ?? depositSummary}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
