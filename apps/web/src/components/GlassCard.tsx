import { PropsWithChildren } from "react";

type GlassCardProps = PropsWithChildren<{
  className?: string;
}>;

export function GlassCard({ children, className = "" }: GlassCardProps) {
  return (
    <section
      className={`rounded-[24px] border border-white/10 bg-white/5 backdrop-blur-glass shadow-[0_24px_80px_rgba(0,0,0,0.35)] ${className}`}
    >
      {children}
    </section>
  );
}