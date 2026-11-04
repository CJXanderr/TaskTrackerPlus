import React from "react";
import { House, ListTodo } from "lucide-react";
import { ProfilesProvider } from "./state/ProfilesContext";
import { AppStateProvider } from "./state/AppState";
import { ToastProvider } from "./state/Toasts";
import { Link, useRoute } from "./lib/router";
import { Dashboard } from "./views/Dashboard";
import { MyTasksView } from "./views/MyTasks";
import { ArchivedProjects } from "./views/ArchivedProjects";
import { TagsPage } from "./views/TagsPage";
import { ProjectBoard } from "./views/ProjectBoard";
import { TaskDetailView } from "./views/TaskDetail";
import "./styles/app.css";

const AppLogo: React.FC = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="1" y="1" width="22" height="22" rx="6" fill="#F26B21" />
    <rect x="5.5" y="6" width="4" height="4" rx="1" fill="none" stroke="#fff" strokeWidth="1.6" />
    <path d="M5.8 15.6l1.4 1.4 2.4-2.6" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 8h6.5M12 15.8h6.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const Header: React.FC = () => {
  const route = useRoute();
  const tab = route.name === "myTasks" ? "myTasks" : route.name === "home" ? "home" : "";
  return (
    <header className="app-header">
      <Link to={{ name: "home" }} className="brand">
        <AppLogo />
        <span>Task Tracker+</span>
      </Link>
      <nav className="app-nav">
        <Link to={{ name: "home" }} className={`nav-tab ${tab === "home" ? "active" : ""}`}>
          <House size={15} />
          <span>Home</span>
        </Link>
        <Link to={{ name: "myTasks" }} className={`nav-tab ${tab === "myTasks" ? "active" : ""}`}>
          <ListTodo size={15} />
          <span>My tasks</span>
        </Link>
      </nav>
    </header>
  );
};

const Routes: React.FC = () => {
  const route = useRoute();
  switch (route.name) {
    case "myTasks":
      return <MyTasksView />;
    case "archived":
      return <ArchivedProjects />;
    case "tags":
      return <TagsPage />;
    case "project":
      return <ProjectBoard key={route.projectId} projectId={route.projectId} />;
    case "task":
      return <TaskDetailView key={route.taskId} projectId={route.projectId} taskId={route.taskId} />;
    case "home":
    default:
      return <Dashboard />;
  }
};

const App: React.FC = () => (
  <ToastProvider>
    <ProfilesProvider>
      <AppStateProvider>
        <div className="app">
          <Header />
          <main className="app-main">
            <Routes />
          </main>
        </div>
      </AppStateProvider>
    </ProfilesProvider>
  </ToastProvider>
);

export default App;
