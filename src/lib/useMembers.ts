'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { MemberPublic } from '@/lib/types';

/** 멤버 목록(공개 정보)은 거의 모든 화면에서 필요하다. */
export function useMembers(includeInactive = false) {
  const [members, setMembers] = useState<MemberPublic[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    let q = supabase.from('members_public').select('*').order('sort_order').order('name');
    if (!includeInactive) q = q.eq('active', true);
    const { data } = await q;
    setMembers((data ?? []) as MemberPublic[]);
    setLoading(false);
  }, [includeInactive]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const nameOf = useCallback(
    (id: string | null | undefined) => (id ? (members.find((m) => m.id === id)?.name ?? '-') : '-'),
    [members],
  );

  return { members, loading, reload, nameOf };
}
