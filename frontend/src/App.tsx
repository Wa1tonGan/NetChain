import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAppStore } from "./store/useAppStore";
import Shell from "./components/Shell";
import RecoveryOverlay from "./components/RecoveryOverlay";
import DevPage from "./pages/DevPage";
import HomePage from "./pages/HomePage";
import ServicesPage from "./pages/ServicesPage";
import ActivityPage from "./pages/ActivityPage";
import ActivityDetailPage from "./pages/ActivityDetailPage";
import ProfilePage from "./pages/ProfilePage";
import LoginPage from "./pages/LoginPage";

export default function App() {
  const incident = useAppStore((s) => s.incident);
  const overlayDismissed = useAppStore((s) => s.overlayDismissed);
  const location = useLocation();

  useEffect(() => {
    useAppStore.getState().startConnectivityWatcher();
  }, []);

  const overlay = incident && !overlayDismissed && <RecoveryOverlay incident={incident} />;

  // Dev simulator lives outside the main shell
  if (location.pathname === "/dev") {
    return (
      <>
        <DevPage />
        {overlay}
      </>
    );
  }

  return (
    <>
      <Shell>
        <Routes>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/services" element={<ServicesPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/activity/:id" element={<ActivityDetailPage />} />
          <Route path="/wallet" element={<Navigate to="/profile" replace />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </Shell>
      {overlay}
    </>
  );
}
