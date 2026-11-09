import { officeGroups, type OfficeGroup } from "./office-taxonomy";

/** 左侧白卡片分类。不传 groups 时用智能体、技能那五组；知识库传入自己的分组。 */
export function OfficeFacetNav({
  picked,
  folded,
  onFold,
  onPick,
  groups = officeGroups,
}: {
  picked: Record<string, string>;
  folded: Record<string, boolean>;
  onFold: (groupId: string, open: boolean) => void;
  onPick: (groupId: string, itemId: string) => void;
  groups?: OfficeGroup[];
}) {
  return (
    <>
      {groups.map((group) => {
        const open = !folded[group.id];
        const selected = picked[group.id] ?? "";
        return (
          <section className="agent-facet-card" key={group.id}>
            <button
              className="agent-facet-card-head"
              type="button"
              aria-expanded={open}
              onClick={() => onFold(group.id, open)}
            >
              <span className={open ? "agent-facet-caret" : "agent-facet-caret is-folded"} aria-hidden="true" />
              {group.name}
            </button>
            {open ? (
              <div className="agent-facet-card-list" role="group" aria-label={group.name}>
                <button type="button" aria-pressed={selected === ""} onClick={() => onPick(group.id, "")}>
                  全部
                </button>
                {group.items.map((option) => (
                  <button key={option.id} type="button" aria-pressed={selected === option.id} onClick={() => onPick(group.id, option.id)}>
                    {option.name}
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </>
  );
}
