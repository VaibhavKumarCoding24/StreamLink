import { jsx as _jsx } from "react/jsx-runtime";
export function GlassCard({ children, className = "" }) {
    return (_jsx("section", { className: `rounded-[24px] border border-white/10 bg-white/5 backdrop-blur-glass shadow-[0_24px_80px_rgba(0,0,0,0.35)] ${className}`, children: children }));
}
