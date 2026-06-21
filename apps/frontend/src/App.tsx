import React, { Suspense, lazy, useEffect, useState, ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { AptosWalletAdapterProvider, useWallet } from "@aptos-labs/wallet-adapter-react";
import { PetraWallet } from "petra-plugin-wallet-adapter";
import { OKXWallet } from "@okwallet/aptos-wallet-adapter";

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
const Settings = lazy(() => import("./pages/Settings"));
const Badges = lazy(() => import("./pages/Badges"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const Admin = lazy(() => import("./pages/Admin"));
const Level = lazy(() => import("./pages/Level"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const StandaloneVisualizer = lazy(() => import("./pages/StandaloneVisualizer"));
const Plans = lazy(() => import("./pages/Plans"));
const Verify = lazy(() => import("./pages/Verify"));
const BotLandingPage = lazy(() => import("./pages/BotLandingPage"));
const BotAdminPage = lazy(() => import("./pages/BotAdminPage"));

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

const wallets = [new PetraWallet(), new OKXWallet()];

const WalletProviderShell: React.FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <AptosWalletAdapterProvider plugins={wallets} autoConnect={true}>
      {children}
    </AptosWalletAdapterProvider>
  );
};

const TITLE_MAP: Record<string, string> = {
  "/": "Daftar | Home",
  "/swap": "Daftar | Swap",
  "/badges": "Daftar | Badges",
  "/leaderboard": "Daftar | Leaderboard",
  "/settings": "Daftar | Settings",
  "/admin": "Daftar | Admin",
  "/plans": "Daftar | Plans",
  "/level": "Daftar | Level",
  "/terms": "Daftar | Terms",
  "/privacy": "Daftar | Privacy",
  "/profile": "Daftar | Profile"
};

const getDocumentTitle = (pathname: string): string => {
  const path = String(pathname || "").toLowerCase();
  
  if (TITLE_MAP[path]) return TITLE_MAP[path];
  
  const segments = path.split("/").filter(Boolean);
  if (segments[0] === "profile" && segments[1]) {
    const address = segments[1];
    const shortAddr = address.startsWith("0x") 
      ? `${address.slice(0, 6)}...${address.slice(-4)}` 
      : address;
    
    const tab = segments[2];
    const tabLabel = tab === "trx" ? " - Transactions" 
      : tab === "nfts" ? " - NFTs" 
      : tab === "visualizer" ? " - Visualizer"
      : tab === "analytics" ? " - Analytics" : "";

    return `${shortAddr}${tabLabel} | Daftar`;
  }

  return "Daftar";
};

const SwapPageWrapper = () => {
  const { account, connected } = useWallet();
  const walletAddress = connected && account
    ? (typeof account.address === "string" ? account.address : (account.address as any)?.toString?.())
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

    const onStorage = (event: StorageEvent) => {
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
            path="/verify"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Verify />
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
                    <Route path="/profile/:address/visualizer" element={<StandaloneVisualizer />} />
                    <Route path="/profile/:address/*" element={<Dashboard />} />
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
                    <Route path="/plans" element={<Plans />} />
                    <Route path="/more" element={<Navigate to="/settings" replace />} />
                    <Route path="/level" element={<Level />} />
                    <Route path="/terms" element={<Terms />} />
                    <Route path="/privacy" element={<Privacy />} />
                    <Route path="/bot" element={<BotLandingPage />} />
                    <Route path="/bot/admin" element={<BotAdminPage />} />
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

