import React from "react";
import { ArrowRight, CircleCheckBig } from "lucide-react";
import { useAppState } from "../state/AppState";
import { useProfile } from "../components/people";
import { greeting } from "../lib/format";
import { Link } from "../lib/router";
import { Spinner } from "../components/ui";
import { MyTaskRow, useMyTasks } from "./MyTasks";
import { ProjectsSection } from "./ProjectsSection";

const PREVIEW = 5;

const AssignedPanel: React.FC = () => {
  const q = useMyTasks();
  const tasks = q.data ?? [];
  return (
    <section className="panel assigned-panel">
      <div className="panel-head">
        <h2 className="section-title">Assigned to you</h2>
        {tasks.length > 0 && (
          <Link to={{ name: "myTasks" }} className="link-quiet">
            {tasks.length > PREVIEW ? `View all ${tasks.length}` : "My tasks"}
            <ArrowRight size={14} />
          </Link>
        )}
      </div>
      {q.loading ? (
        <Spinner />
      ) : tasks.length === 0 ? (
        <div className="assigned-empty">
          <CircleCheckBig size={18} />
          <span>Nothing assigned to you right now.</span>
        </div>
      ) : (
        <div className="list-panel">
          {tasks.slice(0, PREVIEW).map((t) => (
            <MyTaskRow key={t.id} task={t} />
          ))}
        </div>
      )}
    </section>
  );
};

export const Dashboard: React.FC = () => {
  const { me } = useAppState();
  const profile = useProfile(me.userId || undefined);
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">
            {greeting()}
            {profile?.nickname ? `, ${profile.nickname}` : ""}
          </h1>
          <p className="page-subtitle">{today}</p>
        </div>
      </div>
      <AssignedPanel />
      <ProjectsSection archived={false} />
    </div>
  );
};
