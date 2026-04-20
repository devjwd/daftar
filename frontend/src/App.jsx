import React, { Suspense, lazy, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { AptosWalletAdapterProvider, useWallet } from "@aptos-labs/wallet-adapter-react";

import "./App.css";

import ErrorBoundary from "./components/ErrorBoundary";
import AppErrorView from "./components/AppErrorView";
import LoadingScreen from "./components/LoadingScreen";
import { getEnv } from "./config/envValidator";
import { useIndexerBalances } from "./hooks/useIndexerBalances";
import { applyTheme, getStoredThemePreference } from "./utils/theme";

const Layout = lazy(() => import("./components/Layout"));
const Home = lazy(() => import("./pages/Home"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const SwapPage = lazy(() => import("./pages/Swap"));
const SwapDetails = lazy(() => import("./pages/SwapDetails"));
const Profile = lazy(() => import("./pages/Profile"));
const ProfileView = lazy(() => import("./pages/ProfileView"));
const Settings = lazy(() => import("./pages/Settings"));
const Badges = lazy(() => import("./pages/Badges"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const Admin = lazy(() => import("./pages/Admin"));
const Level = lazy(() => import("./pages/Level"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));

const SWAP_ENABLED = getEnv("VITE_ENABLE_SWAP", true);

const RouteFallback = () => <LoadingScreen />;

const NotFoundPage = () => (
  <AppErrorView
    code="404"
    title="Page Not Found"
    message="The page you requested does not exist or may have moved. Use the button below to get back to DAFTAR."
    onRetry={() => window.location.assign("/")}
  />
);

const WalletRedirect = () => {
  const { address } = useParams();
  return <Navigate to={`/profile/${address}`} replace />;
};

const WalletProviderShell = ({ children }) => {
  const [wallets, setWallets] = useState([]);

  useEffect(() => {
    let cancelled = false;

    const loadWallets = async () => {
      try {
        const [{ PetraWallet }, { OKXWallet }] = await Promise.all([
          import("petra-plugin-wallet-adapter"),
          import("@okwallet/aptos-wallet-adapter"),
        ]);

        if (!cancelled) {
          setWallets([new PetraWallet(), new OKXWallet()]);
        }
      } catch (error) {
        console.error("Failed to load wallet adapters:", error);
      }
    };

    void loadWallets();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AptosWalletAdapterProvider plugins={wallets} autoConnect={true}>
      {children}
    </AptosWalletAdapterProvider>
  );
};

const getDocumentTitle = (pathname) => {
  const path = String(pathname || "").toLowerCase();

  if (path.startsWith("/swap")) return "Daftar | Swap";
  if (path.startsWith("/badges")) return "Daftar | Badges";
  if (path.startsWith("/leaderboard")) return "Daftar | Leaderboard";
  if (path.startsWith("/settings")) return "Daftar | Settings";
  if (path.startsWith("/admin")) return "Daftar | Admin";
  if (path.startsWith("/level")) return "Daftar | Level";
  if (path.startsWith("/terms")) return "Daftar | Terms";
  if (path.startsWith("/privacy")) return "Daftar | Privacy";
  if (path.startsWith("/profile/") && path !== "/profile/") return "Daftar | Portfolio";
  if (path === "/profile") return "Daftar | Profile";

  return "Daftar";
};

const SwapPageWrapper = () => {
  const { account, connected } = useWallet();
  const walletAddress = connected && account
    ? (typeof account.address === "string" ? account.address : account.address?.toString?.())
    : null;
  const { balances, refetch } = useIndexerBalances(walletAddress);

  return <SwapPage balances={balances || []} onSwapSuccess={refetch} />;
};

export default function App() {
  const location = useLocation();

  useEffect(() => {
    const syncTheme = () => {
      const preference = getStoredThemePreference();
      applyTheme(preference);
    };

    syncTheme();

    const onStorage = (event) => {
      if (!event?.key || event.key === "theme" || event.key === "settings_global" || event.key.startsWith("settings_")) {
        syncTheme();
      }
    };

    window.addEventListener("storage", onStorage);

    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onMediaChange = () => {
      if (getStoredThemePreference() === "auto") {
        syncTheme();
      }
    };

    media?.addEventListener?.("change", onMediaChange);

    return () => {
      window.removeEventListener("storage", onStorage);
      media?.removeEventListener?.("change", onMediaChange);
    };
  }, []);

  useEffect(() => {
    document.title = getDocumentTitle(location.pathname);
  }, [location.pathname]);

  return (
    <ErrorBoundary>
      <WalletProviderShell>
        <Routes>
          <Route
            path="/"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Home />
              </Suspense>
            }
          />
          <Route
            path="/*"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Layout>
                  <Routes>
                    <Route path="/wallet/:address" element={<WalletRedirect />} />
                    <Route path="/profile/:address" element={<Dashboard />} />
                    <Route
                      path="/swap"
                      element={SWAP_ENABLED ? <SwapPageWrapper /> : <Navigate to="/" replace />}
                    />
                    <Route
                      path="/swap/details"
                      element={SWAP_ENABLED ? <SwapDetails /> : <Navigate to="/" replace />}
                    />
                    <Route path="/earn" element={<Navigate to="/profile" replace />} />
                    <Route path="/earn/*" element={<Navigate to="/profile" replace />} />
                    <Route path="/badges" element={<Badges />} />
                    <Route path="/leaderboard" element={<Leaderboard />} />
                    <Route path="/profile" element={<Profile />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/admin" element={<Admin />} />
                    <Route path="/more" element={<Navigate to="/settings" replace />} />
                    <Route path="/level" element={<Level />} />
                    <Route path="/terms" element={<Terms />} />
                    <Route path="/privacy" element={<Privacy />} />
                    <Route path="/profile/:address" element={<ProfileView />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </Layout>
              </Suspense>
            }
          />
        </Routes>
      </WalletProviderShell>
    </ErrorBoundary>
  );
}
