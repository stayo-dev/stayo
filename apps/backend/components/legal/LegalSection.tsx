import type { LegalSection as LegalSectionType } from "@/content/legal"

interface Props {
  section: LegalSectionType
}

export default function LegalSection({ section }: Props) {
  return (
    <section
      id={section.id}
      aria-labelledby={`${section.id}-heading`}
      className="scroll-mt-[72px]"
    >
      {/* Section Header */}
      <div className="pb-6 mb-8 border-b-2 border-indigo-600">
        <h2
          id={`${section.id}-heading`}
          className="text-2xl sm:text-3xl font-bold text-slate-900"
        >
          {section.title}
        </h2>
        {section.subtitle && (
          <p className="mt-2 text-slate-500 text-base">{section.subtitle}</p>
        )}
        {section.lastUpdated && (
          <p className="mt-2 text-xs font-medium text-slate-400 uppercase tracking-wider">
            Last updated: {section.lastUpdated}
          </p>
        )}
      </div>

      {/* Content Blocks */}
      <div className="space-y-4">
        {section.content.map((block, index) => {
          switch (block.type) {
            case "subheading":
              return (
                <h3
                  key={index}
                  className="text-base font-semibold text-slate-800 pt-4 pb-1"
                >
                  {block.text}
                </h3>
              )

            case "notice":
              return (
                <div
                  key={index}
                  role="note"
                  className="bg-amber-50 border border-amber-200 rounded-lg px-5 py-4"
                >
                  <p className="text-sm font-semibold text-amber-900 leading-relaxed">
                    {block.text}
                  </p>
                </div>
              )

            case "contact_list":
              return (
                <div
                  key={index}
                  className="mt-2 rounded-xl border border-slate-200 overflow-hidden"
                >
                  {block.items.map((item, i) => (
                    <div
                      key={i}
                      className={`flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-5 py-3.5 ${
                        i % 2 === 0 ? "bg-slate-50" : "bg-white"
                      }`}
                    >
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-28 shrink-0">
                        {item.label}
                      </span>
                      <span className="text-slate-800 font-medium">{item.value}</span>
                    </div>
                  ))}
                </div>
              )

            case "paragraph":
            default:
              return (
                <p key={index} className="text-slate-600 leading-7 text-[0.9375rem]">
                  {block.text}
                </p>
              )
          }
        })}
      </div>
    </section>
  )
}
