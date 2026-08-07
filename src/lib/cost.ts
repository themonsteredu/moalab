import type { CostCategory, CostItem } from './types';
import { COST_CATEGORIES } from './types';

export interface ItemCalc {
  /** 재사용품의 1회(수업 1번)당 비용. 소모품은 null */
  perUse: number | null;
  /** 참여 학생 1명당 비용 */
  perPerson: number;
  /** 이 항목의 총 비용 (소모품 = 1인당 × 인원, 재사용품 = 1회당) */
  total: number;
}

/**
 * 소모품:   1인당 = (묶음가격 ÷ 묶음수량) × 1인사용량
 * 재사용품: 1회당 = 묶음가격 ÷ 감가회차,  1인당 = 1회당 ÷ 참여인원
 *
 * 강사비·교통비처럼 "수업 한 번에 통으로 나가는 돈"은
 * 재사용 + 감가회차 1 로 넣으면 1회당 = 그 금액, 1인당 = 금액÷인원 이 된다.
 */
export function calcItem(item: CostItem, headcount: number): ItemCalc {
  const heads = Math.max(1, headcount || 1);

  if (item.reusable) {
    const uses = Math.max(1, Number(item.reuse_count) || 1);
    const perUse = (Number(item.pack_price) || 0) / uses;
    return { perUse, perPerson: perUse / heads, total: perUse };
  }

  const packQty = Number(item.pack_qty) || 1;
  const unit = (Number(item.pack_price) || 0) / (packQty === 0 ? 1 : packQty);
  const perPerson = unit * (Number(item.qty_per_person) || 0);
  return { perUse: null, perPerson, total: perPerson * heads };
}

export interface SheetTotals {
  perPerson: number;
  total: number;
  byCategory: { category: CostCategory; label: string; color: string; total: number; ratio: number }[];
  margin: number;
  marginRate: number | null;
  revenue: number;
}

export function calcSheet(items: CostItem[], headcount: number, salePrice: number): SheetTotals {
  const heads = Math.max(1, headcount || 1);

  let perPerson = 0;
  let total = 0;
  const catTotal = new Map<CostCategory, number>();

  for (const it of items) {
    const c = calcItem(it, heads);
    perPerson += c.perPerson;
    total += c.total;
    catTotal.set(it.category, (catTotal.get(it.category) ?? 0) + c.total);
  }

  const byCategory = COST_CATEGORIES.map((c) => {
    const t = catTotal.get(c.value) ?? 0;
    return { category: c.value, label: c.label, color: c.color, total: t, ratio: total > 0 ? t / total : 0 };
  }).filter((c) => c.total > 0);

  const revenue = (Number(salePrice) || 0) * heads;
  const margin = revenue - total;
  const marginRate = revenue > 0 ? (margin / revenue) * 100 : null;

  return { perPerson, total, byCategory, margin, marginRate, revenue };
}

/** 구매처별로 묶은 장보기 리스트 */
export interface VendorGroup {
  vendor: string;
  items: { item: CostItem; buyQty: number; buyCost: number }[];
  subtotal: number;
}

/**
 * 실제로 몇 묶음을 사야 하는지 계산한다.
 *  - 소모품:   필요개수 = 1인사용량 × 인원 → 묶음수 = ceil(필요개수 ÷ 묶음수량)
 *  - 재사용품: 이미 갖고 있을 확률이 높지만 목록에는 1묶음으로 표기
 */
export function buildShoppingList(items: CostItem[], headcount: number): VendorGroup[] {
  const heads = Math.max(1, headcount || 1);
  const map = new Map<string, VendorGroup>();

  for (const it of items) {
    if (it.category === 'instructor' || it.category === 'transport') continue;
    const vendor = (it.vendor || '').trim() || '구매처 미입력';

    let buyQty: number;
    if (it.reusable) {
      buyQty = 1;
    } else {
      const needed = (Number(it.qty_per_person) || 0) * heads;
      const packQty = Number(it.pack_qty) || 1;
      buyQty = Math.ceil(needed / (packQty === 0 ? 1 : packQty));
    }
    if (buyQty <= 0) continue;

    const buyCost = buyQty * (Number(it.pack_price) || 0);
    const g = map.get(vendor) ?? { vendor, items: [], subtotal: 0 };
    g.items.push({ item: it, buyQty, buyCost });
    g.subtotal += buyCost;
    map.set(vendor, g);
  }

  return [...map.values()].sort((a, b) => b.subtotal - a.subtotal);
}

export function categoryLabel(c: CostCategory): string {
  return COST_CATEGORIES.find((x) => x.value === c)?.label ?? '기타';
}

export function categoryColor(c: CostCategory): string {
  return COST_CATEGORIES.find((x) => x.value === c)?.color ?? '#8A8A8A';
}
