type AxisItem = { hidden?: true };

export function visibilityAxis<T extends AxisItem>(items: T[], id: (item: T) => string) {
  return {
    items,
    id,
    indices: new Map(items.map((item, index) => [id(item), index])),
    visible: items.some(item => item.hidden) ? items.filter(item => !item.hidden) : items,
  };
}

export function visibilityGap<T extends AxisItem>(axis: ReturnType<typeof visibilityAxis<T>>, id: string): string | undefined {
  const index = axis.indices.get(id)!;
  const before = axis.items[index - 1]?.hidden;
  const after = axis.items[index + 1]?.hidden;
  return before ? (after ? "before after" : "before") : after ? "after" : undefined;
}

export function visibilityTargets<T extends AxisItem>(
  axis: ReturnType<typeof visibilityAxis<T>>, first: string | undefined, last: string | undefined, hidden: boolean,
): string[] {
  if (!first || !last) return hidden ? [] : axis.items.filter(item => item.hidden).map(axis.id);
  let start = axis.indices.get(first);
  let end = axis.indices.get(last);
  if (start === undefined || end === undefined) return [];
  if (!hidden) {
    while (axis.items[start - 1]?.hidden) start--;
    while (axis.items[end + 1]?.hidden) end++;
  }
  return axis.items.slice(start, end + 1).filter(item => Boolean(item.hidden) !== hidden).map(axis.id);
}
