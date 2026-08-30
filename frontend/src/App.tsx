import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAppStore } from "./store/useAppStore";
import Shell from "./components/Shell";
import RecoveryOverlay from "./components/RecoveryOverlay";
import DevPage from "./pages/DevPage";
import HomePage from "./pages/HomePage";
import ProtectionPage from "./pages/ProtectionPage";
import WalletPage from "./pages/WalletPage";
import ActivityPage from "./pages/ActivityPage";
import ActivityDetailPage from "./pages/ActivityDetailPage";
import ProfilePage from "./pages/ProfilePage";

export default function App() {
  const incident = useAppStore((s) => s.incident);
  const overlayDismissed = useAppStore((s) => s.overlayDismissed);
  const location = useLocation();

  const overlay = incident && !overlayDismissed && <RecoveryOverlay incident={incident} />;

  // dev simulator lives outside the main shell
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
          <Route path="/protection" element={<ProtectionPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/activity/:id" element={<ActivityDetailPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </Shell>
      {overlay}
    </>
  );
}
