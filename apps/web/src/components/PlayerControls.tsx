import type { PlaybackState, PlaybackCommand } from "@streamlink/shared";

type Props = {
  state: PlaybackState;
  onCommand: (command: Partial<PlaybackCommand>, emitSync?: boolean) => void;
};

const actionClass =
  "rounded-full border border-white/10 bg-white/8 px-5 py-3 text-sm font-medium text-ember transition hover:border-accent/40 hover:bg-accent/10 hover:text-accent";

export function PlayerControls({ state, onCommand }: Props) {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-3">
      <button className={actionClass} onClick={() => onCommand({ type: "PREVIOUS" })}>Previous</button>
      <button className={actionClass} onClick={() => onCommand({ type: state.isPlaying ? "PAUSE" : "PLAY" })}>
        {state.isPlaying ? "Pause" : "Play"}
      </button>
      <button className={actionClass} onClick={() => onCommand({ type: "NEXT" })}>Next</button>
      <input
        className="h-2 w-36 accent-[#00FFC6]"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={state.volume}
        onChange={(event) => onCommand({ type: "VOLUME_CHANGE", volume: Number(event.target.value) })}
      />
    </div>
  );
}