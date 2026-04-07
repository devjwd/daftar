import React, { Suspense, lazy, useEffect, useState } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { AptosWalletAdapterProvider, useWallet } from "@aptos-labs/wallet-adapter-react";

import "./App.css";

import ErrorBoundary from "./components/ErrorBoundary";
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
const More = lazy(() => import("./pages/More"));
const Level = lazy(() => import("./pages/Level"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));

const SWAP_ENABLED = getEnv("VITE_ENABLE_SWAP", true);

const RouteFallback = () => <LoadingScreen />;

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

const SwapPageWrapper = () => {
  const { account, connected } = useWallet();
  const walletAddress = connected && account
    ? (typeof account.address === "string" ? account.address : account.address?.toString?.())
    : null;
  const { balances, refetch } = useIndexerBalances(walletAddress);

  return <SwapPage balances={balances || []} onSwapSuccess={refetch} />;
};

export default function App() {
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
                    <Route path="/more" element={<More />} />
                    <Route path="/level" element={<Level />} />
                    <Route path="/terms" element={<Terms />} />
                    <Route path="/privacy" element={<Privacy />} />
                    <Route path="/profile/:address" element={<ProfileView />} />
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
