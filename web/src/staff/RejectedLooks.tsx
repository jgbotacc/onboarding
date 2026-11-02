import { useEffect, useState } from "react";
import type { StaffClient } from "./api";
import type { RejectedLookRound } from "./types";

interface Props {
  client: StaffClient;
  clientId: string;
  onOpen: (url: string) => void;
}

/** Every look the client did not pick, grouped by round. Hidden when there are none. */
export default function RejectedLooks({ client, clientId, onOpen }: Props) {
  const [rounds, setRounds] = useState<RejectedLookRound[] | null>(null);

  useEffect(() => {
    let alive = true;
    client
      .rejectedLooks(clientId)
      .then((r) => alive && setRounds(r))
      .catch((e: Error) => alive && (console.error(e), setRounds([])));
    return () => {
      alive = false;
    };
  }, [client, clientId]);

  if (!rounds || !rounds.length) return null;

  return (
    <div className="staff-section">
      <h3>Looks the client did not pick</h3>
      {rounds.map((g) => (
        <div key={g.round} className="staff-rejected-round">
          <p className="staff-rejected-title">Round {g.round}</p>
          <div className="staff-imgs">
            {g.options.map((o) => (
              <button type="button" key={o.id} className="staff-img" onClick={() => onOpen(o.url)} aria-label={`Enlarge rejected look ${o.id}`}>
                <img src={o.url} alt={o.alt || `Rejected look ${o.id}`} loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
