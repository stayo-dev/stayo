/** The building's shape while it loads: a roof, three floors of pulsing rooms, the ground. */
export function BuildingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your hostel" className="animate-pulse motion-reduce:animate-none">
      <div className="mx-3 h-8 bg-accent [clip-path:polygon(7%_0,93%_0,100%_100%,0_100%)]" />
      <div className="border-x border-accent bg-card/70">
        {[0, 1, 2].map((floor) => (
          <div key={floor} className={`flex gap-[6px] px-[6px] py-2 ${floor ? 'border-t-[3px] border-accent' : ''}`}>
            <div className="h-[30px] w-[30px] flex-none rounded-[9px] bg-accent" />
            <div className="grid flex-1 grid-cols-4 gap-[5px] pt-4">
              {[0, 1, 2, 3].map((room) => (
                <div key={room} className="h-[66px] rounded-[11px] bg-accent/70" />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="h-3.5 bg-accent" />
    </div>
  );
}
