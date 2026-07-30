"use client"

import { useEffect, useState } from "react"

interface NavItem {
  id: string
  title: string
}

interface LegalNavProps {
  sections: NavItem[]
}

export default function LegalNav({ sections }: LegalNavProps) {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? "")
  const [elevated, setElevated] = useState(false)

  useEffect(() => {
    const onScroll = () => {
      const nextElevated = window.scrollY > 100
      setElevated((prev) => (prev === nextElevated ? prev : nextElevated))
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    const syncFromHash = () => {
      const hash = window.location.hash.slice(1)
      if (!hash) return
      if (sections.some((section) => section.id === hash)) {
        setActiveId((prev) => (prev === hash ? prev : hash))
      }
    }

    syncFromHash()
    window.addEventListener("hashchange", syncFromHash)
    return () => window.removeEventListener("hashchange", syncFromHash)
  }, [sections])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting)
        if (visible.length === 0) return

        const nearest = visible.reduce((closest, entry) => {
          return Math.abs(entry.boundingClientRect.top) <
            Math.abs(closest.boundingClientRect.top)
            ? entry
            : closest
        })

        const nextId = nearest.target.id
        setActiveId((prev) => (prev === nextId ? prev : nextId))
      },
      { rootMargin: "-72px 0px -70% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] }
    )

    sections.forEach(({ id }) => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [sections])

  const handleClick = (id: string) => {
    setActiveId((prev) => (prev === id ? prev : id))
  }

  return (
    <nav
      aria-label="Legal sections navigation"
      className={`sticky top-0 z-40 bg-white border-b border-slate-200 transition-shadow duration-200 ${
        elevated ? "shadow-sm" : ""
      }`}
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <ul
          role="list"
          className="flex overflow-x-auto"
          style={{ scrollbarWidth: "none" }}
        >
          {sections.map(({ id, title }) => {
            const isActive = activeId === id
            return (
              <li key={id} role="listitem">
                <a
                  href={`#${id}`}
                  onClick={() => handleClick(id)}
                  aria-current={isActive ? "location" : undefined}
                  className={`
                    relative flex items-center py-4 px-5 text-sm font-medium whitespace-nowrap
                    transition-colors duration-150 border-b-2 focus-visible:outline-none
                    focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset
                    ${
                      isActive
                        ? "border-indigo-600 text-indigo-600"
                        : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
                    }
                  `}
                >
                  {title}
                </a>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
