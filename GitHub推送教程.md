# 将项目推送到 GitHub 远程仓库教程

## 当前状态

本项目已关联远程仓库：
```
origin  https://github.com/FoundationAgents/MetaGPT.git
```

当前有以下未提交的变更：
- 修改文件：`metagpt/tools/libs/editor.py`
- 未跟踪文件：`MetaGPT配置指南.md`
- 未跟踪目录：`启动生成的项目/`

你的 GitHub 用户名：**OTAKUFF**

---

## 推送到自己的 GitHub 仓库（完整步骤）

### 第一步：配置 Git 用户信息

```bash
git config --global user.name "OTAKUFF"
git config --global user.email "你的GitHub注册邮箱"
```

### 第二步：在 GitHub 上 Fork 原仓库

1. 打开 https://github.com/FoundationAgents/MetaGPT
2. 点击右上角 **Fork** 按钮
3. 选择 OTAKUFF 账号，完成 Fork

Fork 完成后你会得到：`https://github.com/OTAKUFF/MetaGPT`

### 第三步：修改本地远程地址

```bash
# 保留原仓库为 upstream，方便后续同步上游更新
git remote rename origin upstream

# 添加自己的仓库为 origin
git remote add origin https://github.com/OTAKUFF/MetaGPT.git

# 验证配置
git remote -v
```

输出应为：
```
origin    https://github.com/OTAKUFF/MetaGPT.git (fetch)
origin    https://github.com/OTAKUFF/MetaGPT.git (push)
upstream  https://github.com/FoundationAgents/MetaGPT.git (fetch)
upstream  https://github.com/FoundationAgents/MetaGPT.git (push)
```

### 第四步：决定哪些文件要提交

```bash
# 查看当前状态
git status

# 只提交代码修改，不提交本地生成的目录
git add metagpt/tools/libs/editor.py

# 如果也想提交配置指南
git add "MetaGPT配置指南.md"

# 如果不想上传"启动生成的项目"目录，先加入 .gitignore
echo "启动生成的项目/" >> .gitignore
git add .gitignore
```

### 第五步：提交变更

```bash
git commit -m "feat: 修改 editor.py 并添加配置指南"
```

### 第六步：推送到自己的仓库

```bash
git push origin main
```

---

## 身份验证方式

GitHub 已不支持密码登录，必须使用以下方式之一：

### 方式 A：Personal Access Token（推荐，简单）

1. 登录 GitHub → 右上角头像 → **Settings**
2. 左侧菜单最底部 → **Developer settings**
3. **Personal access tokens** → **Tokens (classic)**
4. **Generate new token (classic)**，勾选 `repo` 权限，生成并复制 token

推送时输入：
```
Username: OTAKUFF
Password: 粘贴你的 token（不是账号密码）
```

或者把 token 写入 URL，之后不再需要输入：
```bash
git remote set-url origin https://OTAKUFF:你的token@github.com/OTAKUFF/MetaGPT.git
```

### 方式 B：SSH Key（一次配置，永久免密）

```bash
# 生成密钥
ssh-keygen -t ed25519 -C "你的GitHub注册邮箱"

# 查看公钥
cat ~/.ssh/id_ed25519.pub
```

复制公钥内容，添加到 GitHub → Settings → **SSH and GPG keys** → **New SSH key**

然后改用 SSH 地址：
```bash
git remote set-url origin git@github.com:OTAKUFF/MetaGPT.git
```

测试连接：
```bash
ssh -T git@github.com
# 成功会显示：Hi OTAKUFF! You've successfully authenticated...
```

---

## 后续同步上游更新

当原仓库 FoundationAgents/MetaGPT 有新提交时，同步到本地：

```bash
git fetch upstream
git merge upstream/main
git push origin main
```

---

## 常用命令速查

| 命令 | 说明 |
|------|------|
| `git status` | 查看当前变更状态 |
| `git add .` | 暂存所有变更 |
| `git add <文件>` | 暂存指定文件 |
| `git commit -m "说明"` | 提交变更 |
| `git push origin main` | 推送到自己的远程仓库 |
| `git fetch upstream` | 拉取上游原仓库的更新 |
| `git log --oneline -5` | 查看最近5条提交记录 |

---

## 注意事项

- `启动生成的项目/` 目录建议加入 `.gitignore`，避免把本地生成内容推上去
- 不要将包含 API Key 的配置文件提交到公开仓库
- token 不要硬编码进代码，也不要提交到仓库
