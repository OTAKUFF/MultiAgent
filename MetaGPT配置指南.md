# MetaGPT 配置指南

本文档记录了从克隆 MetaGPT 项目到配置 Kimi 大模型并成功运行的完整过程。

---

## 一、环境准备

### 1.1 克隆项目

```bash
git clone https://github.com/geekan/MetaGPT.git
cd MetaGPT
```

### 1.2 创建虚拟环境

使用 UV 工具创建虚拟环境（推荐）：

```bash
# 安装 UV（如果还没安装）
pip install uv

# 创建虚拟环境
uv venv metagpt_env
```

或使用 Python 自带的 venv：

```bash
python -m venv metagpt_env
```

### 1.3 激活虚拟环境

**Windows PowerShell：**
```powershell
metagpt_env\Scripts\activate
```

**Windows CMD：**
```cmd
metagpt_env\Scripts\activate.bat
```

**Linux/Mac：**
```bash
source metagpt_env/bin/activate
```

### 1.4 安装 MetaGPT

```bash
# 使用 UV 安装（推荐，更快）
uv pip install -e .

# 或使用 pip 安装
pip install -e .
```

---

## 二、配置 Kimi 大模型

### 2.1 获取 Kimi API Key

1. 访问 [Moonshot AI 开放平台](https://platform.moonshot.cn/)
2. 注册/登录账号
3. 在控制台创建 API Key
4. 复制保存 API Key（格式：`sk-...`）

### 2.2 配置文件位置与优先级

MetaGPT 的配置加载逻辑在 `metagpt/config2.py` 的 `Config.default()` 方法中，加载顺序如下（**后者覆盖前者**）：

```
环境变量
    ↓ 覆盖
METAGPT_ROOT/config/config2.yaml   （项目目录，低优先级）
    ↓ 覆盖
~/.metagpt/config2.yaml            （用户主目录，高优先级）
```

- `METAGPT_ROOT` = 项目根目录，即 `D:\MyPyCode\MetaGPT`
- `~/.metagpt/` = 用户主目录下的 `.metagpt` 文件夹，即 `C:\Users\<用户名>\.metagpt\`

**推荐做法：** 在 `~/.metagpt/config2.yaml` 中写入 API Key，避免密钥被提交到 git 仓库。

### 2.3 创建用户配置文件（推荐）

在用户主目录创建配置文件：

```
C:\Users\<你的用户名>\.metagpt\config2.yaml
```

文件内容：

```yaml
llm:
  api_type: "moonshot"            # 使用 moonshot 类型（推荐）
  base_url: "https://api.moonshot.cn/v1"
  api_key: "sk-your-kimi-api-key-here"  # 替换为你的 Kimi API Key
  model: "moonshot-v1-8k"         # 或 moonshot-v1-32k, moonshot-v1-128k
```

**可用的 Kimi 模型：**
- `moonshot-v1-8k` - 8K 上下文（推荐，速度快，费用低）
- `moonshot-v1-32k` - 32K 上下文
- `moonshot-v1-128k` - 128K 上下文

### 2.4 修改项目配置文件（备选）

如果不想使用用户主目录配置，也可以直接修改项目目录下的配置文件：

**位置：** `D:\MyPyCode\MetaGPT\config\config2.yaml`

```yaml
llm:
  api_type: "moonshot"
  base_url: "https://api.moonshot.cn/v1"
  api_key: "sk-your-kimi-api-key-here"
  model: "moonshot-v1-8k"
```

> **注意：** 此文件已被 git 追踪，修改后注意不要将 API Key 提交到远程仓库。

### 2.5 关于 `openai_api.py` 的修改（可选）

本项目对 `metagpt/provider/openai_api.py` 做了一处修改，用于支持 **Kimi K2.5 Thinking 模型**的 `enable_thinking` 参数。

**普通 Kimi 模型（moonshot-v1-8k 等）无需此修改**，MetaGPT 原生已通过 `LLMType.MOONSHOT` 支持 Kimi。

如需使用 Kimi K2.5 Thinking 功能，在配置文件中添加：

```yaml
llm:
  api_type: "moonshot"
  base_url: "https://api.moonshot.cn/v1"
  api_key: "sk-your-kimi-api-key-here"
  model: "kimi-k2-0711-preview"
  enable_thinking: true  # 开启思考模式（需要 openai_api.py 的修改）
```

---

## 三、验证配置

### 3.1 测试 API 连接

创建测试脚本 `test_kimi.py`：

```python
from metagpt.provider.openai_api import OpenAILLM
from metagpt.config2 import Config

# 加载配置
config = Config.default()

# 创建 LLM 实例
llm = OpenAILLM(config.llm)

# 测试调用
response = llm.ask("你好，请介绍一下你自己")
print(response)
```

运行测试：

```bash
python test_kimi.py
```

如果输出 Kimi 的回复，说明配置成功。

### 3.2 检查配置

```bash
# 查看当前配置
metagpt --help

# 查看版本
metagpt --version
```

---

## 四、运行 MetaGPT

### 4.1 方式一：激活虚拟环境后运行

```bash
# 1. 激活虚拟环境
metagpt_env\Scripts\activate

# 2. 运行 MetaGPT
metagpt "制作一个打砖块游戏，使用 pygame，包含挡板、小球和多行砖块，支持生命值系统"
```

### 4.2 方式二：直接使用完整路径运行（推荐）

不需要激活虚拟环境，直接运行：

```bash
metagpt_env\Scripts\metagpt.exe "制作一个打砖块游戏，使用 pygame，包含挡板、小球和多行砖块，支持生命值系统"
```

### 4.3 生成的项目位置

生成的项目默认保存在：

```
D:\MyPyCode\MetaGPT\workspace\<项目名称>\
```

---

## 五、项目管理脚本

为了方便管理和运行生成的项目，创建了 `manage_projects.ps1` 脚本。

### 5.1 脚本功能

- 列出所有生成的项目
- 自动检测项目类型（Python/Node.js）
- 自动创建虚拟环境并安装依赖
- 验证和修复 requirements.txt
- 支持数字或名称选择项目
- 一键运行项目

### 5.2 使用方法

**交互式模式：**

```powershell
.\manage_projects.ps1
```

**命令行模式：**

```powershell
# 列出所有项目
.\manage_projects.ps1 list

# 运行指定项目
.\manage_projects.ps1 run breakout_py

# 删除项目
.\manage_projects.ps1 delete breakout_py

# 清理所有虚拟环境
.\manage_projects.ps1 clean
```

### 5.3 脚本特性

1. **自动依赖管理**
   - Python 项目：自动创建 .venv 并安装依赖
   - Node.js 项目：自动运行 npm install

2. **智能错误处理**
   - 自动验证 requirements.txt，移除无效包名
   - 检测并修复依赖安装问题
   - 使用 `--python` 参数确保依赖安装到正确的虚拟环境

3. **用户友好**
   - 支持数字选择项目（输入 1、2、3）
   - 支持项目名称选择
   - 显示项目配置状态

---

## 六、常见问题和解决方案

### 6.1 生成的项目无法运行

MetaGPT 生成的项目可能存在以下问题：

#### 问题类型

**可以通过脚本自动修复（约 40-50%）：**
- ✅ 无效的依赖包名（如 `pygame.freetype`）
- ✅ 文件编码问题（UTF-8 BOM）
- ✅ Python 版本兼容性（如 `slots=True` 需要 Python 3.10+）
- ✅ 缺失的资源文件（自动使用系统默认）

**需要手动修复（约 50-60%）：**
- ❌ 架构设计错误（如 sprite_group 但类不继承 Sprite）
- ❌ 导入路径错误
- ❌ 库使用方式错误
- ❌ 业务逻辑错误

#### 常见错误及解决方案

**1. Python 项目：ModuleNotFoundError**

```
ModuleNotFoundError: No module named 'pygame'
```

**原因：** 依赖未安装或安装到错误的环境

**解决：** 脚本已自动处理，使用 `--python .\.venv\Scripts\python.exe` 确保安装到项目虚拟环境

**2. Python 项目：dataclass slots 错误**

```
TypeError: dataclass() got an unexpected keyword argument 'slots'
```

**原因：** 代码使用了 Python 3.10+ 特性，但环境是 Python 3.9

**解决：** 移除 `slots=True` 参数

```python
# 修改前
@dataclass(frozen=True, slots=True)
class Point:
    x: int
    y: int

# 修改后
@dataclass(frozen=True)
class Point:
    x: int
    y: int
```

**3. Node.js 项目：JSON 解析错误**

```
SyntaxError: Unexpected token '﻿', "﻿{ "name"... is not valid JSON
```

**原因：** JSON 文件包含 UTF-8 BOM

**解决：** 使用 Python 移除 BOM

```bash
python -c "
import json
with open('package.json', 'r', encoding='utf-8-sig') as f:
    data = json.load(f)
with open('package.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write('\n')
"
```

**4. Node.js 项目：导入路径错误**

```
Failed to resolve import "../hooks/useStopwatch" from "src/app.jsx"
```

**原因：** 相对路径错误

**解决：** 修正导入路径

```javascript
// 错误
import { useStopwatch } from '../hooks/useStopwatch';

// 正确（如果 app.jsx 在 src/ 目录）
import { useStopwatch } from './hooks/useStopwatch';
```

**5. Pygame 项目：Sprite Group 错误**

```
AttributeError: 'Paddle' object has no attribute 'add_internal'
```

**原因：** 使用了 `pygame.sprite.Group` 但类不继承 `pygame.sprite.Sprite`

**解决：** 移除 sprite_group，改用直接绘制

```python
# 移除 sprite_group 初始化
# self.sprite_group = pygame.sprite.Group()
# self.sprite_group.add(self.paddle)

# 在 draw() 方法中直接绘制
def draw(self, surface):
    surface.fill(self.settings.BG_COLOR)
    self.paddle.draw(surface)
    self.ball.draw(surface)
    for brick in self.bricks:
        if not brick.destroyed:
            brick.draw(surface)
```

### 6.2 虚拟环境问题

**问题：** 有多个虚拟环境，不知道用哪个

**解决：**
- MetaGPT 本身安装在 `metagpt_env/`
- 每个生成的项目有自己的 `.venv/`
- 运行 MetaGPT 时激活 `metagpt_env`
- 运行生成的项目时使用项目的 `.venv`（脚本自动处理）

### 6.3 API 调用失败

**问题：** API 调用超时或失败

**检查：**
1. API Key 是否正确
2. 网络连接是否正常
3. API 额度是否充足
4. base_url 是否正确

**调试：**

```python
# 添加详细日志
import logging
logging.basicConfig(level=logging.DEBUG)
```

---

## 七、最佳实践

### 7.1 编写高质量提示词

**推荐格式：**

```
制作一个 [项目类型]，使用 [技术栈]，包含以下功能：
1. [功能1]
2. [功能2]
3. [功能3]

技术要求：
- Python 版本：3.9+
- 使用系统字体，不要引用外部字体文件
- 所有依赖使用稳定版本
- 代码要兼容 Windows 系统
```

**示例：**

```
制作一个贪吃蛇游戏，使用 pygame，包含以下功能：
1. 蛇的移动和转向
2. 食物随机生成
3. 碰撞检测（墙壁和自身）
4. 分数统计

技术要求：
- Python 3.9+
- 使用 pygame 2.5+
- 使用系统字体
- 代码简洁，避免过度设计
```

### 7.2 项目类型建议

**适合 MetaGPT 生成的项目：**
- ✅ 简单的游戏（贪吃蛇、打砖块、俄罗斯方块）
- ✅ 命令行工具
- ✅ 简单的 Web 应用（秒表、计算器、待办事项）
- ✅ 数据处理脚本

**不适合 MetaGPT 生成的项目：**
- ❌ 复杂的企业级应用
- ❌ 需要数据库的应用
- ❌ 需要复杂状态管理的应用
- ❌ 需要第三方 API 集成的应用

### 7.3 生成后的检查清单

生成项目后，建议检查：

1. ✅ requirements.txt 是否包含无效包名
2. ✅ 是否引用了不存在的文件
3. ✅ Python 版本兼容性
4. ✅ 导入路径是否正确
5. ✅ 是否有明显的逻辑错误

---

## 八、参考资源

### 8.1 官方文档

- [MetaGPT GitHub](https://github.com/geekan/MetaGPT)
- [MetaGPT 文档](https://docs.deepwisdom.ai/)
- [Moonshot AI 文档](https://platform.moonshot.cn/docs)

### 8.2 相关工具

- [UV - 快速的 Python 包管理器](https://github.com/astral-sh/uv)
- [Pygame 文档](https://www.pygame.org/docs/)
- [Vite 文档](https://vitejs.dev/)
- [Preact 文档](https://preactjs.com/)

### 8.3 常用命令速查

```bash
# MetaGPT
metagpt "提示词"                    # 生成项目
metagpt --help                      # 查看帮助

# 虚拟环境
metagpt_env\Scripts\activate        # 激活环境（Windows）
deactivate                          # 退出环境

# UV 包管理
uv pip install <package>            # 安装包
uv pip list                         # 列出已安装的包
uv venv                             # 创建虚拟环境

# 项目管理脚本
.\manage_projects.ps1               # 交互式模式
.\manage_projects.ps1 list          # 列出项目
.\manage_projects.ps1 run <name>    # 运行项目
```

---

## 九、总结

MetaGPT 是一个强大的 AI 代码生成工具，但生成的代码质量不稳定。通过：

1. **正确配置 Kimi 大模型** - 提供稳定的 API 支持
2. **使用项目管理脚本** - 自动处理常见问题
3. **编写清晰的提示词** - 提高生成代码质量
4. **手动检查和修复** - 处理脚本无法解决的问题

可以有效提高 MetaGPT 的使用体验和成功率。

**记住：** MetaGPT 是辅助工具，不是完全自动化的解决方案。生成的代码需要人工审查和调整。

---

**文档版本：** 1.0
**最后更新：** 2026-02-21
**适用版本：** MetaGPT v0.8+
