import React, { useEffect, useState } from "react";

export default function NoSolutionTimer({
  timer,
  onSkip,
  currentPlayerId,
  originName,
}) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!timer) return;
    const tick = () => {
      const ms = Math.max(0, (timer.expiresAt || 0) - Date.now());
      setRemaining(Math.ceil(ms / 1000));
    };
    tick();
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
  }, [timer]);

  if (!timer) return null;

  const isOrigin =
    currentPlayerId && currentPlayerId === timer.originPlayerId;
  const isReveal = timer.type === "reveal";
  const isNoSolution = timer.type === "no_solution" || !isReveal;

  // Votes are only relevant for no-solution flow
  const hasVoted =
    isNoSolution &&
    Array.isArray(timer.votes) &&
    timer.votes.includes(currentPlayerId);

  const labelName = originName || timer.originPlayerId;

  return (
    <div
      className="no-solution-timer position-absolute p-2"
      style={{
        left: "50%",
        transform: "translateX(-50%)",
        top: 16,
        background: "rgba(255,255,255,0.95)",
        borderRadius: 6,
        zIndex: 2000,
      }}
    >
      <div>
        {isReveal
          ? `Reveal phase – using ${labelName}'s cards`
          : `No-solution declared by ${labelName}`}
      </div>
      <div>Time remaining: {remaining}s</div>

      <div className="mt-2">
        {isReveal ? (
          // REVEAL MODE:
          // Only the origin player gets a "Give up" button.
          isOrigin ? (
            <button
              className="btn btn-sm btn-outline-danger"
              onClick={() =>
                onSkip && onSkip(timer.originPlayerId, "reveal")
              }
            >
              Give up
            </button>
          ) : (
            // Other players: no Skip button in reveal phase
            <div className="text-muted">Try to solve it!</div>
          )
        ) : (
          // NO-SOLUTION MODE:
          // Non-origin players can vote Skip; origin never sees Skip.
          !isOrigin &&
          (hasVoted ? (
            <div className="text-muted">Voted to skip</div>
          ) : (
            <button
              className="btn btn-sm btn-outline-primary"
              onClick={() =>
                onSkip && onSkip(timer.originPlayerId, "no_solution")
              }
            >
              Skip
            </button>
          ))
        )}
      </div>
    </div>
  );
}
