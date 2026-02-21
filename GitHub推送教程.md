# 我的代码版本管理教程（零基础）

## 当前状态说明

你的本地项目（`D:\PyCode\MetaGPT`）已经和你自己的 GitHub 仓库绑定好了：

```
本地项目  ←→  https://github.com/OTAKUFF/MultiAgent
```

**和 MetaGPT 原仓库没有任何关联**，MetaGPT 那边怎么改都不会影响你这里。

---

## 核心概念（先看这个）

Git 的工作流程就像游戏存档：

```
改代码  →  git add（选择要存的文件）  →  git commit（存档）  →  git push（上传到云端）
```

- `git add`：告诉 Git "我要存这些文件"
- `git commit`：真正存档，留下一条记录
- `git push`：把存档上传到 GitHub（云端备份）

---

## 日常使用流程

### 第一步：查看改了哪些文件

```bash
git status
```

输出示例：
```
modified:   metagpt/tools/libs/editor.py   ← 修改过的文件（红色）
Untracked:  我的新脚本.py                  ← 新建的文件（红色）
```

### 第二步：把文件加入暂存区

```bash
# 方式 A：添加所有改动的文件（最常用）
git add .

# 方式 B：只添加某个文件
git add metagpt/tools/libs/editor.py

# 方式 C：添加某个文件夹
git add metagpt/tools/
```

再次运行 `git status`，文件变绿色说明添加成功。

### 第三步：提交（存档）

```bash
git commit -m "这里写你做了什么改动"
```

提交说明建议写清楚，方便以后回溯，例如：
```bash
git commit -m "修改了 editor.py 的文件读取逻辑"
git commit -m "新增 my_agent.py 实现自动写代码功能"
git commit -m "修复运行报错的 bug"
```

### 第四步：推送到 GitHub

```bash
git push origin main
```

推送成功后，打开 https://github.com/OTAKUFF/MultiAgent 就能看到最新代码。

---

## 查看历史记录

```bash
# 查看最近 10 条提交记录
git log --oneline -10
```

输出示例：
```
56e38824 backup: save local modifications and project files
11cdf466 修改了 editor.py
de17c62a 新增配置文件
```

左边那串字母数字是每次提交的唯一 ID，回溯版本时会用到。

---

## 回溯版本（代码写乱了怎么办）

### 情况一：还没有 commit，想撤销对某个文件的修改

```bash
# 把 editor.py 恢复到上次 commit 时的状态
git checkout -- metagpt/tools/libs/editor.py
```

**注意：这个操作不可撤销，文件会直接还原。**

### 情况二：已经 commit 了，想回到某个历史版本查看

```bash
# 先查看历史，找到你想回去的那个 commit ID
git log --oneline -10

# 切换到那个版本（只是查看，不会丢失现在的代码）
git checkout 56e38824
```

查看完之后，回到最新版本：
```bash
git checkout main
```

### 情况三：已经 commit 了，想彻底回退到某个历史版本

```bash
# 先查看历史，找到目标 commit ID
git log --oneline -10

# 回退到那个版本（之后的提交记录会消失！）
git reset --hard 56e38824

# 强制推送到 GitHub（覆盖云端）
git push origin main --force
```

**警告：`--force` 会覆盖 GitHub 上的记录，确认后再执行。**

---

## 常用命令速查表

| 命令 | 作用 |
|------|------|
| `git status` | 查看哪些文件被修改了 |
| `git add .` | 暂存所有改动 |
| `git add <文件路径>` | 暂存指定文件 |
| `git commit -m "说明"` | 提交存档 |
| `git push origin main` | 推送到 GitHub |
| `git log --oneline -10` | 查看最近 10 条提交记录 |
| `git checkout -- <文件>` | 撤销某文件的未提交修改 |
| `git checkout main` | 回到最新版本 |
| `git reset --hard <ID>` | 强制回退到某个版本 |

---

## 注意事项

- **不要提交 API Key**：`config/config2.yaml` 里如果有 API Key，确保它在 `.gitignore` 里
- **不要提交大文件**：模型权重、数据集等大文件不适合放 GitHub
- **提交说明写清楚**：方便以后自己看懂每次改了什么
- **推送前先 commit**：没有 commit 的内容无法推送

---

## 身份验证（推送时要求输入密码）

GitHub 不支持账号密码登录，需要用 Token。

### 生成 Token

1. 登录 GitHub → 右上角头像 → **Settings**
2. 左侧最底部 → **Developer settings**
3. **Personal access tokens** → **Tokens (classic)**
4. **Generate new token (classic)**，勾选 `repo`，生成并复制

### 把 Token 写入远程地址（一次配置，之后不再询问）

```bash
git remote set-url origin https://OTAKUFF:你的token@github.com/OTAKUFF/MultiAgent.git
```

把 `你的token` 替换成刚才复制的内容。

---

## 验证当前配置

随时可以运行这个命令确认仓库连接正确：

```bash
git remote -v
```

正确输出应该是：
```
origin  https://github.com/OTAKUFF/MultiAgent.git (fetch)
origin  https://github.com/OTAKUFF/MultiAgent.git (push)
```

只有这一个 origin，没有 upstream，说明和 MetaGPT 原仓库完全独立。
