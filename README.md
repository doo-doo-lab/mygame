# DoL 云端存档版

这是基于 Degrees of Lewdity 中文整合版的个人在线游玩副本。

- 游戏入口：`index.html`
- 云端存档：`save/main.save`（位于 `save` 分支）
- 同步方式：网页通过 GitHub Contents API 读取和更新存档
- 令牌只保存在浏览器本地，不写入仓库

首次打开游戏时，请创建一个 GitHub 细粒度个人访问令牌：

1. 只选择仓库 `doo-doo-lab/mygame`
2. 只授予 `Contents: Read and write`
3. 将令牌输入游戏首次出现的连接框

请勿把令牌提交到仓库。该仓库中的存档内容是公开的，Git 历史也会保留旧存档版本。

原游戏和中文本地化内容的版权、许可和署名请见 `LICENSE`、`CREDITS.md` 与上游发布库。此仓库仅供个人非商业使用。
