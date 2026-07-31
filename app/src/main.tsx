import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StudioProvider, useStudio } from "./store";
import { Sidebar, Topbar, NowPlaying } from "./components/Chrome";
import { Home } from "./pages/Home";
import { Designer } from "./pages/Designer";
import { Import } from "./pages/Import";
import { Batch } from "./pages/Batch";
import { Settings } from "./pages/Settings";
import "./theme.css";

function App() {
  const { page } = useStudio();
  return (
    <div className="studio">
      <Sidebar />
      <main className="studio-main">
        <Topbar />
        <div className="studio-content">
          {page === "home" && <Home />}
          {page === "designer" && <Designer />}
          {page === "import" && <Import />}
          {page === "batch" && <Batch />}
          {page === "settings" && <Settings />}
        </div>
      </main>
      <NowPlaying />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StudioProvider>
      <App />
    </StudioProvider>
  </StrictMode>
);
