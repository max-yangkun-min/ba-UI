# 聊天首页专家

这些目录是聊天首页上的自定义专家。每个目录有一份 `scenario.json`：`prompt_template` 含 `{user_input}`，`skills` 是绑定的技能编号。技能正文是同目录的 `SKILL.md`；绑定了多个技能时，正文在 `skills/<所有者>/<名称>/SKILL.md`。

`install.sh` 不会导入这些文件，也不会修改现场已经存在的场景或技能。需要时由管理员在 Blade 里另行创建。

人事专家在平台上的场景没有绑定技能，因此该目录只有 `scenario.json`。
