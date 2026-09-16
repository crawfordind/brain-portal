"use client";

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

interface InboxCounts {
  recommendations: number;
  insights: number;
  captures: number;
  total: number;
}

async function fetchInboxCounts(): Promise<InboxCounts> {
  try {
    // Fetch all three counts in parallel
    const [recommendationsRes, insightsRes, capturesRes] = await Promise.all([
      fetch('/api/tasks/recommendations?status=pending&limit=1'),
      fetch('/api/insights?status=new&limit=1'),
      fetch('/api/captures?processed=false&limit=1'),
    ]);

    const [recommendationsData, insightsData, capturesData] = await Promise.all([
      recommendationsRes.ok ? recommendationsRes.json() : { count: 0 },
      insightsRes.ok ? insightsRes.json() : { insights: [] },
      capturesRes.ok ? capturesRes.json() : { captures: [] },
    ]);

    const counts = {
      recommendations: recommendationsData.count || 0,
      insights: insightsData.insights?.length || 0,
      captures: capturesData.captures?.length || 0,
    };

    return {
      ...counts,
      total: counts.recommendations + counts.insights + counts.captures,
    };
  } catch (error) {
    console.error('Error fetching inbox counts:', error);
    return {
      recommendations: 0,
      insights: 0,
      captures: 0,
      total: 0,
    };
  }
}

export function useInboxCount() {
  const [isMounted, setIsMounted] = useState(false);

  // Prevent query from running during SSR/hydration
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const query = useQuery({
    queryKey: ['inbox-count'],
    queryFn: fetchInboxCounts,
    staleTime: 1000 * 60, // 1 minute
    refetchInterval: 1000 * 60 * 5, // Refetch every 5 minutes
    refetchIntervalInBackground: false,
    enabled: isMounted,
  });

  return {
    counts: query.data || { recommendations: 0, insights: 0, captures: 0, total: 0 },
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
