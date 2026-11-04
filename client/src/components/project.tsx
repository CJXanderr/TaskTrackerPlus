import React, { useEffect, useState } from "react";
import { rootClient, ImageUriResolution } from "@rootsdk/client-app";
import { AccessLevel, PhaseCounts } from "@tasktrackerplus/gen-shared";
import { Eye, Folder, ListChecks, ShieldCheck } from "lucide-react";
import { ACCESS_LABEL, PHASES, totalCount } from "../lib/phases";

export const ProjectAvatar: React.FC<{ imageUri: string; size?: number }> = ({ imageUri, size = 36 }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [imageUri]);
  if (imageUri && !failed) {
    return (
      <img
        className="project-avatar"
        style={{ width: size, height: size }}
        src={rootClient.assets.toImageUrl(imageUri, size > 48 ? ImageUriResolution.Medium : ImageUriResolution.Small)}
        alt=""
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="project-avatar project-avatar-icon" style={{ width: size, height: size }}>
      <Folder size={Math.round(size * 0.5)} />
    </span>
  );
};

// Segmented bar showing how a project's tasks spread across phases.
export const PhaseBar: React.FC<{ counts: PhaseCounts | undefined; showLegend?: boolean }> = ({ counts, showLegend }) => {
  const total = totalCount(counts);
  const title = PHASES.map((p) => `${p.label}: ${counts ? counts[p.countKey] : 0}`).join(" · ");
  return (
    <div className="phase-bar-wrap">
      <div className="phase-bar" title={title} aria-label={title} role="img">
        {total === 0 ? (
          <span className="phase-seg phase-empty" style={{ flexGrow: 1 }} />
        ) : (
          PHASES.map((p) => {
            const n = counts ? counts[p.countKey] : 0;
            return n > 0 ? (
              <span key={p.status} className="phase-seg" style={{ flexGrow: n, background: p.color }} />
            ) : null;
          })
        )}
      </div>
      {showLegend && (
        <div className="phase-legend">
          {PHASES.map((p) => (
            <span key={p.status} className="phase-legend-item">
              <span className="tag-dot" style={{ background: p.color }} />
              {p.label} <strong>{counts ? counts[p.countKey] : 0}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export const AccessChip: React.FC<{ access: AccessLevel }> = ({ access }) => {
  const icon =
    access === AccessLevel.MANAGE ? <ShieldCheck size={13} /> : access === AccessLevel.CONTRIBUTE ? <ListChecks size={13} /> : <Eye size={13} />;
  const cls = access === AccessLevel.MANAGE ? "manage" : access === AccessLevel.CONTRIBUTE ? "contribute" : "view";
  return (
    <span className={`access-chip access-${cls}`}>
      {icon}
      <span>{ACCESS_LABEL[access]}</span>
    </span>
  );
};
