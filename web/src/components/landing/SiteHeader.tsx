"use client";

/**
 * Fixed site header.
 *
 * It has to stay put: every section is a full screen, so the nav is the way
 * you move between them. Transparent while the hero is in view, then it picks
 * up a backdrop so it stays readable over content, and it marks whichever
 * section currently owns the middle of the viewport.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

const LINKS = [
  { id: "relay", label: "Relay" },
  { id: "agents", label: "Agents" },
  { id: "fit", label: "Use cases" },
];

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const sections = LINKS.map((link) =>
      document.getElementById(link.id),
    ).filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    // Fires when a section crosses the middle band of the viewport.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(entry.target.id);
          } else {
            setActive((current) =>
              current === entry.target.id ? null : current,
            );
          }
        }
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled
          ? "border-b border-white/[0.06] bg-[#060607]/85 backdrop-blur-md"
          : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto grid max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 py-5">
        <Link
          href="/"
          className="justify-self-start text-lg font-bold tracking-tight text-white [text-shadow:0_0_24px_rgba(255,255,255,0.45)]"
        >
          BATON
        </Link>

        <nav className="hidden items-center gap-8 justify-self-center text-sm md:flex">
          {LINKS.map((link) => (
            <a
              key={link.id}
              href={`#${link.id}`}
              className={`transition-colors ${
                active === link.id
                  ? "text-white"
                  : "text-white/45 hover:text-white"
              }`}
            >
              {link.label}
            </a>
          ))}
          <a
            href="https://github.com/EndPx/baton"
            target="_blank"
            rel="noreferrer"
            className="text-white/45 transition-colors hover:text-white"
          >
            Source
          </a>
        </nav>

        <Link
          href="/studio"
          className="justify-self-end rounded-lg border border-white/25 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white hover:text-black"
        >
          Open Studio
        </Link>
      </div>
    </header>
  );
}
