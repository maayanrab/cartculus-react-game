import React, { useEffect, useState } from "react";

export default function NoSolutionTimer({ timer, onSkip, currentPlayerId, originName }) {
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
  const isOrigin = currentPlayerId && currentPlayerId === timer.originPlayerId;
  return (
    <div className="no-solution-timer position-absolute p-2" style={{ left: '50%', transform: 'translateX(-50%)', top: 16, background: 'rgba(255,255,255,0.95)', borderRadius: 6, zIndex: 2000 }}>
      <div>{timer.type === 'reveal' ? 'Reveal' : 'No-solution'} declared by {originName || timer.originPlayerId}</div>
      <div>Time remaining: {remaining}s</div>
      <div className="mt-2">
        {!isOrigin && (
          <button className="btn btn-sm btn-outline-primary" onClick={() => onSkip && onSkip(timer.originPlayerId)}>Skip</button>
        )}
      </div>
    </div>
  );
}
