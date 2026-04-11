import { useEffect, useState } from 'react';
import { DEFAULT_NETWORK } from '../config/network';

let movementSdkPromise = null;

const loadMovementSdk = async () => {
  if (!movementSdkPromise) {
    movementSdkPromise = import('@aptos-labs/ts-sdk');
  }

  return movementSdkPromise;
};

export const createMovementClient = async (fullnode = DEFAULT_NETWORK.rpc) => {
  const { Aptos, AptosConfig, Network } = await loadMovementSdk();
  return new Aptos(new AptosConfig({
    network: Network.CUSTOM,
    fullnode,
  }));
};

export const useMovementClient = (fullnode = DEFAULT_NETWORK.rpc) => {
  const [client, setClient] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    createMovementClient(fullnode)
      .then((nextClient) => {
        if (!active) return;
        setClient(nextClient);
        setError(null);
      })
      .catch((nextError) => {
        if (!active) return;
        setClient(null);
        setError(nextError instanceof Error ? nextError : new Error('Failed to load Movement client'));
      });

    return () => {
      active = false;
    };
  }, [fullnode]);

  return { client, loading: client == null && error == null, error };
};