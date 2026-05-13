import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

export function useAddressLabel(address: string | null) {
  const [label, setLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!address) {
      setLabel(null);
      return;
    }

    let isMounted = true;
    setLoading(true);

    const fetchLabel = async () => {
      try {
        const { data, error } = await supabase
          .from('address_labels')
          .select('label_name')
          .eq('address', address)
          .single();

        if (error) {
          if (error.code !== 'PGRST116') {
            // PGRST116 is "No rows found"
            console.error('Failed to fetch address label:', error);
          }
          if (isMounted) setLabel(null);
        } else if (data && isMounted) {
          setLabel(data.label_name);
        }
      } catch (err) {
        console.error('Error fetching address label:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchLabel();

    return () => {
      isMounted = false;
    };
  }, [address]);

  return { label, loading };
}
