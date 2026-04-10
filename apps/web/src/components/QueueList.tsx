import type { Track } from "@streamlink/shared";

type Props = {
  queue: Track[];
  currentTrackId?: string;
};

export function QueueList({ queue, currentTrackId }: Props) {
  return (
    <div className="space-y-3">
      {queue.map((track, index) => (
        <div
          key={track.id}
          className={`rounded-[20px] border px-4 py-3 ${track.id === currentTrackId ? "border-accent/40 bg-accent/10" : "border-white/10 bg-white/5"}`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm uppercase tracking-[0.2em] text-[#f6c28b]">{String(index + 1).padStart(2, "0")}</div>
              <div className="mt-1 text-lg font-medium text-ember">{track.title}</div>
              <div className="text-sm text-[#f6c28b]">{track.artist}</div>
            </div>
            <div className="text-sm text-[#f6c28b]">{Math.floor(track.durationMs / 1000)}s</div>
          </div>
        </div>
      ))}
    </div>
  );
}