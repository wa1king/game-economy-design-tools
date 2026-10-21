# 本项目的更新约定

- GitHub 仓库：`https://github.com/wa1king/game-economy-design-tools`，发布分支 `main`。
- 用户已于 2026-10-21 明确要求：后续本网站每次修改完成并验证后，直接提交、推送 GitHub，无需逐次确认。此授权仅限本项目。
- 订单工具日常开发目录为 `../taoyuan-order-lab/dist`，GitHub 发布目录为本仓库 `orders/`；同步时保留首页、加工工具和现有集成。
- 推送前检查远端和工作树；不覆盖他人修改，不强制推送。只暂存本次相关文件。
- 浏览器内项目、经营存档及导入文件不得自动重新采集上传；现有 `orders/shared-session.json` 是用户先前明确同步的快照，应保留。
- 推送后检查 GitHub Pages 发布状态；只有验证线上版本后才声称网站已更新。
- 相关回归检查在 `tests/`，使用 Node.js 执行。
