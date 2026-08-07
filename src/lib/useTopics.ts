'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Topic } from '@/lib/types';

/**
 * 주제 목록.
 * 주제는 프로그램마다 타이핑하는 게 아니라 한 곳에서 관리한다 (TopicManager).
 * 정렬은 원장이 정한 sort_order 를 따르고, 같으면 이름순.
 */
export function useTopics() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { data } = await supabase.from('topics').select('*').order('sort_order').order('name');
    setTopics((data ?? []) as Topic[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const nameOfTopic = useCallback(
    (id: string | null | undefined) => (id ? (topics.find((t) => t.id === id)?.name ?? '') : ''),
    [topics],
  );

  return { topics, loading, reload, nameOfTopic };
}
