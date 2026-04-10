import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const actionClass = "rounded-full border border-white/10 bg-white/8 px-5 py-3 text-sm font-medium text-ember transition hover:border-accent/40 hover:bg-accent/10 hover:text-accent";
export function PlayerControls({ state, onCommand }) {
    return (_jsxs("div", { className: "mt-8 flex flex-wrap items-center gap-3", children: [_jsx("button", { className: actionClass, onClick: () => onCommand({ type: "PREVIOUS" }), children: "Previous" }), _jsx("button", { className: actionClass, onClick: () => onCommand({ type: state.isPlaying ? "PAUSE" : "PLAY" }), children: state.isPlaying ? "Pause" : "Play" }), _jsx("button", { className: actionClass, onClick: () => onCommand({ type: "NEXT" }), children: "Next" }), _jsx("input", { className: "h-2 w-36 accent-[#00FFC6]", type: "range", min: 0, max: 1, step: 0.01, value: state.volume, onChange: (event) => onCommand({ type: "VOLUME_CHANGE", volume: Number(event.target.value) }) })] }));
}
