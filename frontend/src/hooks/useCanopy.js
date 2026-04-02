import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { DEFAULT_NETWORK } from '../config/network.js';
import { INTERVALS } from '../config/constants.js';
import {
  fetchVaultsState,
  getUserPositions,
  getPendingRewards,
  deposit as depositToCanopy,
  withdraw as withdrawFromCanopy,
  claimRewards as claimCanopyRewards,
} from '../services/canopyService.js';

const getWalletAddress = (account) => {
  if (!account?.address) return '';

  const value = typeof account.address === 'string'
    ? account.address
    : account.address.toString();

  const normalized = value.trim().toLowerCase();
  if (!normalized) return '';
  return normalized.startsWith('0x') ? normalized : `0x${normalized}`;
};

export default function useCanopy() {
  const { account, connected, signAndSubmitTransaction } = useWallet();

  const [client] = useState(
    () => new Aptos(new AptosConfig({ network: Network.CUSTOM, fullnode: DEFAULT_NETWORK.rpc }))
  );
  const [vaults, setVaults] = useState([]);
  const [userPositions, setUserPositions] = useState([]);
  const [pendingRewards, setPendingRewards] = useState(null);
  const [totalDeposited, setTotalDeposited] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isDepositing, setIsDepositing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [error, setError] = useState(null);
  const [hasFetchFailed, setHasFetchFailed] = useState(false);

  const walletAddress = getWalletAddress(account);

  const refreshData = useCallback(async () => {
    const shouldLoadWalletData = connected && Boolean(walletAddress);

    setError(null);
    setHasFetchFailed(false);

    try {
      const [vaultState, nextPositions, nextRewards] = await Promise.all([
        fetchVaultsState(client),
        shouldLoadWalletData ? getUserPositions(client, walletAddress) : Promise.resolve([]),
        shouldLoadWalletData
          ? getPendingRewards(client, walletAddress)
          : Promise.resolve({ totalRewards: 0, breakdown: [] }),
      ]);

      const nextVaults = Array.isArray(vaultState?.vaults) ? vaultState.vaults : [];

      setVaults(nextVaults);
      setUserPositions(Array.isArray(nextPositions) ? nextPositions : []);
      setPendingRewards(shouldLoadWalletData ? (nextRewards || { totalRewards: 0, breakdown: [] }) : null);
      setTotalDeposited(
        (Array.isArray(nextPositions) ? nextPositions : []).reduce(
          (sum, position) => sum + Number(position?.currentValue || position?.deposited || 0),
          0
        )
      );

      if (vaultState?.error) {
        setHasFetchFailed(true);
        setError(vaultState.error);
      }
    } catch (refreshError) {
      setVaults([]);
      setUserPositions([]);
      setPendingRewards(shouldLoadWalletData ? { totalRewards: 0, breakdown: [] } : null);
      setTotalDeposited(0);
      setHasFetchFailed(true);
      setError('Canopy vaults temporarily unavailable. Try again later.');
    } finally {
      setIsLoading(false);
    }
  }, [client, connected, walletAddress]);

  const deposit = useCallback(async (vaultId, amount, coinType) => {
    if (!connected || !walletAddress || typeof signAndSubmitTransaction !== 'function') {
      return null;
    }

    setIsDepositing(true);

    try {
      const txHash = await depositToCanopy(
        signAndSubmitTransaction,
        walletAddress,
        vaultId,
        amount,
        coinType
      );

      if (!txHash) {
        return null;
      }

      await refreshData();
      return txHash;
    } catch (depositError) {
      console.error('[useCanopy] Deposit failed', depositError);
      return null;
    } finally {
      setIsDepositing(false);
    }
  }, [connected, walletAddress, signAndSubmitTransaction, refreshData]);

  const withdraw = useCallback(async (vaultId, amount) => {
    if (!connected || !walletAddress || typeof signAndSubmitTransaction !== 'function') {
      return null;
    }

    setIsWithdrawing(true);

    try {
      const txHash = await withdrawFromCanopy(signAndSubmitTransaction, walletAddress, vaultId, amount);

      if (!txHash) {
        return null;
      }

      await refreshData();
      return txHash;
    } catch (withdrawError) {
      console.error('[useCanopy] Withdrawal failed', withdrawError);
      return null;
    } finally {
      setIsWithdrawing(false);
    }
  }, [connected, walletAddress, signAndSubmitTransaction, refreshData]);

  const claimRewards = useCallback(async () => {
    if (!connected || !walletAddress || typeof signAndSubmitTransaction !== 'function') {
      return null;
    }

    setIsClaiming(true);

    try {
      const txHash = await claimCanopyRewards(signAndSubmitTransaction, walletAddress);

      if (!txHash) {
        return null;
      }

      await refreshData();
      return txHash;
    } catch (claimError) {
      console.error('[useCanopy] Claim rewards failed', claimError);
      return null;
    } finally {
      setIsClaiming(false);
    }
  }, [connected, walletAddress, signAndSubmitTransaction, refreshData]);

  useEffect(() => {
    setIsLoading(true);
    refreshData();
  }, [refreshData]);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshData();
    }, INTERVALS.NETWORK_CHECK);

    return () => clearInterval(interval);
  }, [refreshData]);

  return {
    vaults,
    userPositions,
    pendingRewards,
    totalDeposited,
    isLoading,
    isDepositing,
    isWithdrawing,
    isClaiming,
    error,
    hasFetchFailed,
    deposit,
    withdraw,
    claimRewards,
    refreshData,
  };
}